// End-to-end tests for Agent Team Chat.
//
// Boots the real production server (`next start`) against a throwaway
// SQLite database and exercises the HTTP API exactly as the browser does:
// access-code join (valid / invalid / rate-limited), admin code creation,
// posting in two channels, reactions, pins, board moves, daily updates,
// admin authorization, and session revocation.
//
// Run:  npm run build && npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.TEST_PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER_CODE = "test-owner-code-1234";

const serverEnv = {
  ...process.env,
  DATABASE_URL: "file:./test.db",
  SESSION_SECRET: "test-secret-for-e2e-only-0123456789",
  INITIAL_OWNER_CODE: OWNER_CODE,
  OWNER_NAME: "Nahid",
  COOKIE_INSECURE: "1",
  CHECKPOINT_DISABLE: "1",
};

let server;

function prismaCliEnv() {
  // In restricted sandboxes the Prisma engines may need explicit paths;
  // on a normal machine these are simply unset and unused.
  const env = { ...serverEnv };
  const enginesDir = path.join(root, "node_modules", "@prisma", "engines");
  const lib = fs
    .readdirSync(enginesDir)
    .find((f) => f.startsWith("libquery_engine") && f.endsWith(".so.node"));
  const schemaBin = fs
    .readdirSync(enginesDir)
    .find((f) => f.startsWith("schema-engine") && !f.endsWith(".gz"));
  if (lib) env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(enginesDir, lib);
  if (schemaBin) env.PRISMA_SCHEMA_ENGINE_BINARY = path.join(enginesDir, schemaBin);
  return env;
}

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/join`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not come up in time");
}

before(async () => {
  // Fresh test database
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(path.join(root, "prisma", `test.db${suffix}`), { force: true });
  }
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    cwd: root,
    env: prismaCliEnv(),
    stdio: "pipe",
  });
  server = spawn(
    "node",
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)],
    { cwd: root, env: serverEnv, stdio: "pipe" }
  );
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();
});

after(() => {
  if (server) server.kill("SIGTERM");
});

/** Minimal cookie-jar fetch client, one jar per "person". */
function client(ip) {
  const jar = new Map();
  return async function call(method, url, body) {
    const headers = { "x-forwarded-for": ip };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers["Cookie"] = cookie;
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = sc.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, json };
  };
}

const owner = client("10.0.0.2");
const member = client("10.0.0.3");
let memberCode = "";
let generalId, planningId;
let ownerMsgId, memberMsgId, cardId;

test("unauthenticated requests are rejected", async () => {
  const anon = client("10.0.0.50");
  const res = await anon("GET", "/api/channels");
  assert.equal(res.status, 401);
});

test("wrong access code is rejected", async () => {
  const c = client("10.0.0.1");
  const res = await c("POST", "/api/auth/join", { code: "NOPE-XXXX-XXXX" });
  assert.equal(res.status, 401);
});

test("rate limit locks an IP out after 5 failed attempts", async () => {
  const c = client("10.0.0.9");
  for (let i = 0; i < 5; i++) {
    const res = await c("POST", "/api/auth/join", { code: `WRONG-${i}` });
    assert.equal(res.status, 401);
  }
  // Even the CORRECT code is refused while locked out.
  const locked = await c("POST", "/api/auth/join", { code: OWNER_CODE });
  assert.equal(locked.status, 429);
});

test("owner joins with the seeded owner code", async () => {
  const res = await owner("POST", "/api/auth/join", { code: OWNER_CODE });
  assert.equal(res.status, 200);
  assert.equal(res.json.seat.role, "Owner");
  assert.equal(res.json.seat.name, "Nahid");
  const me = await owner("GET", "/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.json.seat.role, "Owner");
});

test("owner creates a member seat + code; code is shown once", async () => {
  const res = await owner("POST", "/api/admin/codes", {
    name: "Rahim's Muse",
    kind: "agent",
    role: "Member",
  });
  assert.equal(res.status, 201);
  assert.ok(res.json.code && res.json.code.length >= 8);
  memberCode = res.json.code;
});

test("member joins with the created code", async () => {
  const res = await member("POST", "/api/auth/join", { code: memberCode });
  assert.equal(res.status, 200);
  assert.equal(res.json.seat.name, "Rahim's Muse");
  assert.equal(res.json.seat.kind, "agent");
});

test("non-owner is denied admin access", async () => {
  const overview = await member("GET", "/api/admin/overview");
  assert.equal(overview.status, 403);
  const create = await member("POST", "/api/admin/codes", { name: "Sneaky", kind: "human" });
  assert.equal(create.status, 403);
  const okOverview = await owner("GET", "/api/admin/overview");
  assert.equal(okOverview.status, 200);
  assert.ok(okOverview.json.seats.length >= 2);
});

test("posting messages in two channels works and is shared", async () => {
  const ch = await owner("GET", "/api/channels");
  assert.equal(ch.status, 200);
  generalId = ch.json.channels.find((c) => c.slug === "general").id;
  planningId = ch.json.channels.find((c) => c.slug === "planning").id;

  const m1 = await owner("POST", `/api/channels/${generalId}/messages`, {
    body: "Hello team — first message from the owner.",
  });
  assert.equal(m1.status, 201);
  ownerMsgId = m1.json.message.id;

  const m2 = await member("POST", `/api/channels/${planningId}/messages`, {
    body: "Planning idea: build a tiny arcade game together.",
  });
  assert.equal(m2.status, 201);
  memberMsgId = m2.json.message.id;

  const feed = await member("GET", `/api/channels/${generalId}/messages`);
  assert.ok(feed.json.messages.some((m) => m.id === ownerMsgId));
  // system join message exists too
  assert.ok(feed.json.messages.some((m) => m.kind === "system"));
});

test("reactions toggle on and off", async () => {
  const on = await member("POST", `/api/messages/${ownerMsgId}/react`, { emoji: "🔥" });
  assert.equal(on.status, 200);
  const r = on.json.message.reactions.find((x) => x.emoji === "🔥");
  assert.equal(r.count, 1);
  assert.equal(r.mine, true);
  const off = await member("POST", `/api/messages/${ownerMsgId}/react`, { emoji: "🔥" });
  const r2 = off.json.message.reactions.find((x) => x.emoji === "🔥");
  assert.equal(r2, undefined);
});

test("pinning a message puts it in the Decisions view", async () => {
  const pin = await owner("POST", `/api/messages/${memberMsgId}/pin`);
  assert.equal(pin.status, 200);
  assert.equal(pin.json.message.pinned, true);
  const pins = await owner("GET", "/api/pins");
  assert.ok(pins.json.pins.some((p) => p.id === memberMsgId));
});

test("board card create + move persists", async () => {
  const created = await member("POST", "/api/board", {
    title: "Tiny arcade game",
    description: "A small browser game the team builds together.",
  });
  assert.equal(created.status, 201);
  cardId = created.json.card.id;
  assert.equal(created.json.card.column, "idea");

  const moved = await owner("PATCH", `/api/board/${cardId}`, { column: "discussing" });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.card.column, "discussing");

  const board = await owner("GET", "/api/board");
  const found = board.json.cards.find((c) => c.id === cardId);
  assert.equal(found.column, "discussing");
  assert.equal(found.proposedBy.name, "Rahim's Muse");
});

test("daily update posts and lists", async () => {
  const posted = await member("POST", "/api/updates", {
    body: "Day 1: team room is live, first idea on the board.",
  });
  assert.equal(posted.status, 201);
  const list = await owner("GET", "/api/updates");
  assert.ok(list.json.updates.some((u) => u.id === posted.json.update.id));
});

test("owner can assign the Leader badge", async () => {
  const overview = await owner("GET", "/api/admin/overview");
  const memberSeat = overview.json.seats.find((s) => s.name === "Rahim's Muse");
  const res = await owner("POST", `/api/admin/seats/${memberSeat.id}`, { action: "make_leader" });
  assert.equal(res.status, 200);
  const meRes = await member("GET", "/api/auth/me");
  assert.equal(meRes.json.seat.role, "Leader");
});

test("revoking a member's sessions signs them out", async () => {
  const overview = await owner("GET", "/api/admin/overview");
  const memberSeat = overview.json.seats.find((s) => s.name === "Rahim's Muse");
  const res = await owner("POST", `/api/admin/seats/${memberSeat.id}`, {
    action: "revoke_sessions",
  });
  assert.equal(res.status, 200);
  const me = await member("GET", "/api/auth/me");
  assert.equal(me.status, 401);
});
