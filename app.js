import {
  buildPlaylistItemMarkup,
  scheduleAt,
  formatTime,
  clockOffsetFromDate,
  listenerUrl,
  roleFromLocation,
  playlistJson,
  remoteOffset,
  removeTrackAt,
  ghContentsApiUrl,
  buildNowPlaying,
  switchTab,
} from "./lib.js";
import qrcodegen from "./assets/vendor/qrcodegen.js";

// ---------------------------------------------------------------------------
// SyncMusic — GitHub-backed synchronized radio.
// The Central controls playback (full media controls) and acts as the trigger:
// on each action it uploads state to nowplaying.json in the repo. Listeners
// poll that file and mirror it (playback-only). When no state exists, listeners
// fall back to a deterministic shared-clock schedule from playlist.json.
// ---------------------------------------------------------------------------

const MANIFEST_URL = "playlist.json";
const STATE_URL = "nowplaying.json";
const POLL_MS = 4000;
const GH_KEY = "syncmusic_gh";

let epoch = 0;
let syncTracks = []; // from playlist.json (the station library)
let localTracks = []; // added locally when GitHub isn't configured
let clockOffset = 0; // ms to add to Date.now() for a shared time reference
let started = false;
let manualMode = false; // Central playing a chosen track (skips the fallback loop)
let currentIndex = -1;
let rev = 0;
let remotePaused = false;
let lastRemoteTrack = "";

const audio = document.getElementById("radio-audio");
const statusDisplay = document.getElementById("status-display");
const trackName = document.getElementById("current-track-name");
const trackTime = document.getElementById("track-time");
const playlistUl = document.getElementById("playlist");
const joinBtn = document.getElementById("btn-join");
const uploadInput = document.getElementById("upload-file");
const exportBtn = document.getElementById("btn-export");
const exportOut = document.getElementById("export-out");
const ghOwner = document.getElementById("gh-owner");
const ghRepo = document.getElementById("gh-repo");
const ghBranch = document.getElementById("gh-branch");
const ghToken = document.getElementById("gh-token");
const ghSaveBtn = document.getElementById("gh-save");
const ghStatus = document.getElementById("gh-status");

// Listener mode (opened via ?r=ouvinte): playback-only, no interruption controls.
const listenerMode = roleFromLocation(window.location) === "ouvinte";

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

// ---------------------------------------------------------------------------
// GitHub config (Central only). Stored in this browser's localStorage — never
// committed. Listeners read public files and don't need a token.
// ---------------------------------------------------------------------------
function ghConfig() {
  try {
    return JSON.parse(localStorage.getItem(GH_KEY)) || {};
  } catch {
    return {};
  }
}

function ghConfigured() {
  const c = ghConfig();
  return !!(c.owner && c.repo && c.token);
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function ghGetFile(path) {
  const c = ghConfig();
  const res = await fetch(ghContentsApiUrl(c.owner, c.repo, path, c.branch), {
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json();
}

async function ghDeleteFile(path, message, sha) {
  const c = ghConfig();
  const body = { message, sha };
  if (c.branch) body.branch = c.branch;
  const res = await fetch(ghContentsApiUrl(c.owner, c.repo, path), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub DELETE ${path}: ${res.status}`);
  return res.json();
}

async function ghPutFile(path, base64Content, message, sha) {
  const c = ghConfig();
  const body = { message, content: base64Content };
  if (c.branch) body.branch = c.branch;
  if (sha) body.sha = sha;
  const res = await fetch(ghContentsApiUrl(c.owner, c.repo, path), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status}`);
  return res.json();
}

function setGhStatus(text) {
  if (ghStatus) ghStatus.textContent = text;
}

function loadGhForm() {
  const c = ghConfig();
  if (ghOwner) ghOwner.value = c.owner || "";
  if (ghRepo) ghRepo.value = c.repo || "";
  if (ghBranch) ghBranch.value = c.branch || "main";
  if (ghToken) ghToken.value = c.token || "";
  setGhStatus(ghConfigured() ? "GitHub configurado" : "Não configurado");
}

if (ghSaveBtn) {
  ghSaveBtn.onclick = () => {
    const cfg = {
      owner: ghOwner.value.trim(),
      repo: ghRepo.value.trim(),
      branch: ghBranch.value.trim() || "main",
      token: ghToken.value.trim(),
    };
    localStorage.setItem(GH_KEY, JSON.stringify(cfg));
    setGhStatus(ghConfigured() ? "GitHub configurado" : "Preencha todos os campos");
  };
}

// ---------------------------------------------------------------------------
// Central → repo: write the now-playing state (debounced) so listeners follow.
// ---------------------------------------------------------------------------
let writeTimer = null;
let writing = false;

function scheduleStateWrite() {
  if (listenerMode || !ghConfigured()) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNowPlaying, 700);
}

async function writeNowPlaying() {
  if (writing || !ghConfigured()) return;
  writing = true;
  try {
    const track = allTracks()[currentIndex];
    rev += 1;
    const state = buildNowPlaying(
      track,
      audio.currentTime,
      syncedNow(),
      audio.paused,
      rev,
    );
    const existing = await ghGetFile(STATE_URL);
    await ghPutFile(
      STATE_URL,
      utf8ToBase64(JSON.stringify(state, null, 2)),
      `nowplaying: ${state.trackName} @ ${Math.round(state.offset)}s`,
      existing && existing.sha,
    );
    setGhStatus(state.paused ? "Pausado (ouvintes seguem)" : "No ar para os ouvintes");
  } catch (e) {
    console.error(e);
    setGhStatus(`Erro ao gravar estado: ${e.message}`);
  } finally {
    writing = false;
  }
}

async function updatePlaylistFile() {
  const existing = await ghGetFile(MANIFEST_URL);
  await ghPutFile(
    MANIFEST_URL,
    utf8ToBase64(playlistJson(epoch, syncTracks)),
    "update playlist.json",
    existing && existing.sha,
  );
}

// ---------------------------------------------------------------------------
// UI + playback
// ---------------------------------------------------------------------------
function renderPlaylist() {
  const list = allTracks();
  playlistUl.innerHTML = "";
  list.forEach((t, i) => {
    const li = document.createElement("li");
    li.innerHTML = buildPlaylistItemMarkup(t.local ? `${t.name} (local)` : t.name);
    if (!listenerMode) {
      li.onclick = () => playTrack(i);
      const del = document.createElement("button");
      del.className = "btn-track-del";
      del.type = "button";
      del.title = "Excluir faixa";
      del.setAttribute("aria-label", `Excluir ${t.name}`);
      del.innerHTML = '<i class="fas fa-trash"></i>';
      del.onclick = (ev) => {
        ev.stopPropagation();
        deleteTrack(i);
      };
      li.appendChild(del);
    }
    playlistUl.appendChild(li);
  });
  highlightCurrent(currentIndex);
}

// Central: remove a track from the station. Synced tracks are deleted from the
// repo (MP3 + playlist.json entry) so listeners stop seeing them; local-only
// uploads are just dropped from this device.
async function deleteTrack(displayIndex) {
  if (listenerMode) return;
  const list = allTracks();
  const track = list[displayIndex];
  if (!track) return;
  const isLocal = displayIndex >= syncTracks.length;

  if (isLocal) {
    localTracks = removeTrackAt(localTracks, displayIndex - syncTracks.length);
  } else if (ghConfigured()) {
    try {
      setGhStatus(`Excluindo ${track.name}…`);
      const existing = await ghGetFile(track.url);
      if (existing && existing.sha) {
        await ghDeleteFile(track.url, `remove track ${track.name}`, existing.sha);
      }
      syncTracks = removeTrackAt(syncTracks, displayIndex);
      await updatePlaylistFile();
      setGhStatus(`${track.name} removida do repositório`);
    } catch (err) {
      console.error(err);
      setGhStatus(`Erro ao remover ${track.name}: ${err.message}`);
      return;
    }
  } else {
    syncTracks = removeTrackAt(syncTracks, displayIndex);
  }

  if (displayIndex === currentIndex) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    currentIndex = -1;
    trackName.innerText = "Nenhuma faixa";
  } else if (displayIndex < currentIndex) {
    currentIndex -= 1;
  }
  renderPlaylist();
}

function readDuration(url) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(probe.duration || 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
  });
}

// Central plays a chosen track; the 'play' event triggers the state write.
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
  statusDisplay.innerText = ghConfigured() ? "NO AR" : "TOCANDO (local)";
  statusDisplay.className = "status-online";
}

function highlightCurrent(index) {
  [...playlistUl.children].forEach((li, i) =>
    li.classList.toggle("active", i === index),
  );
}

async function loadManifest() {
  const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao carregar playlist (${res.status})`);
  clockOffset = clockOffsetFromDate(res.headers.get("date"), Date.now());
  const data = await res.json();
  epoch = data.epoch;
  syncTracks = data.tracks || [];
  renderPlaylist();
}

// Deterministic fallback: everyone computes the same position from the shared
// clock. Used by listeners when no now-playing state exists yet.
function deterministicSync() {
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
  trackTime.innerText = `${formatTime(slot.offset)} / ${formatTime(slot.track.duration)}`;
}

// Listener: fetch the Central's state and mirror it. Falls back to the
// deterministic schedule when the state file is missing.
async function pollState() {
  let state = null;
  try {
    const res = await fetch(`${STATE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) state = await res.json();
  } catch {
    /* ignore — treated as no state */
  }
  if (!state || !state.trackUrl) {
    deterministicSync();
    return;
  }
  applyRemoteState(state);
}

function applyRemoteState(state) {
  manualMode = true; // remote state overrides the deterministic loop
  remotePaused = !!state.paused;
  const target = remoteOffset(state, syncedNow());

  if (state.trackUrl !== lastRemoteTrack) {
    lastRemoteTrack = state.trackUrl;
    audio.src = state.trackUrl;
    audio.load();
    audio.addEventListener(
      "loadedmetadata",
      () => {
        audio.currentTime = Math.min(target, audio.duration || target);
        if (started && !remotePaused) audio.play().catch(() => {});
      },
      { once: true },
    );
    trackName.innerText = state.trackName || "";
  } else if (Math.abs(audio.currentTime - target) > 1.5) {
    audio.currentTime = target;
  }

  if (started) {
    if (remotePaused && !audio.paused) audio.pause();
    else if (!remotePaused && audio.paused) audio.play().catch(() => {});
  }

  trackTime.innerText = `${formatTime(target)} / ${formatTime(audio.duration || 0)}`;
  statusDisplay.innerText = remotePaused ? "PAUSADO (central)" : "AO VIVO (central)";
  statusDisplay.className = "status-online";
}

// Start playback (listener join / tap-to-start). Returns false if autoplay was
// blocked by the browser.
async function startListening() {
  started = true;
  statusDisplay.innerText = "SINCRONIZADO";
  statusDisplay.className = "status-online";
  if (listenerMode) {
    await pollState();
  } else {
    manualMode = false;
    currentIndex = -1;
    deterministicSync();
  }
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

joinBtn.onclick = () => {
  if (listenerMode) return startListening();
  if (allTracks().length) playTrack(currentIndex >= 0 ? currentIndex : 0);
  return undefined;
};

if (uploadInput) {
  uploadInput.onchange = async (e) => {
    const files = [...e.target.files];
    for (const file of files) {
      if (ghConfigured()) {
        try {
          setGhStatus(`Enviando ${file.name}…`);
          const b64 = await fileToBase64(file);
          const path = `assets/tracks/${file.name}`;
          const existing = await ghGetFile(path);
          await ghPutFile(path, b64, `add track ${file.name}`, existing && existing.sha);
          const duration = await readDuration(URL.createObjectURL(file));
          syncTracks.push({ name: file.name, url: path, duration });
          await updatePlaylistFile();
          setGhStatus(`${file.name} enviada ao repositório`);
        } catch (err) {
          console.error(err);
          setGhStatus(`Erro ao enviar ${file.name}: ${err.message}`);
        }
      } else {
        const url = URL.createObjectURL(file);
        const duration = await readDuration(url);
        localTracks.push({ name: file.name, url, duration, local: true });
      }
    }
    e.target.value = "";
    renderPlaylist();
    if (files.length) {
      const idx = ghConfigured()
        ? syncTracks.length - 1
        : allTracks().length - 1;
      playTrack(idx);
    }
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
      navigator.clipboard &&
        navigator.clipboard.writeText(exportOut.value).catch(() => {});
    };
  }
}

// Central: full media controls act as the trigger — every action writes state.
function wireCentralControls() {
  if (listenerMode) return;
  ["play", "pause", "seeked"].forEach((ev) =>
    audio.addEventListener(ev, scheduleStateWrite),
  );
  audio.addEventListener("ended", () => {
    const list = allTracks();
    if (!list.length) return;
    playTrack((currentIndex + 1) % list.length);
  });
}

// In listener mode the audio is receive-only: hide the native controls (no
// pause/seek), hide the Central tab, and auto-resume if paused locally — but
// never override a Central-initiated pause (remotePaused).
function applyListenerMode() {
  if (!listenerMode) return;
  audio.removeAttribute("controls");
  const centralBtn = document.getElementById("btn-central");
  if (centralBtn) centralBtn.style.display = "none";
  if (joinBtn) joinBtn.innerHTML = '<i class="fas fa-play"></i> OUVIR';
  audio.addEventListener("pause", () => {
    if (
      started &&
      !remotePaused &&
      !audio.ended &&
      !audio.seeking &&
      audio.readyState > 2
    ) {
      audio.play().catch(() => {});
    }
  });
}

async function init() {
  switchTab(roleFromLocation(window.location));
  applyListenerMode();
  setupShare();
  loadGhForm();
  wireCentralControls();
  try {
    await loadManifest();
    statusDisplay.innerText = `Pronto · ${syncTracks.length} faixas`;
    if (listenerMode) {
      await pollState();
      setInterval(pollState, POLL_MS);
      await autoStartListening();
    }
  } catch (e) {
    statusDisplay.innerText = "Erro ao carregar a playlist";
    console.error(e);
  }
}

// On QR/link open, drop the listener straight into playback. Browsers block
// autoplay with sound without a gesture, so if playback hasn't begun shortly
// after we show a full-screen "tap to listen" overlay; the first tap starts it.
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
