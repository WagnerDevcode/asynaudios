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

function switchTab(role) {
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".content-section")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(`btn-${role}`).classList.add("active");
  document.getElementById(`${role}-panel`).classList.add("active");
}

// ---------------------------
// LOGICA DE UPLOAD E PLAYLIST
// ---------------------------
const fileInput = document.getElementById("upload-file");
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  const room = roomInput.value.toUpperCase();
  if (!room) return alert("Digite o código da sala!");

  const sPath = sRef(storage, `salas/${room}/${file.name}`);
  const uploadTask = uploadBytesResumable(sPath, file);

  document.getElementById("progress-wrapper").style.display = "block";

  uploadTask.on(
    "state_changed",
    (snap) => {
      const p = (snap.bytesTransferred / snap.totalBytes) * 100;
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
  const listRef = sRef(storage, `salas/${room}`);
  const playlistUl = document.getElementById("playlist");
  playlistUl.innerHTML = "";

  try {
    const res = await listAll(listRef);
    res.items.forEach(async (item) => {
      const url = await getDownloadURL(item);
      const li = document.createElement("li");
      li.innerHTML = `<span><i class="fas fa-music"></i> ${item.name}</span> <i class="fas fa-play-circle"></i>`;
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
  const room = roomInput.value.toUpperCase();
  if (!room) return alert("Código da sala vazio!");

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
  const pc = new RTCPeerConnection(rtcConfig);
  peers[userId] = pc;

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate)
      set(
        push(ref(db, `salas/${room}/sig/${userId}/c_central`)),
        e.candidate.toJSON(),
      );
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  set(ref(db, `salas/${room}/sig/${userId}/offer`), {
    type: offer.type,
    sdp: offer.sdp,
  });

  onValue(ref(db, `salas/${room}/sig/${userId}/answer`), (snap) => {
    if (snap.exists())
      pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
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
document.getElementById("btn-connect").onclick = async () => {
  const room = roomInput.value.toUpperCase();
  const myId = "user_" + Math.floor(Math.random() * 1000);
  const pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = (e) =>
    (document.getElementById("remote-audio").srcObject = e.streams[0]);

  pc.onicecandidate = (e) => {
    if (e.candidate)
      set(
        push(ref(db, `salas/${room}/sig/${myId}/c_ouvinte`)),
        e.candidate.toJSON(),
      );
  };

  await set(ref(db, `salas/${room}/listeners/${myId}`), true);

  onValue(ref(db, `salas/${room}/sig/${myId}/offer`), async (snap) => {
    if (snap.exists()) {
      await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      set(ref(db, `salas/${room}/sig/${myId}/answer`), {
        type: ans.type,
        sdp: ans.sdp,
      });
    }
  });
};
