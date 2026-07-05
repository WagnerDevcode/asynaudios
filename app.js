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
let tracks = [];
let clockOffset = 0; // ms to add to Date.now() to approximate shared time
let started = false;
let currentIndex = -1;

const audio = document.getElementById("radio-audio");
const statusDisplay = document.getElementById("status-display");
const trackName = document.getElementById("current-track-name");
const trackTime = document.getElementById("track-time");
const playlistUl = document.getElementById("playlist");
const joinBtn = document.getElementById("btn-join");

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
  playlistUl.innerHTML = "";
  tracks.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = buildPlaylistItemMarkup(t.name);
    playlistUl.appendChild(li);
  });
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
  tracks = data.tracks || [];
  renderPlaylist();
}

// Align the <audio> element to the schedule. Called on a timer; only reloads
// the source when the track changes and nudges currentTime when drift is large.
function sync() {
  if (!tracks.length) return;
  const slot = scheduleAt(tracks, elapsedSeconds());
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

async function init() {
  try {
    await loadManifest();
    statusDisplay.innerText = `Pronto · ${tracks.length} faixas · loop ${formatTime(
      totalDuration(tracks),
    )}`;
    sync();
    setInterval(sync, 1000);
  } catch (e) {
    statusDisplay.innerText = "Erro ao carregar a playlist";
    console.error(e);
  }
}

init();
