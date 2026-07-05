import {
  buildPlaylistItemMarkup,
  totalDuration,
  scheduleAt,
  formatTime,
  clockOffsetFromDate,
  listenerUrl,
  roleFromLocation,
  playlistJson,
  remoteOffset,
  ghContentsApiUrl,
  buildNowPlaying,
  switchTab,
} from "./lib.js";

const TRACKS = [
  { name: "A", url: "a.mp3", duration: 30 },
  { name: "B", url: "b.mp3", duration: 25 },
  { name: "C", url: "c.mp3", duration: 20 },
];

describe("buildPlaylistItemMarkup", () => {
  it("embeds the track name with a music icon", () => {
    const html = buildPlaylistItemMarkup("song.mp3");
    expect(html).toContain("song.mp3");
    expect(html).toContain("fa-music");
  });
});

describe("totalDuration", () => {
  it("sums track durations", () => {
    expect(totalDuration(TRACKS)).toBe(75);
  });

  it("returns 0 for empty/missing playlists", () => {
    expect(totalDuration([])).toBe(0);
    expect(totalDuration(null)).toBe(0);
  });
});

describe("scheduleAt", () => {
  it("returns null when there are no tracks", () => {
    expect(scheduleAt([], 10)).toBeNull();
    expect(scheduleAt(null, 10)).toBeNull();
  });

  it("maps elapsed time to the correct track and offset", () => {
    expect(scheduleAt(TRACKS, 0)).toEqual({
      index: 0,
      offset: 0,
      track: TRACKS[0],
    });
    expect(scheduleAt(TRACKS, 10)).toEqual({
      index: 0,
      offset: 10,
      track: TRACKS[0],
    });
    // 40s in: past track A (30s) -> 10s into track B
    expect(scheduleAt(TRACKS, 40)).toEqual({
      index: 1,
      offset: 10,
      track: TRACKS[1],
    });
    // 60s in: past A(30)+B(25)=55 -> 5s into track C
    expect(scheduleAt(TRACKS, 60)).toEqual({
      index: 2,
      offset: 5,
      track: TRACKS[2],
    });
  });

  it("loops via modulo of the total duration (75s)", () => {
    // 75s == one full loop -> back to track A offset 0
    expect(scheduleAt(TRACKS, 75)).toEqual({
      index: 0,
      offset: 0,
      track: TRACKS[0],
    });
    // 115s == 75 + 40 -> same as elapsed 40
    expect(scheduleAt(TRACKS, 115)).toEqual({
      index: 1,
      offset: 10,
      track: TRACKS[1],
    });
  });

  it("handles negative elapsed by wrapping into the loop", () => {
    // -5s wraps to 70s -> track C offset 15
    expect(scheduleAt(TRACKS, -5)).toEqual({
      index: 2,
      offset: 15,
      track: TRACKS[2],
    });
  });
});

describe("formatTime", () => {
  it("formats seconds as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("clamps invalid values to 0:00", () => {
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });
});

describe("clockOffsetFromDate", () => {
  it("returns server-minus-local skew in ms", () => {
    const local = 1000;
    const header = new Date(4000).toUTCString(); // seconds precision
    expect(clockOffsetFromDate(header, local)).toBe(3000);
  });

  it("returns 0 when the header is missing or unparseable", () => {
    expect(clockOffsetFromDate(null, 1000)).toBe(0);
    expect(clockOffsetFromDate("not-a-date", 1000)).toBe(0);
  });
});

describe("listenerUrl", () => {
  it("appends r=ouvinte to the current page path", () => {
    expect(
      listenerUrl({ origin: "https://x.github.io", pathname: "/asynaudios/" }),
    ).toBe("https://x.github.io/asynaudios/?r=ouvinte");
  });

  it("tolerates a missing/empty location", () => {
    expect(listenerUrl({})).toBe("?r=ouvinte");
    expect(listenerUrl(null)).toBe("?r=ouvinte");
  });
});

describe("roleFromLocation", () => {
  it("returns 'ouvinte' when r=ouvinte is present", () => {
    expect(roleFromLocation({ search: "?r=ouvinte" })).toBe("ouvinte");
    expect(roleFromLocation({ search: "?foo=1&r=ouvinte" })).toBe("ouvinte");
  });

  it("defaults to 'central' otherwise", () => {
    expect(roleFromLocation({ search: "" })).toBe("central");
    expect(roleFromLocation({ search: "?r=central" })).toBe("central");
    expect(roleFromLocation(null)).toBe("central");
  });
});

describe("playlistJson", () => {
  it("maps local uploads to repo paths and rounds durations", () => {
    const json = playlistJson(42, [
      { name: "A", url: "assets/tracks/a.mp3", duration: 30 },
      { name: "my song.mp3", url: "blob:xyz", duration: 12.3456, local: true },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed.epoch).toBe(42);
    expect(parsed.tracks[0].url).toBe("assets/tracks/a.mp3");
    expect(parsed.tracks[1].url).toBe("assets/tracks/my song.mp3");
    expect(parsed.tracks[1].duration).toBe(12.35);
  });

  it("handles missing tracks and missing durations", () => {
    const parsed = JSON.parse(playlistJson(0, null));
    expect(parsed.tracks).toEqual([]);
    const parsed2 = JSON.parse(playlistJson(0, [{ name: "x", url: "x.mp3" }]));
    expect(parsed2.tracks[0].duration).toBe(0);
  });
});

describe("remoteOffset", () => {
  it("advances from `at` while playing", () => {
    const state = { offset: 10, at: 1000, paused: false };
    expect(remoteOffset(state, 3000)).toBe(12); // +2s
  });

  it("freezes at the stored offset when paused", () => {
    const state = { offset: 42, at: 1000, paused: true };
    expect(remoteOffset(state, 999999)).toBe(42);
  });

  it("is defensive against missing state/fields", () => {
    expect(remoteOffset(null, 5000)).toBe(0);
    expect(remoteOffset({ paused: false }, 5000)).toBe(0);
  });
});

describe("ghContentsApiUrl", () => {
  it("builds the contents URL, pinning the branch when given", () => {
    expect(ghContentsApiUrl("o", "r", "nowplaying.json", "main")).toBe(
      "https://api.github.com/repos/o/r/contents/nowplaying.json?ref=main",
    );
    expect(ghContentsApiUrl("o", "r", "playlist.json")).toBe(
      "https://api.github.com/repos/o/r/contents/playlist.json",
    );
  });
});

describe("buildNowPlaying", () => {
  it("captures the track, rounded offset, time and paused flag", () => {
    const s = buildNowPlaying(
      { name: "B", url: "assets/tracks/b.mp3" },
      12.3456,
      1700,
      false,
      3,
    );
    expect(s).toEqual({
      trackUrl: "assets/tracks/b.mp3",
      trackName: "B",
      offset: 12.35,
      at: 1700,
      paused: false,
      rev: 3,
    });
  });

  it("tolerates a null track", () => {
    const s = buildNowPlaying(null, -5, 1, true);
    expect(s.trackUrl).toBe("");
    expect(s.offset).toBe(0);
    expect(s.paused).toBe(true);
    expect(s.rev).toBe(0);
  });
});

describe("switchTab", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-central" class="nav-item active"></button>
      <button id="btn-ouvinte" class="nav-item"></button>
      <section id="central-panel" class="content-section active"></section>
      <section id="ouvinte-panel" class="content-section"></section>
    `;
  });

  it("activates the selected role and deactivates the others", () => {
    switchTab("ouvinte");
    expect(
      document.getElementById("btn-ouvinte").classList.contains("active"),
    ).toBe(true);
    expect(
      document.getElementById("ouvinte-panel").classList.contains("active"),
    ).toBe(true);
    expect(
      document.getElementById("btn-central").classList.contains("active"),
    ).toBe(false);
    expect(
      document.getElementById("central-panel").classList.contains("active"),
    ).toBe(false);
  });

  it("does not throw when the role has no matching elements", () => {
    expect(() => switchTab("naoexiste")).not.toThrow();
    expect(document.querySelectorAll(".nav-item.active").length).toBe(0);
  });
});
