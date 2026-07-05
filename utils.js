import {
  ref,
  set,
  push,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Shorthand for document.getElementById.
export const $ = (id) => document.getElementById(id);

// Reads the room code from an input, normalized to upper case.
export function getRoomCode(inputEl) {
  return inputEl.value.toUpperCase();
}

// Reads and validates the room code, alerting the user when it is empty.
export function requireRoom(inputEl, message = "Digite o código da sala!") {
  const room = getRoomCode(inputEl);
  if (!room) {
    alert(message);
    return null;
  }
  return room;
}

// Builds the signaling path for a given room/user, optionally scoped to a child.
export function signalPath(room, userId, child = "") {
  const base = `salas/${room}/sig/${userId}`;
  return child ? `${base}/${child}` : base;
}

// Relays local ICE candidates to the given signaling path in the database.
export function relayIceCandidates(pc, db, path) {
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      set(push(ref(db, path)), e.candidate.toJSON());
    }
  };
}

// Creates a peer connection using the shared RTC configuration.
export function createPeerConnection(config) {
  return new RTCPeerConnection(config);
}

// Applies a remote session description from a database snapshot value.
export function applyRemoteDescription(pc, snap) {
  return pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
}
