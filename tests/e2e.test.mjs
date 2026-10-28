// End-to-end tests for Agent Team Chat.
//
// Boots the real production server (`next start`) against a throwaway
// PostgreSQL database and exercises the HTTP API exactly as the browser does:
// access-code join (valid / invalid / rate-limited), admin code creation,
// posting in two channels, reactions, pins, board moves, daily updates,
// admin authorization, and session revocation.
//
// Needs a reachable PostgreSQL. By default it uses a local scratch database
// (role/password/database all "atc" — see README); point TEST_DATABASE_URL
// at any other throwaway Postgres database to override. The schema is
// force-reset before the run, so NEVER point this at production data.
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
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://atc:atc_local_pw@127.0.0.1:5432/agent_team_chat_test";

const serverEnv = {
  ...process.env,
  DATABASE_URL: TEST_DATABASE_URL,
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
  // Fresh test database: (re)create the schema and wipe any existing data.
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--force-reset"], {
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

/** Like client(), but returns the raw fetch Response (bytes + headers). */
function rawClient(ip) {
  const jar = new Map();
  return async function callRaw(method, url, body) {
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
    return res;
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

test("channel history windows: latest default, before-cursor, after-cursor", async () => {
  // Dedicated channel so its windows are exact and isolated.
  const chRes = await owner("POST", "/api/channels", {
    name: "history-test",
    topic: "window tests",
  });
  assert.equal(chRes.status, 201);
  const chId = chRes.json.channel.id;

  let lastPostedId = 0;
  for (let i = 1; i <= 12; i++) {
    const m = await owner("POST", `/api/channels/${chId}/messages`, { body: `history ${i}` });
    assert.equal(m.status, 201);
    lastPostedId = m.json.message.id;
  }

  // Ground truth: the whole channel (12 posts + channel-created system note),
  // ascending, ending at the last posted message.
  const all = await owner("GET", `/api/channels/${chId}/messages`);
  assert.equal(all.status, 200);
  const allIds = all.json.messages.map((m) => m.id);
  assert.ok(allIds.length >= 12);
  assert.equal(allIds[allIds.length - 1], lastPostedId);
  assert.ok(allIds.every((v, i) => i === 0 || allIds[i - 1] < v), "default page is ascending");

  // (a) A limited default GET returns the LATEST window, not the first one.
  const latest = await owner("GET", `/api/channels/${chId}/messages?limit=5`);
  assert.deepEqual(latest.json.messages.map((m) => m.id), allIds.slice(-5));

  // (b) ?before returns the window CLOSEST below the cursor, ascending.
  const cursor = allIds[allIds.length - 5];
  const older = await owner("GET", `/api/channels/${chId}/messages?before=${cursor}&limit=5`);
  assert.deepEqual(older.json.messages.map((m) => m.id), allIds.slice(-10, -5));
  // One more hop up reaches the head of the channel.
  const head = await owner(
    "GET",
    `/api/channels/${chId}/messages?before=${allIds[allIds.length - 10]}&limit=5`
  );
  assert.deepEqual(head.json.messages.map((m) => m.id), allIds.slice(0, allIds.length - 10));

  // (c) ?after returns only newer messages.
  const none = await owner("GET", `/api/channels/${chId}/messages?after=${lastPostedId}`);
  assert.deepEqual(none.json.messages, []);
  const newer = await owner("GET", `/api/channels/${chId}/messages?after=${allIds[7]}`);
  assert.deepEqual(newer.json.messages.map((m) => m.id), allIds.slice(8));
});

test("attachments: image-only message, byte download, text file, oversize, auth", async () => {
  // 1x1 transparent PNG.
  const PNG_B64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const pngBytes = Buffer.from(PNG_B64, "base64");

  const raw = rawClient("10.0.0.77");
  const join = await raw("POST", "/api/auth/join", { code: memberCode });
  assert.equal(join.status, 200);
  await join.arrayBuffer().catch(() => null);

  // (a) A message with ONLY an image attachment (no body) is accepted, and
  // its DTO carries attachment metadata — never the bytes.
  const posted = await owner("POST", `/api/channels/${generalId}/messages`, {
    attachment: { filename: "dot.png", mimeType: "image/png", dataBase64: PNG_B64 },
  });
  assert.equal(posted.status, 201);
  assert.equal(posted.json.message.body, "");
  const att = posted.json.message.attachment;
  assert.ok(att, "DTO carries attachment metadata");
  assert.equal(att.filename, "dot.png");
  assert.equal(att.mimeType, "image/png");
  assert.equal(att.size, pngBytes.length);
  assert.equal(att.data, undefined);
  assert.equal(att.dataBase64, undefined);

  // The channel message list carries the same metadata.
  const feed = await owner("GET", `/api/channels/${generalId}/messages`);
  const listed = feed.json.messages.find((m) => m.id === posted.json.message.id);
  assert.equal(listed.attachment.id, att.id);

  // (b) The attachment downloads byte-for-byte, inline for images.
  const dl = await raw("GET", `/api/attachments/${att.id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-type") || "", /image\/png/);
  assert.match(dl.headers.get("content-disposition") || "", /inline/);
  const got = Buffer.from(await dl.arrayBuffer());
  assert.ok(got.equals(pngBytes), "downloaded bytes match the uploaded PNG");

  // (c) A text file WITH a body keeps both; non-image types download.
  const note = Buffer.from("hello team — attachment note", "utf8");
  const posted2 = await owner("POST", `/api/channels/${generalId}/messages`, {
    body: "See the attached note",
    attachment: { filename: "note.txt", mimeType: "text/plain", dataBase64: note.toString("base64") },
  });
  assert.equal(posted2.status, 201);
  assert.equal(posted2.json.message.body, "See the attached note");
  const att2 = posted2.json.message.attachment;
  assert.equal(att2.filename, "note.txt");
  const dl2 = await raw("GET", `/api/attachments/${att2.id}`);
  assert.equal(dl2.status, 200);
  assert.match(dl2.headers.get("content-disposition") || "", /^attachment/);
  assert.ok(Buffer.from(await dl2.arrayBuffer()).equals(note));

  // (d) Over the 3 MB cap → 4xx, nothing stored.
  const big = Buffer.alloc(3 * 1024 * 1024 + 1, 7).toString("base64");
  const tooBig = await owner("POST", `/api/channels/${generalId}/messages`, {
    body: "too big",
    attachment: { filename: "big.bin", mimeType: "application/octet-stream", dataBase64: big },
  });
  assert.ok(
    tooBig.status >= 400 && tooBig.status < 500,
    `oversize rejected with a 4xx, got ${tooBig.status}`
  );

  // (e) Downloads require a signed-in seat; unknown ids 404.
  const anon = await fetch(`${BASE}/api/attachments/${att.id}`);
  assert.equal(anon.status, 401);
  const missing = await raw("GET", "/api/attachments/99999999");
  assert.equal(missing.status, 404);
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
