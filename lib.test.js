import {
  normalizeRoomCode,
  calcUploadProgress,
  generateListenerId,
  buildPlaylistItemMarkup,
  switchTab,
  roomStoragePath,
  listenersPath,
  listenerPath,
  signalPath,
} from "./lib.js";

describe("normalizeRoomCode", () => {
  it("uppercases the room code", () => {
    expect(normalizeRoomCode("festa2024")).toBe("FESTA2024");
  });

  it("leaves already-uppercased input unchanged", () => {
    expect(normalizeRoomCode("ABC")).toBe("ABC");
  });

  it("returns an empty string for null/undefined", () => {
    expect(normalizeRoomCode(null)).toBe("");
    expect(normalizeRoomCode(undefined)).toBe("");
  });

  it("coerces non-string values to a string", () => {
    expect(normalizeRoomCode(123)).toBe("123");
  });
});

describe("calcUploadProgress", () => {
  it("computes the percentage transferred", () => {
    expect(calcUploadProgress(50, 200)).toBe(25);
  });

  it("returns 100 when fully transferred", () => {
    expect(calcUploadProgress(200, 200)).toBe(100);
  });

  it("returns 0 when nothing transferred", () => {
    expect(calcUploadProgress(0, 200)).toBe(0);
  });

  it("returns 0 (not NaN/Infinity) when total is zero or missing", () => {
    expect(calcUploadProgress(10, 0)).toBe(0);
    expect(calcUploadProgress(10, undefined)).toBe(0);
    expect(calcUploadProgress(10, -5)).toBe(0);
  });
});

describe("generateListenerId", () => {
  it("prefixes the id with user_", () => {
    expect(generateListenerId(() => 0.5)).toBe("user_500");
  });

  it("floors the random value into [0, 999]", () => {
    expect(generateListenerId(() => 0)).toBe("user_0");
    expect(generateListenerId(() => 0.9999)).toBe("user_999");
  });

  it("defaults to Math.random and stays within range", () => {
    const id = generateListenerId();
    const n = Number(id.replace("user_", ""));
    expect(id).toMatch(/^user_\d+$/);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(999);
  });
});

describe("buildPlaylistItemMarkup", () => {
  it("embeds the track name with music/play icons", () => {
    const html = buildPlaylistItemMarkup("song.mp3");
    expect(html).toContain("song.mp3");
    expect(html).toContain("fa-music");
    expect(html).toContain("fa-play-circle");
  });
});

describe("firebase path builders", () => {
  it("roomStoragePath builds room and file paths", () => {
    expect(roomStoragePath("FESTA")).toBe("salas/FESTA");
    expect(roomStoragePath("FESTA", "song.mp3")).toBe("salas/FESTA/song.mp3");
  });

  it("listenersPath / listenerPath build the listener paths", () => {
    expect(listenersPath("FESTA")).toBe("salas/FESTA/listeners");
    expect(listenerPath("FESTA", "user_5")).toBe(
      "salas/FESTA/listeners/user_5",
    );
  });

  it("signalPath builds each signaling channel path", () => {
    expect(signalPath("FESTA", "user_5", "offer")).toBe(
      "salas/FESTA/sig/user_5/offer",
    );
    expect(signalPath("FESTA", "user_5", "answer")).toBe(
      "salas/FESTA/sig/user_5/answer",
    );
    expect(signalPath("FESTA", "user_5", "c_central")).toBe(
      "salas/FESTA/sig/user_5/c_central",
    );
    expect(signalPath("FESTA", "user_5", "c_ouvinte")).toBe(
      "salas/FESTA/sig/user_5/c_ouvinte",
    );
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
    expect(
      document.querySelectorAll(".nav-item.active").length,
    ).toBe(0);
  });
});
