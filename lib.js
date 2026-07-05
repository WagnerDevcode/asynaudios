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
