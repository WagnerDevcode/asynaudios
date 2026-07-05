import {
  buildPlaylistItemMarkup,
  totalDuration,
  scheduleAt,
  formatTime,
  clockOffsetFromDate,
  listenerUrl,
  roleFromLocation,
  playlistJson,
  switchTab,
} from "./lib.js";
import qrcodegen from "./assets/vendor/qrcodegen.js";

// ---------------------------------------------------------------------------
// SyncMusic — backend-free synchronized radio.
// Every client computes the same playback position from a shared clock, so the
// Central and all Ouvintes hear the same track at the same offset. No server:
// the playlist and audio files are served statically (e.g. GitHub Pages).
// ---------------------------------------------------------------------------

const MANIFEST_URL = "playlist.json";

let epoch = 0;
let syncTracks = []; // from playlist.json — drive the shared schedule
let localTracks = []; // added by the Central on this device only
let clockOffset = 0; // ms to add to Date.now() to approximate shared time
let started = false;
let manualMode = false; // true while playing a click-selected track
let currentIndex = -1;

const audio = document.getElementById("radio-audio");
const statusDisplay = document.getElementById("status-display");
const trackName = document.getElementById("current-track-name");
const trackTime = document.getElementById("track-time");
const playlistUl = document.getElementById("playlist");
const joinBtn = document.getElementById("btn-join");
const uploadInput = document.getElementById("upload-file");
const exportBtn = document.getElementById("btn-export");
const exportOut = document.getElementById("export-out");

// Listener mode (opened via ?r=ouvinte): playback-only, no interruption controls.
const listenerMode = roleFromLocation(window.location) === "ouvinte";

// Full display list = synced (repo) tracks first, then local additions.
function allTracks() {
  return [...syncTracks, ...localTracks];
}

// Tabs
document.getElementById("btn-central").onclick = () => switchTab("central");
document.getElementById("btn-ouvinte").onclick = () => switchTab("ouvinte");

function syncedNow() {
  return Date.now() + clockOffset;
}

function elapsedSeconds() {
  return (syncedNow() - epoch) / 1000;
}

function renderPlaylist() {
  const list = allTracks();
  playlistUl.innerHTML = "";
  list.forEach((t, i) => {
    const li = document.createElement("li");
    li.innerHTML = buildPlaylistItemMarkup(t.local ? `${t.name} (local)` : t.name);
    li.onclick = () => playTrack(i);
    playlistUl.appendChild(li);
  });
}

// Read an audio file's duration (seconds) from its metadata.
function readDuration(url) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(probe.duration || 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

// Play a specific track from the display list (manual override of the schedule).
function playTrack(displayIndex) {
  const list = allTracks();
  const track = list[displayIndex];
  if (!track) return;
  manualMode = true;
  started = true;
  currentIndex = displayIndex;
  audio.src = track.url;
  audio.load();
  audio.play().catch(() => {});
  trackName.innerText = track.name;
  highlightCurrent(displayIndex);
  statusDisplay.innerText = track.local ? "TOCANDO (local)" : "TOCANDO";
  statusDisplay.className = "status-online";
}

function highlightCurrent(index) {
  [...playlistUl.children].forEach((li, i) =>
    li.classList.toggle("active", i === index),
  );
}

async function loadManifest() {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar playlist (${res.status})`);
  clockOffset = clockOffsetFromDate(res.headers.get("date"), Date.now());
  const data = await res.json();
  epoch = data.epoch;
  syncTracks = data.tracks || [];
  renderPlaylist();
}

// Align the <audio> element to the schedule. Called on a timer; only reloads
// the source when the track changes and nudges currentTime when drift is large.
function sync() {
  if (manualMode || !syncTracks.length) return;
  const slot = scheduleAt(syncTracks, elapsedSeconds());
  if (!slot) return;

  if (slot.index !== currentIndex) {
    currentIndex = slot.index;
    audio.src = slot.track.url;
    audio.load();
    audio.addEventListener(
      "loadedmetadata",
      () => {
        audio.currentTime = Math.min(slot.offset, audio.duration || slot.offset);
        if (started) audio.play().catch(() => {});
      },
      { once: true },
    );
    trackName.innerText = slot.track.name;
    highlightCurrent(slot.index);
  } else if (Math.abs(audio.currentTime - slot.offset) > 1.5) {
    audio.currentTime = slot.offset;
  }

  const dur = slot.track.duration;
  trackTime.innerText = `${formatTime(slot.offset)} / ${formatTime(dur)}`;
}

// Join the shared schedule and start playing. Returns false if the browser
// blocked autoplay (needs a user gesture).
async function startListening() {
  started = true;
  manualMode = false; // rejoin the shared schedule
  statusDisplay.innerText = "SINCRONIZADO";
  statusDisplay.className = "status-online";
  currentIndex = -1; // force (re)load + play
  sync();
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

joinBtn.onclick = startListening;

if (uploadInput) {
  uploadInput.onchange = async (e) => {
    const files = [...e.target.files];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const duration = await readDuration(url);
      localTracks.push({ name: file.name, url, duration, local: true });
    }
    e.target.value = ""; // allow re-selecting the same file
    renderPlaylist();
    // Auto-play the first newly added track for immediate feedback.
    if (files.length) playTrack(syncTracks.length + localTracks.length - files.length);
  };
}

// Render a QR code for `text` onto a canvas (black modules on white).
function drawQr(canvas, text) {
  if (!canvas) return;
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const scale = 5;
  const border = 4;
  const dim = (qr.size + border * 2) * scale;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
  }
}

// Build the listener link + QR (rendered into every .qr canvas / link input on
// both the Central and Ouvinte panels) and wire the copy / export controls.
function setupShare() {
  const url = listenerUrl(window.location);
  document.querySelectorAll(".qr").forEach((c) => drawQr(c, url));
  document.querySelectorAll(".listener-link").forEach((i) => (i.value = url));

  document.querySelectorAll(".btn-copy-link").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Copiado!";
        setTimeout(() => (btn.textContent = "Copiar link"), 1500);
      } catch {
        const input = btn.parentElement.querySelector(".listener-link");
        if (input) input.select();
      }
    };
  });

  if (exportBtn) {
    exportBtn.onclick = () => {
      exportOut.hidden = false;
      exportOut.value = playlistJson(epoch, allTracks());
      exportOut.select();
      navigator.clipboard && navigator.clipboard.writeText(exportOut.value).catch(() => {});
    };
  }
}

// In listener mode the audio is receive-only: hide the native controls (no
// pause/seek), hide the Central tab, and auto-resume if playback is paused
// (e.g. via OS media keys) so listeners can only reproduce the Central's stream.
function applyListenerMode() {
  if (!listenerMode) return;
  audio.removeAttribute("controls");
  const centralBtn = document.getElementById("btn-central");
  if (centralBtn) centralBtn.style.display = "none";
  if (joinBtn) joinBtn.innerHTML = '<i class="fas fa-play"></i> OUVIR';
  audio.addEventListener("pause", () => {
    if (started && !audio.ended && !audio.seeking && audio.readyState > 2) {
      audio.play().catch(() => {});
    }
  });
}

async function init() {
  switchTab(roleFromLocation(window.location));
  applyListenerMode();
  setupShare();
  try {
    await loadManifest();
    statusDisplay.innerText = `Pronto · ${syncTracks.length} faixas · loop ${formatTime(
      totalDuration(syncTracks),
    )}`;
    sync();
    setInterval(sync, 1000);
    if (listenerMode) await autoStartListening();
  } catch (e) {
    statusDisplay.innerText = "Erro ao carregar a playlist";
    console.error(e);
  }
}

// On QR/link open, drop the listener straight into playback. Browsers block
// autoplay with sound without a gesture, so if playback hasn't actually begun
// shortly after, we show a full-screen "tap to listen" overlay; the first tap
// starts it. The overlay is dismissed once audio truly starts ('playing').
async function autoStartListening() {
  const overlay = document.getElementById("tap-overlay");
  if (overlay) {
    audio.addEventListener("playing", () => {
      overlay.hidden = true;
    });
    overlay.onclick = () => {
      startListening();
      overlay.hidden = true;
    };
  }
  startListening();
  setTimeout(() => {
    if (overlay && audio.paused) overlay.hidden = false;
  }, 600);
}

init();
