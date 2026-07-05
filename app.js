import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
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
  $,
  getRoomCode,
  requireRoom,
  signalPath,
  relayIceCandidates,
  createPeerConnection,
  applyRemoteDescription,
} from "./utils.js";

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
const centralAudio = $("central-audio");
const roomInput = $("room-code-input");
const statusDisplay = $("status-display");

// alternar painéis
$("btn-central").onclick = () => switchTab("central");
$("btn-ouvinte").onclick = () => switchTab("ouvinte");

function switchTab(role) {
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".content-section")
    .forEach((s) => s.classList.remove("active"));
  $(`btn-${role}`).classList.add("active");
  $(`${role}-panel`).classList.add("active");
}

// ---------------------------
// LOGICA DE UPLOAD E PLAYLIST
// ---------------------------
const fileInput = $("upload-file");
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  const room = requireRoom(roomInput);
  if (!room) return;

  const sPath = sRef(storage, `salas/${room}/${file.name}`);
  const uploadTask = uploadBytesResumable(sPath, file);

  $("progress-wrapper").style.display = "block";

  uploadTask.on(
    "state_changed",
    (snap) => {
      const p = (snap.bytesTransferred / snap.totalBytes) * 100;
      $("upload-progress-fill").style.width = p + "%";
    },
    null,
    () => {
      $("progress-wrapper").style.display = "none";
      loadPlaylist(room);
    },
  );
};

async function loadPlaylist(room) {
  const listRef = sRef(storage, `salas/${room}`);
  const playlistUl = $("playlist");
  playlistUl.innerHTML = "";

  try {
    const res = await listAll(listRef);
    res.items.forEach(async (item) => {
      const url = await getDownloadURL(item);
      const li = document.createElement("li");
      li.innerHTML = `<span><i class="fas fa-music"></i> ${item.name}</span> <i class="fas fa-play-circle"></i>`;
      li.onclick = () => {
        centralAudio.src = url;
        $("current-track-name").innerText = item.name;
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

$("btn-start-broadcast").onclick = async () => {
  const room = requireRoom(roomInput, "Código da sala vazio!");
  if (!room) return;

  localStream = centralAudio.captureStream
    ? centralAudio.captureStream()
    : centralAudio.mozCaptureStream();
  statusDisplay.innerText = "LIVE ATIVA";
  statusDisplay.className = "status-online";

  onChildAdded(ref(db, `salas/${room}/listeners`), (snap) => {
    initPeer(snap.key, room);
  });

  loadPlaylist(room);
};

async function initPeer(userId, room) {
  const pc = createPeerConnection(rtcConfig);
  peers[userId] = pc;

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  relayIceCandidates(pc, db, signalPath(room, userId, "c_central"));

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  set(ref(db, signalPath(room, userId, "offer")), {
    type: offer.type,
    sdp: offer.sdp,
  });

  onValue(ref(db, signalPath(room, userId, "answer")), (snap) => {
    if (snap.exists()) applyRemoteDescription(pc, snap);
  });
}

function updateTracks() {
  const newTrack = localStream.getAudioTracks()[0];
  Object.values(peers).forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track.kind === "audio");
    if (sender) sender.replaceTrack(newTrack);
  });
}

// ---------------------------
// LOGICA DO OUVINTE
// ---------------------------
$("btn-connect").onclick = async () => {
  const room = getRoomCode(roomInput);
  const myId = "user_" + Math.floor(Math.random() * 1000);
  const pc = createPeerConnection(rtcConfig);

  pc.ontrack = (e) => ($("remote-audio").srcObject = e.streams[0]);

  relayIceCandidates(pc, db, signalPath(room, myId, "c_ouvinte"));

  await set(ref(db, `salas/${room}/listeners/${myId}`), true);

  onValue(ref(db, signalPath(room, myId, "offer")), async (snap) => {
    if (snap.exists()) {
      await applyRemoteDescription(pc, snap);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      set(ref(db, signalPath(room, myId, "answer")), {
        type: ans.type,
        sdp: ans.sdp,
      });
    }
  });
};
