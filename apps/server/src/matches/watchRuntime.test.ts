import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addSpectatorSocket, assertNotSpectator, removeSpectatorSocket, SpectatorControlError } from "./watchRuntime.js";

describe("watchRuntime spectator control", () => {
  it("blocks control while socket is marked spectator", () => {
    const map = new Map<string, Set<string>>();
    addSpectatorSocket(map, "m1", "s1");
    assert.throws(() => assertNotSpectator(map, "m1", "s1"), SpectatorControlError);
  });

  it("allows control after leaving spectator view", () => {
    const map = new Map<string, Set<string>>();
    addSpectatorSocket(map, "m1", "s1");
    removeSpectatorSocket(map, "m1", "s1");
    assert.doesNotThrow(() => assertNotSpectator(map, "m1", "s1"));
  });
});
