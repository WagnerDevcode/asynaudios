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

// Loga o erro e informa o usuário em vez de engoli-lo silenciosamente.
function reportError(context, err) {
  console.error(context, err);
  const detail = err && err.message ? err.message : err;
  alert(`${context}: ${detail}`);
}

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
  if (!file) return;
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
    (err) => {
      document.getElementById("progress-wrapper").style.display = "none";
      reportError("Falha no upload do áudio", err);
    },
    () => {
      document.getElementById("progress-wrapper").style.display = "none";
      loadPlaylist(room).catch((err) =>
        reportError("Falha ao carregar a playlist", err),
      );
    },
  );
};

async function loadPlaylist(room) {
  const listRef = sRef(storage, `salas/${room}`);
  const playlistUl = document.getElementById("playlist");
  playlistUl.innerHTML = "";

  const res = await listAll(listRef);
  await Promise.all(
    res.items.map(async (item) => {
      try {
        const url = await getDownloadURL(item);
        const li = document.createElement("li");
        li.innerHTML = `<span><i class="fas fa-music"></i> ${item.name}</span> <i class="fas fa-play-circle"></i>`;
        li.onclick = () => {
          centralAudio.src = url;
          document.getElementById("current-track-name").innerText = item.name;
          centralAudio
            .play()
            .catch((err) =>
              reportError("Não foi possível reproduzir o áudio", err),
            );
          updateTracks(); // Sincroniza nova música com ouvintes
        };
        playlistUl.appendChild(li);
      } catch (err) {
        console.error(`Erro ao carregar a música ${item.name}`, err);
      }
    }),
  );
}

// ---------------------------
// LOGICA DE TRANSMISSÃO (WebRTC)
// ---------------------------
let localStream;
let peers = {};

document.getElementById("btn-start-broadcast").onclick = async () => {
  const room = roomInput.value.toUpperCase();
  if (!room) return alert("Código da sala vazio!");

  const capture = centralAudio.captureStream
    ? centralAudio.captureStream.bind(centralAudio)
    : centralAudio.mozCaptureStream
      ? centralAudio.mozCaptureStream.bind(centralAudio)
      : null;
  if (!capture) {
    return reportError(
      "Transmissão não suportada",
      new Error("captureStream indisponível neste navegador"),
    );
  }

  try {
    localStream = capture();
  } catch (err) {
    return reportError("Não foi possível capturar o áudio", err);
  }

  statusDisplay.innerText = "LIVE ATIVA";
  statusDisplay.className = "status-online";

  onChildAdded(ref(db, `salas/${room}/listeners`), (snap) => {
    initPeer(snap.key, room).catch((err) =>
      reportError("Falha ao conectar com um ouvinte", err),
    );
  });

  loadPlaylist(room).catch((err) =>
    reportError("Falha ao carregar a playlist", err),
  );
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
      ).catch((err) => console.error("Erro ao enviar ICE candidate", err));
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await set(ref(db, `salas/${room}/sig/${userId}/offer`), {
    type: offer.type,
    sdp: offer.sdp,
  });

  onValue(ref(db, `salas/${room}/sig/${userId}/answer`), (snap) => {
    if (snap.exists())
      pc.setRemoteDescription(new RTCSessionDescription(snap.val())).catch(
        (err) => console.error("Erro ao definir descrição remota", err),
      );
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
  if (!room) return alert("Código da sala vazio!");
  const myId = "user_" + Math.floor(Math.random() * 1000);
  const pc = new RTCPeerConnection(rtcConfig);

  pc.ontrack = (e) =>
    (document.getElementById("remote-audio").srcObject = e.streams[0]);

  pc.onicecandidate = (e) => {
    if (e.candidate)
      set(
        push(ref(db, `salas/${room}/sig/${myId}/c_ouvinte`)),
        e.candidate.toJSON(),
      ).catch((err) => console.error("Erro ao enviar ICE candidate", err));
  };

  try {
    await set(ref(db, `salas/${room}/listeners/${myId}`), true);
  } catch (err) {
    return reportError("Não foi possível entrar na sala", err);
  }

  onValue(ref(db, `salas/${room}/sig/${myId}/offer`), async (snap) => {
    if (!snap.exists()) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await set(ref(db, `salas/${room}/sig/${myId}/answer`), {
        type: ans.type,
        sdp: ans.sdp,
      });
    } catch (err) {
      reportError("Falha ao responder à transmissão", err);
    }
  });
};
