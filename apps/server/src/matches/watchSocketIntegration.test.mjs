import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Server } from "socket.io";
import { io as createClient } from "socket.io-client";
import { addSpectatorSocket, assertNotSpectator, removeSpectatorSocket } from "./watchRuntime.js";

describe("watch socket integration", () => {
  it("rejects spectator control emits and allows after leave", async () => {
    const httpServer = http.createServer();
    const io = new Server(httpServer, { cors: { origin: "*" } });
    const spectatorMap = new Map();

    await new Promise(resolve => httpServer.listen(0, resolve));
    const address = httpServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${port}`;

    const received = [];

    io.on("connection", socket => {
      socket.on("watch:start", matchId => addSpectatorSocket(spectatorMap, matchId, socket.id));
      socket.on("watch:leave", matchId => removeSpectatorSocket(spectatorMap, matchId, socket.id));
      socket.on("match:testControl", matchId => {
        try {
          assertNotSpectator(spectatorMap, matchId, socket.id);
          socket.emit("ok", "allowed");
        } catch {
          socket.emit("err", "blocked");
        }
      });
    });

    const client = createClient(url, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });

    client.on("ok", message => received.push(`ok:${message}`));
    client.on("err", message => received.push(`err:${message}`));

    client.emit("watch:start", "m1");
    client.emit("match:testControl", "m1");
    await new Promise(resolve => setTimeout(resolve, 50));

    client.emit("watch:leave", "m1");
    client.emit("match:testControl", "m1");
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.deepEqual(received, ["err:blocked", "ok:allowed"]);

    client.close();
    await io.close();
    if (httpServer.listening) {
      await new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    }
  });
});
