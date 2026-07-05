// Pure / DOM-only helpers extracted from app.js so they can be unit tested
// without pulling in the Firebase or WebRTC runtime dependencies.

// Normalize a room code the same way the UI does: room codes are compared and
// stored uppercased. Returns an empty string for missing input.
export function normalizeRoomCode(value) {
  if (value == null) return "";
  return String(value).toUpperCase();
}

// Percentage (0-100) of an upload given the transferred/total byte counts.
// Returns 0 when the total is missing or zero to avoid NaN/Infinity.
export function calcUploadProgress(bytesTransferred, totalBytes) {
  if (!totalBytes || totalBytes <= 0) return 0;
  return (bytesTransferred / totalBytes) * 100;
}

// Generate a pseudo-random listener id ("user_" + integer in [0, 999]).
// The random source is injectable so the result is deterministic in tests.
export function generateListenerId(rng = Math.random) {
  return "user_" + Math.floor(rng() * 1000);
}

// Build the inner markup for a playlist entry given a track name.
export function buildPlaylistItemMarkup(name) {
  return `<span><i class="fas fa-music"></i> ${name}</span> <i class="fas fa-play-circle"></i>`;
}

// Firebase path builders — centralized so the central and listener sides agree
// on where rooms, listeners and WebRTC signaling data live.
export function roomStoragePath(room, fileName) {
  return fileName ? `salas/${room}/${fileName}` : `salas/${room}`;
}

export function listenersPath(room) {
  return `salas/${room}/listeners`;
}

export function listenerPath(room, userId) {
  return `salas/${room}/listeners/${userId}`;
}

// Signaling channel path: channel is "offer" | "answer" | "c_central" | "c_ouvinte".
export function signalPath(room, userId, channel) {
  return `salas/${room}/sig/${userId}/${channel}`;
}

// Activate a role tab ("central" / "ouvinte"): toggles the `active` class on
// the matching nav button and content panel, clearing it from the others.
export function switchTab(role, doc = document) {
  doc.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  doc
    .querySelectorAll(".content-section")
    .forEach((s) => s.classList.remove("active"));
  const button = doc.getElementById(`btn-${role}`);
  if (button) button.classList.add("active");
  const panel = doc.getElementById(`${role}-panel`);
  if (panel) panel.classList.add("active");
}
