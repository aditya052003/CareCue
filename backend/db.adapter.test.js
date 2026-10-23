"use strict";

/**
 * db.adapter.test.js
 *
 * Adapter-contract tests for server.js.
 *
 * These tests verify that server.js routes behave identically regardless of
 * which storage adapter (SQLite or DynamoDB) is wired in.  They do this by
 * injecting two thin in-memory stub adapters -- one synchronous (mirrors the
 * SQLite adapter) and one async (mirrors the DynamoDB adapter) -- without
 * touching any real database or AWS service.
 *
 * Run with:  node db.adapter.test.js
 *
 * Uses only Node built-ins (http, assert, module, path).
 */

const assert = require("assert");
const http   = require("http");
const Module = require("module");
const path   = require("path");


// Minimal test runner

let passed   = 0;
let failed   = 0;
const failures = [];

async function test(label, fn) {
  try {
    await fn();
    console.log("  pass  " + label);
    passed++;
  } catch (err) {
    console.error("  FAIL  " + label);
    console.error("        " + err.message);
    failures.push({ label, message: err.message });
    failed++;
  }
}

function section(title) {
  console.log("\n" + title);
  console.log("-".repeat(title.length));
}


// HTTP helper (port comes from a live testServer variable set per-suite)


let activePort;

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const options = {
      hostname: "127.0.0.1",
      port:     activePort,
      path:     urlPath,
      method,
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": payload ? Buffer.byteLength(payload) : 0,
      },
    };
    const r = http.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed;
        try   { parsed = JSON.parse(raw); }
        catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}


// In-memory stub adapters
//
// Both expose the same { dbGetAll, dbCreate, dbComplete } interface.
// syncStub returns plain values; asyncStub wraps them in Promises.
// server.js awaits every call, so both must work correctly.


function makeSyncStub() {
  const SEED = [
    { id: 1, name: "Morning check-in",   person: "Dad", time: "09:00 AM", status: "Completed" },
    { id: 2, name: "Afternoon check-in", person: "Dad", time: "02:00 PM", status: "Pending"   },
    { id: 3, name: "Evening check-in",   person: "Mom", time: "07:00 PM", status: "Pending"   },
  ];
  const store = SEED.map((r) => ({ ...r }));

  return {
    dbGetAll()            { return [...store]; },
    dbCreate(n, p, t)     {
      const record = { id: Date.now(), name: n, person: p, time: t, status: "Pending" };
      store.push(record);
      return { ...record };
    },
    dbComplete(id) {
      const item = store.find((r) => r.id === Number(id));
      if (!item) return null;
      item.status = "Completed";
      return { ...item };
    },
  };
}

function makeAsyncStub() {
  const sync = makeSyncStub();
  return {
    async dbGetAll()         { return sync.dbGetAll(); },
    async dbCreate(n, p, t)  { return sync.dbCreate(n, p, t); },
    async dbComplete(id)     { return sync.dbComplete(id); },
  };
}

// App factory
//
// Builds a fresh Express app by loading server.js with its db require
// intercepted.  We patch Module._resolveFilename so that any require of
// the resolved path to db.js or db-dynamodb.js returns our stub instead.
//
// This approach:
//   - Does not mutate require.cache of already-loaded modules
//   - Leaves ai.js, express, etc. unchanged
//   - Is fully reset between the two adapter suites


function buildAppWithStub(stub, label) {
  // Resolve the canonical path that server.js would request.
  const serverDir = path.join(__dirname);
  const dbPath    = path.resolve(serverDir, "db.js");
  const dynPath   = path.resolve(serverDir, "db-dynamodb.js");

  // Save originals.
  const origLoad    = Module._load;

  // Intercept _load to inject the stub for EITHER adapter path.
  Module._load = function (request, parent, isMain) {
    if (parent && parent.filename === path.resolve(__dirname, "server.js")) {
      const resolved = path.resolve(path.dirname(parent.filename), request);
      if (resolved === dbPath || resolved === dynPath ||
          request === "./db" || request === "./db-dynamodb") {
        return stub;
      }
    }
    return origLoad.apply(this, arguments);
  };

  // Evict server.js from the require cache so it re-runs with the interceptor.
  const serverPath = require.resolve("./server");
  delete require.cache[serverPath];

  let appExports;
  try {
    appExports = require("./server");
  } finally {
    // Restore the original loader immediately after require completes.
    Module._load = origLoad;
    // Evict again so subsequent requires start clean.
    delete require.cache[serverPath];
  }

  // Also close the server that server.js auto-starts on require.
  // We'll bind our own test server to port 0 below.
  appExports.server.close();

  return appExports.app;
}


// Shared contract tests
//
// Run against any app instance; expectations are identical for both adapters.


async function runContractTests(label) {
  section(label + " -- health check");

  await test("GET / returns 200 and status OK", async () => {
    const { status, body } = await req("GET", "/");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, "OK");
  });

  section(label + " -- GET /api/checkins");

  await test("returns an array", async () => {
    const { status, body } = await req("GET", "/api/checkins");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body));
  });

  await test("seed data contains 3 records", async () => {
    const { body } = await req("GET", "/api/checkins");
    assert.strictEqual(body.length, 3, "expected 3 seed records, got " + body.length);
  });

  section(label + " -- POST /api/checkins");

  await test("creates a check-in and returns 201", async () => {
    const { status, body } = await req("POST", "/api/checkins", {
      name: "Adapter test check-in", person: "Dad", time: "21:00",
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.checkIn.name,   "Adapter test check-in");
    assert.strictEqual(body.checkIn.person, "Dad");
    assert.strictEqual(body.checkIn.status, "Pending");
    assert.ok(typeof body.checkIn.id === "number", "id should be numeric");
  });

  await test("returns 400 when name is missing", async () => {
    const { status } = await req("POST", "/api/checkins", { person: "Mom", time: "09:00" });
    assert.strictEqual(status, 400);
  });

  await test("returns 400 for empty body", async () => {
    const { status } = await req("POST", "/api/checkins", {});
    assert.strictEqual(status, 400);
  });

  section(label + " -- PATCH /api/checkins/:id/complete");

  await test("marks seed check-in 2 as Completed", async () => {
    const { status, body } = await req("PATCH", "/api/checkins/2/complete");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.checkIn.id,     2);
    assert.strictEqual(body.checkIn.status, "Completed");
  });

  await test("returns 404 for unknown id", async () => {
    const { status } = await req("PATCH", "/api/checkins/99999/complete");
    assert.strictEqual(status, 404);
  });

  section(label + " -- POST /api/chat input validation");

  await test("returns 400 for empty body", async () => {
    assert.strictEqual((await req("POST", "/api/chat", {})).status, 400);
  });

  await test("returns 400 for whitespace-only message", async () => {
    assert.strictEqual((await req("POST", "/api/chat", { message: "  " })).status, 400);
  });

  await test("returns 400 for non-string message", async () => {
    assert.strictEqual((await req("POST", "/api/chat", { message: 99 })).status, 400);
  });

  section(label + " -- POST /api/chat intents");

  await test("greeting: fallback mode, no results", async () => {
    const { status, body } = await req("POST", "/api/chat", { message: "hi" });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.mode, "fallback");
    assert.ok(body.reply.length > 0);
    assert.deepStrictEqual(body.results, []);
  });

  await test("list_checkins action: returns checkIns array", async () => {
    const { status, body } = await req("POST", "/api/chat", { message: "show check-ins" });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.results[0].action, "list_checkins");
    assert.ok(Array.isArray(body.results[0].checkIns));
  });

  await test("create_checkin action: check-in is created with correct fields", async () => {
    const { status, body } = await req("POST", "/api/chat", {
      message: "add a check-in for Mom at 9am",
    });
    assert.strictEqual(status, 200);
    const r = body.results[0];
    assert.strictEqual(r.action, "create_checkin");
    assert.ok(!r.error, "no error expected, got: " + r.error);
    assert.strictEqual(r.checkIn.person, "Mom");
    assert.strictEqual(r.checkIn.time,   "09:00");
    assert.strictEqual(r.checkIn.status, "Pending");
  });

  await test("complete_checkin action: check-in 3 marked complete", async () => {
    const { status, body } = await req("POST", "/api/chat", {
      message: "mark check-in 3 complete",
    });
    assert.strictEqual(status, 200);
    const r = body.results[0];
    assert.strictEqual(r.action, "complete_checkin");
    assert.ok(!r.error);
    assert.strictEqual(r.checkIn.id,     3);
    assert.strictEqual(r.checkIn.status, "Completed");
  });

  await test("complete unknown id: result carries error, HTTP 200", async () => {
    const { status, body } = await req("POST", "/api/chat", {
      message: "complete check-in 99999",
    });
    assert.strictEqual(status, 200);
    assert.ok(body.results[0].error);
  });

  await test("filtered list: 'show Dad's check-ins' returns only Dad", async () => {
    const { status, body } = await req("POST", "/api/chat", {
      message: "show Dad's check-ins",
    });
    assert.strictEqual(status, 200);
    const items = body.results[0].checkIns;
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, "expected at least one Dad record");
    assert.ok(items.every((c) => c.person === "Dad"), "all items should be for Dad");
  });

  await test("unknown intent: no results, suggests help", async () => {
    const { status, body } = await req("POST", "/api/chat", { message: "xyzzy plugh" });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.results, []);
    assert.match(body.reply, /not sure|try asking|help/i);
  });
}


// Run both adapter suites


async function runAll() {
  // ── Suite 1: synchronous stub (SQLite shape)
  {
    const syncLabel = "Sync adapter (SQLite shape)";
    console.log("\n" + "=".repeat(50));
    console.log(syncLabel);
    console.log("=".repeat(50));

    const app1 = buildAppWithStub(makeSyncStub(), syncLabel);
    const srv1 = await new Promise((resolve) => {
      const s = app1.listen(0, "127.0.0.1", () => resolve(s));
    });
    activePort = srv1.address().port;
    console.log("Test server on http://127.0.0.1:" + activePort + "\n");

    try {
      await runContractTests(syncLabel);
    } finally {
      await new Promise((r) => srv1.close(r));
    }
  }

  // ── Suite 2: async stub (DynamoDB shape)
  {
    const asyncLabel = "Async adapter (DynamoDB shape)";
    console.log("\n" + "=".repeat(50));
    console.log(asyncLabel);
    console.log("=".repeat(50));

    const app2 = buildAppWithStub(makeAsyncStub(), asyncLabel);
    const srv2 = await new Promise((resolve) => {
      const s = app2.listen(0, "127.0.0.1", () => resolve(s));
    });
    activePort = srv2.address().port;
    console.log("Test server on http://127.0.0.1:" + activePort + "\n");

    try {
      await runContractTests(asyncLabel);
    } finally {
      await new Promise((r) => srv2.close(r));
    }
  }

  // ── Summary

  console.log("\n" + "=".repeat(50));
  if (failed === 0) {
    console.log("All " + passed + " adapter contract tests passed.");
  } else {
    console.log(passed + " passed, " + failed + " failed.\n");
    for (const f of failures) {
      console.error("  FAILED: " + f.label);
      console.error("          " + f.message);
    }
    process.exitCode = 1;
  }
}

runAll().catch((err) => {
  console.error("Unexpected error:", err);
  process.exitCode = 1;
});
