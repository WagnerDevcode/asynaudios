import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  push,
  onChildAdded,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import {
  getStorage,
  ref as sRef,
  uploadBytesResumable,
  getDownloadURL,
  listAll,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import {
  normalizeRoomCode,
  calcUploadProgress,
  generateListenerId,
  buildPlaylistItemMarkup,
  switchTab,
  roomStoragePath,
  listenersPath,
  listenerPath,
  signalPath,
} from "./lib.js";

// CONFIGURAÇÃO DO SEU FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSyAF3hKJI1t8NfKvRuWJGf3jFvJtBMICPQY",
  authDomain: "audiosicronizad.firebaseapp.com",
  databaseURL: "https://audiosicronizad-default-rtdb.firebaseio.com",
  projectId: "audiosicronizad",
  storageBucket: "audiosicronizad.firebasestorage.app",
  messagingSenderId: "225394954367",
  appId: "1:225394954367:web:f46491f155dce8415def4a",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// UI Elements
const centralAudio = document.getElementById("central-audio");
const roomInput = document.getElementById("room-code-input");
const statusDisplay = document.getElementById("status-display");

// alternar painéis
document.getElementById("btn-central").onclick = () => switchTab("central");
document.getElementById("btn-ouvinte").onclick = () => switchTab("ouvinte");

// ---------------------------
// LOGICA DE UPLOAD E PLAYLIST
// ---------------------------
const fileInput = document.getElementById("upload-file");
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  const room = normalizeRoomCode(roomInput.value);
  if (!room) return alert("Digite o código da sala!");

  const sPath = sRef(storage, roomStoragePath(room, file.name));
  const uploadTask = uploadBytesResumable(sPath, file);

  document.getElementById("progress-wrapper").style.display = "block";

  uploadTask.on(
    "state_changed",
    (snap) => {
      const p = calcUploadProgress(snap.bytesTransferred, snap.totalBytes);
      document.getElementById("upload-progress-fill").style.width = p + "%";
    },
    null,
    () => {
      document.getElementById("progress-wrapper").style.display = "none";
      loadPlaylist(room);
    },
  );
};

async function loadPlaylist(room) {
  const listRef = sRef(storage, roomStoragePath(room));
  const playlistUl = document.getElementById("playlist");
  playlistUl.innerHTML = "";

  try {
    const res = await listAll(listRef);
    res.items.forEach(async (item) => {
      const url = await getDownloadURL(item);
      const li = document.createElement("li");
      li.innerHTML = buildPlaylistItemMarkup(item.name);
      li.onclick = () => {
        centralAudio.src = url;
        document.getElementById("current-track-name").innerText = item.name;
        centralAudio.play();
        updateTracks(); // Sincroniza nova música com ouvintes
      };
      playlistUl.appendChild(li);
    });
  } catch (e) {
    console.error("Erro ao listar musicas", e);
  }
}

// ---------------------------
// LOGICA DE TRANSMISSÃO (WebRTC)
// ---------------------------
let localStream;
let peers = {};

document.getElementById("btn-start-broadcast").onclick = async () => {
  const room = normalizeRoomCode(roomInput.value);
  if (!room) return alert("Código da sala vazio!");

  localStream = centralAudio.captureStream
    ? centralAudio.captureStream()
    : centralAudio.mozCaptureStream();
  statusDisplay.innerText = "LIVE ATIVA";
  statusDisplay.className = "status-online";

  onChildAdded(ref(db, listenersPath(room)), (snap) => {
    initPeer(snap.key, room);
  });

  loadPlaylist(room);
};

async function initPeer(userId, room) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers[userId] = pc;

  const pendingCandidates = [];
  let remoteReady = false;

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate)
      set(
        push(ref(db, signalPath(room, userId, "c_central"))),
        e.candidate.toJSON(),
      );
  };

  onChildAdded(ref(db, signalPath(room, userId, "c_ouvinte")), (snap) => {
    const cand = snap.val();
    if (!cand) return;
    if (remoteReady)
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
    else pendingCandidates.push(cand);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  set(ref(db, signalPath(room, userId, "offer")), {
    type: offer.type,
    sdp: offer.sdp,
  });

  onValue(ref(db, signalPath(room, userId, "answer")), async (snap) => {
    if (!snap.exists() || remoteReady) return;
    await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
    remoteReady = true;
    pendingCandidates.forEach((c) =>
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error),
    );
    pendingCandidates.length = 0;
  });
}

function updateTracks() {
  if (!localStream) return;
  const newTrack = localStream.getAudioTracks()[0];
  if (!newTrack) return;
  Object.values(peers).forEach((pc) => {
    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "audio");
    if (sender) sender.replaceTrack(newTrack);
  });
}

// ---------------------------
// LOGICA DO OUVINTE
// ---------------------------
document.getElementById("btn-connect").onclick = async () => {
  const room = normalizeRoomCode(roomInput.value);
  if (!room) return alert("Código da sala vazio!");

  const myId = generateListenerId();
  const pc = new RTCPeerConnection(rtcConfig);
  const remoteAudio = document.getElementById("remote-audio");

  const pendingCandidates = [];
  let remoteReady = false;

  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play().catch(() => {});
  };

  pc.onicecandidate = (e) => {
    if (e.candidate)
      set(
        push(ref(db, signalPath(room, myId, "c_ouvinte"))),
        e.candidate.toJSON(),
      );
  };

  onChildAdded(ref(db, signalPath(room, myId, "c_central")), (snap) => {
    const cand = snap.val();
    if (!cand) return;
    if (remoteReady)
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(console.error);
    else pendingCandidates.push(cand);
  });

  await set(ref(db, listenerPath(room, myId)), true);

  onValue(ref(db, signalPath(room, myId, "offer")), async (snap) => {
    if (!snap.exists() || remoteReady) return;
    await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
    remoteReady = true;
    pendingCandidates.forEach((c) =>
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error),
    );
    pendingCandidates.length = 0;
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    set(ref(db, signalPath(room, myId, "answer")), {
      type: ans.type,
      sdp: ans.sdp,
    });

    statusDisplay.innerText = "CONECTADO";
    statusDisplay.className = "status-online";
  });
};
