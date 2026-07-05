// Pure / DOM-only helpers for the synchronized radio. Kept free of network and
// DOM-binding side effects so they can be unit tested in isolation.

// Build the inner markup for a playlist entry given a track name.
export function buildPlaylistItemMarkup(name) {
  return `<span><i class="fas fa-music"></i> ${name}</span>`;
}

// Total duration (seconds) of all tracks in the playlist.
export function totalDuration(tracks) {
  if (!tracks || tracks.length === 0) return 0;
  return tracks.reduce((sum, t) => sum + t.duration, 0);
}

// Deterministic schedule: given the elapsed seconds since a shared epoch, return
// which track should be playing and the offset (seconds) into it. The playlist
// loops, so any elapsed value maps into the loop via modulo. Returns null when
// there are no tracks. This is what makes every client play in sync: they all
// compute the same position from the same clock.
export function scheduleAt(tracks, elapsedSeconds) {
  if (!tracks || tracks.length === 0) return null;
  const total = totalDuration(tracks);
  if (total <= 0) return null;

  let pos = elapsedSeconds % total;
  if (pos < 0) pos += total;

  for (let i = 0; i < tracks.length; i++) {
    if (pos < tracks[i].duration) {
      return { index: i, offset: pos, track: tracks[i] };
    }
    pos -= tracks[i].duration;
  }
  const last = tracks.length - 1;
  return { index: last, offset: tracks[last].duration, track: tracks[last] };
}

// Format seconds as "m:ss".
export function formatTime(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const whole = Math.floor(totalSeconds);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Clock skew (ms) between a server `Date` header and the local clock, used to
// align all clients to a shared time reference. Returns 0 if the header is
// missing or unparseable (fall back to the local clock).
export function clockOffsetFromDate(dateHeader, localNowMs) {
  if (!dateHeader) return 0;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return 0;
  return server - localNowMs;
}

// Build the listener URL from a location-like object: the same page with the
// `r=ouvinte` query so a scanned QR opens straight into the listener view.
export function listenerUrl(loc) {
  const origin = loc && loc.origin ? loc.origin : "";
  const path = loc && loc.pathname ? loc.pathname : "";
  return `${origin}${path}?r=ouvinte`;
}

// Read the role ("central" | "ouvinte") from a location-like object's search
// string. Defaults to "central".
export function roleFromLocation(loc) {
  const search = (loc && loc.search) || "";
  return /[?&]r=ouvinte\b/.test(search) ? "ouvinte" : "central";
}

// Serialize tracks into a pretty `playlist.json` string. Local uploads are
// remapped to their repo path (`assets/tracks/<filename>`) so the Central can
// commit them and have every listener play them in sync. Durations are rounded
// to 2 decimals.
export function playlistJson(epoch, tracks) {
  const out = {
    epoch,
    tracks: (tracks || []).map((t) => ({
      name: t.name,
      url: t.local ? `assets/tracks/${t.name}` : t.url,
      duration: Math.round((t.duration || 0) * 100) / 100,
    })),
  };
  return JSON.stringify(out, null, 2);
}

// Return a new tracks array with the entry at `index` removed. Out-of-range
// indices leave the list unchanged (returned as a copy).
export function removeTrackAt(tracks, index) {
  const list = [...(tracks || [])];
  if (index < 0 || index >= list.length) return list;
  list.splice(index, 1);
  return list;
}

// Playback offset (seconds) implied by a now-playing state at the given shared
// time. If paused, the offset is frozen; otherwise it advances from the moment
// the state was captured (`at`).
export function remoteOffset(state, syncedNowMs) {
  if (!state) return 0;
  const base = typeof state.offset === "number" ? state.offset : 0;
  if (state.paused) return base;
  const at = typeof state.at === "number" ? state.at : syncedNowMs;
  return Math.max(0, base + (syncedNowMs - at) / 1000);
}

// GitHub Contents API URL for a repo path (optionally pinned to a branch).
export function ghContentsApiUrl(owner, repo, path, branch) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  return branch ? `${base}?ref=${encodeURIComponent(branch)}` : base;
}

// Build the now-playing broadcast state the Central writes to the repo and the
// listeners mirror. Offset is clamped/rounded; `at` is the shared-clock time.
export function buildNowPlaying(track, offset, atMs, paused, rev) {
  return {
    trackUrl: track ? track.url : "",
    trackName: track ? track.name : "",
    offset: Math.max(0, Math.round((offset || 0) * 100) / 100),
    at: atMs,
    paused: !!paused,
    rev: rev || 0,
  };
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
