import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  push,
  onChildAdded,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// 1. CONFIGURAÇÃO DO FIREBASE (Coloque as suas!)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAF3hKJI1t8NfKvRuWJGf3jFvJtBMICPQY",
  authDomain: "audiosicronizad.firebaseapp.com",
  databaseURL: "https://audiosicronizad-default-rtdb.firebaseio.com", // Adicione esta linha
  projectId: "audiosicronizad",
  storageBucket: "audiosicronizad.firebasestorage.app",
  messagingSenderId: "225394954367",
  appId: "1:225394954367:web:f46491f155dce8415def4a",
  measurementId: "G-D23W05E5F5",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// ==========================================
// 2. CONTROLE DE INTERFACE (UI)
// ==========================================
const panels = {
  selection: document.getElementById("role-selection"),
  central: document.getElementById("central-panel"),
  ouvinte: document.getElementById("ouvinte-panel"),
};

document
  .getElementById("btn-central")
  .addEventListener("click", () => showPanel("central"));
document
  .getElementById("btn-ouvinte")
  .addEventListener("click", () => showPanel("ouvinte"));

function showPanel(role) {
  Object.values(panels).forEach((p) => p.classList.remove("active"));
  panels[role].classList.add("active");
}

// Carregar música local no player da Central
const audioFileInput = document.getElementById("audio-file");
const centralAudioPlayer = document.getElementById("central-audio");

audioFileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    centralAudioPlayer.src = URL.createObjectURL(file);
  }
});

// ==========================================
// 3. LÓGICA DA CENTRAL (TRANSMITIR MÚSICA)
// ==========================================
let audioStream;
let peerConnections = {};

document
  .getElementById("btn-start-broadcast")
  .addEventListener("click", async () => {
    const roomCode = document
      .getElementById("central-room-code")
      .value.trim()
      .toUpperCase();
    const statusText = document.getElementById("central-status");

    if (!roomCode || !centralAudioPlayer.src) {
      alert("Escolha uma música e digite um código de sala!");
      return;
    }

    try {
      // Pega o fluxo de áudio diretamente do reprodutor <audio>
      const captureStream =
        centralAudioPlayer.captureStream || centralAudioPlayer.mozCaptureStream;
      audioStream = captureStream.call(centralAudioPlayer);

      // Exige que o áudio tenha pelo menos uma trilha
      if (audioStream.getAudioTracks().length === 0) {
        // Em alguns navegadores, é preciso dar 'play' primeiro para a trilha existir
        centralAudioPlayer.play();
        audioStream = captureStream.call(centralAudioPlayer);
      }

      statusText.innerText = `Sala ${roomCode} criada! Aguardando ouvintes...`;
      document.getElementById("btn-start-broadcast").disabled = true;

      // Fica escutando novos ouvintes entrarem na SALA ESPECÍFICA
      const listenersRef = ref(db, `salas/${roomCode}/ouvintes`);
      onChildAdded(listenersRef, async (snapshot) => {
        const listenerId = snapshot.key;
        createPeerConnectionForListener(listenerId, roomCode);
      });
    } catch (error) {
      statusText.innerText = "Erro ao capturar áudio da música.";
      console.error(error);
    }
  });

async function createPeerConnectionForListener(listenerId, roomCode) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[listenerId] = pc;

  // Envia a música para a conexão
  audioStream.getTracks().forEach((track) => pc.addTrack(track, audioStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      push(
        ref(db, `salas/${roomCode}/signaling/${listenerId}/candidates/central`),
        event.candidate.toJSON(),
      );
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await set(ref(db, `salas/${roomCode}/signaling/${listenerId}/offer`), {
    type: offer.type,
    sdp: offer.sdp,
  });

  onValue(
    ref(db, `salas/${roomCode}/signaling/${listenerId}/answer`),
    (snapshot) => {
      const answer = snapshot.val();
      if (answer && !pc.currentRemoteDescription) {
        pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    },
  );

  onChildAdded(
    ref(db, `salas/${roomCode}/signaling/${listenerId}/candidates/ouvinte`),
    (snapshot) => {
      const candidate = new RTCIceCandidate(snapshot.val());
      pc.addIceCandidate(candidate);
    },
  );

  document.getElementById("listener-count").innerText =
    Object.keys(peerConnections).length;
}

// ==========================================
// 4. LÓGICA DO OUVINTE (RECEPTOR)
// ==========================================
document.getElementById("btn-connect").addEventListener("click", async () => {
  const roomCode = document
    .getElementById("ouvinte-room-code")
    .value.trim()
    .toUpperCase();
  const statusText = document.getElementById("ouvinte-status");
  const remoteAudio = document.getElementById("remote-audio");

  if (!roomCode) {
    alert("Digite o código da sala!");
    return;
  }

  const myId = "ouvinte_" + Math.random().toString(36).substr(2, 9);
  const pc = new RTCPeerConnection(rtcConfig);

  // Quando o áudio da Central chegar, toca no reprodutor
  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams[0];
    statusText.innerText = "Conectado! Reproduzindo música...";
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      push(
        ref(db, `salas/${roomCode}/signaling/${myId}/candidates/ouvinte`),
        event.candidate.toJSON(),
      );
    }
  };

  // Avisa a Central que entrei na sala
  await set(ref(db, `salas/${roomCode}/ouvintes/${myId}`), true);
  statusText.innerText = "Conectando à sala...";

  onValue(
    ref(db, `salas/${roomCode}/signaling/${myId}/offer`),
    async (snapshot) => {
      const offer = snapshot.val();
      if (offer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await set(ref(db, `salas/${roomCode}/signaling/${myId}/answer`), {
          type: answer.type,
          sdp: answer.sdp,
        });
      }
    },
  );

  onChildAdded(
    ref(db, `salas/${roomCode}/signaling/${myId}/candidates/central`),
    (snapshot) => {
      const candidate = new RTCIceCandidate(snapshot.val());
      pc.addIceCandidate(candidate);
    },
  );
});
