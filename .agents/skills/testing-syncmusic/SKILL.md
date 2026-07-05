---
name: testing-syncmusic
description: Test the SyncMusic static app (unit tests + synchronized-radio playback) end-to-end. Use when verifying asynaudios UI or lib.js changes.
---

# Testing SyncMusic (asynaudios)

SyncMusic is a **static, no-build ES-module** web app (index.html + app.js + lib.js).
There is no server and no bundler.

## Setup
- Serve statically from the repo root: `python3 -m http.server 8000`, open
  `http://localhost:8000/index.html`. Opening `app.js` directly via `file://`
  fails because ES modules need a proper MIME type / http origin.
- Unit tests: `npm install` then `npm test` (Jest + jsdom). Coverage: `npm run test:coverage`.
  Pure logic lives in `lib.js` (imported by `app.js`); test it there, not `app.js`
  (which binds DOM handlers and fetches on load).

## Architecture note (may change)
The app was originally Firebase RTDB + WebRTC. That backend became unreachable
(RTDB/Storage returned 404), so it was reworked into a **backend-free synchronized
radio**: audio files + `playlist.json` in the repo; every client computes the same
position from a shared clock (`scheduleAt` in `lib.js`, `pos = (now-epoch) % totalDuration`),
aligned via the HTTP `Date` header and drift-corrected each second. If you see
Firebase again, the backend URL/rules likely need fixing first — check the browser
console for `FIREBASE WARNING` and try REST (`curl <databaseURL>/.json`) to confirm
reachability before testing sync.

## End-to-end sync test (the meaningful one)
Prove two independent clients stay in sync — a broken/independent player would
restart each `<audio>` at 0:00.
1. Open the app in **two tabs** (two windows are ideal but this WM/KWin aggressively
   re-maximizes single windows, so side-by-side tiling via wmctrl/xdotool often
   fails — two tabs + `Ctrl+1`/`Ctrl+2` is the reliable fallback).
2. Click **ENTRAR / SINCRONIZAR** in each (needed for audio autoplay = user gesture).
3. Assert both footers show the **same track name**; time offsets differ only by the
   seconds elapsed between reads (they advance in lockstep). Use `zoom` on the footer
   region (~y 690-730) to read the exact `track name` + `m:ss / m:ss`.
4. **Adversarial reload:** reload one tab. Before/after joining it must show the
   **current scheduled position** (mid-playlist), NOT `Sinal A 0:00`. This is the
   strongest proof the position is clock-derived, not per-session.

## Gotchas
- Autoplay: audio won't play until the user clicks the join button; `play()` also
  retries on the next 1s sync tick.
- The sample tracks are short sine tones (~30/25/20s, loop 1:15) so track boundaries
  and looping are easy to observe within a minute.
- Two tabs on one machine share the OS clock, so cross-device skew (the `Date`-header
  path, `clockOffsetFromDate`) is NOT exercised — call that out in reports.

## Devin Secrets Needed
None — fully static, no credentials.
