import {
  buildPlaylistItemMarkup,
  totalDuration,
  scheduleAt,
  formatTime,
  clockOffsetFromDate,
  switchTab,
} from "./lib.js";

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

joinBtn.onclick = async () => {
  started = true;
  manualMode = false; // rejoin the shared schedule
  statusDisplay.innerText = "SINCRONIZADO";
  statusDisplay.className = "status-online";
  currentIndex = -1; // force (re)load + play under the user gesture
  sync();
  try {
    await audio.play();
  } catch {
    /* will retry on next sync tick */
  }
};

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

async function init() {
  try {
    await loadManifest();
    statusDisplay.innerText = `Pronto · ${syncTracks.length} faixas · loop ${formatTime(
      totalDuration(syncTracks),
    )}`;
    sync();
    setInterval(sync, 1000);
  } catch (e) {
    statusDisplay.innerText = "Erro ao carregar a playlist";
    console.error(e);
  }
}

init();
