import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canUserViewLiveMatch } from "./watchPolicy.js";

describe("canUserViewLiveMatch", () => {
  it("allows public anonymous viewing when policy is PUBLIC", () => {
    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      owners: new Set(["p1"]),
      policy: "PUBLIC"
    }), true);
  });

  it("blocks anonymous viewing when policy is not PUBLIC", () => {
    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      owners: new Set(["p1"]),
      policy: "PARTICIPANTS_ONLY"
    }), false);
  });

  it("allows lobby members in LOBBY_MEMBERS policy", () => {
    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      user: { id: "u2", role: "PLAYER" },
      owners: new Set(["p1"]),
      policy: "LOBBY_MEMBERS",
      findLobbyByMatchId: () => ({ matchId: "m1", status: "IN_MATCH", players: [{ userId: "u2" }] })
    }), true);
  });

  it("blocks non-members in LOBBY_MEMBERS policy", () => {
    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      user: { id: "u3", role: "PLAYER" },
      owners: new Set(["p1"]),
      policy: "LOBBY_MEMBERS",
      findLobbyByMatchId: () => ({ matchId: "m1", status: "IN_MATCH", players: [{ userId: "u2" }] })
    }), false);
  });

  it("always allows participants and admins", () => {
    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      user: { id: "p1", role: "PLAYER" },
      owners: new Set(["p1"]),
      policy: "PARTICIPANTS_ONLY"
    }), true);

    assert.equal(canUserViewLiveMatch({
      matchId: "m1",
      user: { id: "admin", role: "ADMIN" },
      owners: new Set(["p1"]),
      policy: "PARTICIPANTS_ONLY"
    }), true);
  });
});
