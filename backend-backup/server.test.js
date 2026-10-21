"use strict";

/**
 * server.test.js -- integration tests for the CareCue REST API
 *
 * Run with:  node server.test.js
 *
 * Uses only Node built-ins (http, assert, fs, path, child_process, os).
 * No extra npm packages required.
 *
 * Isolation strategy
 * ------------------
 * DB_PATH is set to a temp file BEFORE any require() so the database layer
 * never touches carecue.db during test runs.  The temp file is deleted in
 * the finally block.
 *
 * Restart-survival test
 * ---------------------
 * Spawns a second Node process via child_process.spawnSync that shares the
 * same temp DB file, creates a check-in, then verifies it is present in a
 * subsequent fresh process -- proving persistence across restarts.
 *
 * Test coverage
 * -------------
 *   GET  /                            health check
 *   GET  /api/checkins                list (persistent)
 *   POST /api/checkins                create (persistent)
 *   PATCH /api/checkins/:id/complete  complete (persistent)
 *   POST /api/chat                    chat endpoint
 *     400 on missing/empty/non-string message
 *     greeting, help, list, create, complete, filtered list
 *     missing-person and missing-time clarifications
 *     unknown intent
 *   Persistence: check-in survives a backend restart
 */

const assert       = require("assert");
const http         = require("http");
const fs           = require("fs");
const os           = require("os");
const path         = require("path");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------------------
// Point the DB at a temp file BEFORE requiring anything that opens it.
// ---------------------------------------------------------------------------

const TEMP_DB = path.join(os.tmpdir(), "carecue-test-" + Date.now() + ".sqlite");
process.env.DB_PATH = TEMP_DB;

// Now it is safe to load the app.
const { app }        = require("./server");
const { dbClose }    = require("./db");

// ---------------------------------------------------------------------------
// Minimal async test runner
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

let testServer;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const options = {
      hostname: "127.0.0.1",
      port:     testServer.address().port,
      path:     urlPath,
      method,
      headers: {
        "Content-Type":   "application/json",
        "Content-Length": payload ? Buffer.byteLength(payload) : 0,
      },
    };
    const req = http.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed;
        try   { parsed = JSON.parse(raw); }
        catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function runTests() {

  // =========================================================================
  section("Health check");
  // =========================================================================

  await test("GET / returns status OK", async () => {
    const { status, body } = await request("GET", "/");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.status, "OK");
  });

  // =========================================================================
  section("GET /api/checkins");
  // =========================================================================

  await test("returns an array", async () => {
    const { status, body } = await request("GET", "/api/checkins");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body), "body should be an array");
  });

  await test("seed data contains 3 check-ins", async () => {
    const { body } = await request("GET", "/api/checkins");
    assert.strictEqual(body.length, 3, "expected 3 seed records, got " + body.length);
  });

  // =========================================================================
  section("POST /api/checkins");
  // =========================================================================

  await test("creates a check-in and returns 201", async () => {
    const { status, body } = await request("POST", "/api/checkins", {
      name: "Test check-in", person: "Dad", time: "20:00",
    });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.checkIn.name,   "Test check-in");
    assert.strictEqual(body.checkIn.person, "Dad");
    assert.strictEqual(body.checkIn.status, "Pending");
  });

  await test("created check-in is visible in subsequent GET", async () => {
    const { body } = await request("GET", "/api/checkins");
    const found = body.find((c) => c.name === "Test check-in");
    assert.ok(found, "Test check-in should appear in GET /api/checkins");
  });

  await test("returns 400 when name is missing", async () => {
    const { status } = await request("POST", "/api/checkins", { person: "Mom", time: "09:00" });
    assert.strictEqual(status, 400);
  });

  await test("returns 400 when body is empty", async () => {
    const { status } = await request("POST", "/api/checkins", {});
    assert.strictEqual(status, 400);
  });

  // =========================================================================
  section("PATCH /api/checkins/:id/complete");
  // =========================================================================

  await test("marks seed check-in 2 as completed", async () => {
    const { status, body } = await request("PATCH", "/api/checkins/2/complete");
    assert.strictEqual(status, 200);
    assert.strictEqual(body.checkIn.status, "Completed");
    assert.strictEqual(body.checkIn.id,     2);
  });

  await test("completed status persists in subsequent GET", async () => {
    const { body } = await request("GET", "/api/checkins");
    const checkIn2 = body.find((c) => c.id === 2);
    assert.ok(checkIn2, "check-in 2 should exist");
    assert.strictEqual(checkIn2.status, "Completed");
  });

  await test("returns 404 for unknown id", async () => {
    const { status } = await request("PATCH", "/api/checkins/99999/complete");
    assert.strictEqual(status, 404);
  });

  // =========================================================================
  section("POST /api/chat -- input validation");
  // =========================================================================

  await test("returns 400 for empty body", async () => {
    const { status } = await request("POST", "/api/chat", {});
    assert.strictEqual(status, 400);
  });

  await test("returns 400 for empty message string", async () => {
    const { status } = await request("POST", "/api/chat", { message: "   " });
    assert.strictEqual(status, 400);
  });

  await test("returns 400 for non-string message", async () => {
    const { status } = await request("POST", "/api/chat", { message: 42 });
    assert.strictEqual(status, 400);
  });

  // =========================================================================
  section("POST /api/chat -- intents");
  // =========================================================================

  await test("greeting: non-empty reply, fallback mode, no results", async () => {
    const { status, body } = await request("POST", "/api/chat", { message: "hi" });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.mode, "fallback");
    assert.ok(typeof body.reply === "string" && body.reply.length > 0);
    assert.deepStrictEqual(body.results, []);
  });

  await test("help: reply mentions check-in, no results", async () => {
    const { status, body } = await request("POST", "/api/chat", { message: "help" });
    assert.strictEqual(status, 200);
    assert.match(body.reply, /check.?in/i);
    assert.deepStrictEqual(body.results, []);
  });

  await test("list_checkins: results contain a checkIns array", async () => {
    const { status, body } = await request("POST", "/api/chat", { message: "show check-ins" });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.results.length, 1);
    assert.strictEqual(body.results[0].action, "list_checkins");
    assert.ok(Array.isArray(body.results[0].checkIns));
  });

  await test("filtered list: 'show Dad's check-ins' returns only Dad's records", async () => {
    const { status, body } = await request("POST", "/api/chat", { message: "show Dad's check-ins" });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.results[0].action, "list_checkins");
    const items = body.results[0].checkIns;
    assert.ok(Array.isArray(items));
    assert.ok(items.every((c) => c.person === "Dad"), "all items should be for Dad");
  });

  await test("create_checkin via chat: check-in persisted and appears in GET", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "add a check-in for Dad at 8pm",
    });
    assert.strictEqual(status, 200);
    const r = body.results[0];
    assert.strictEqual(r.action, "create_checkin");
    assert.ok(!r.error, "should not have an error");
    assert.strictEqual(r.checkIn.person, "Dad");
    assert.strictEqual(r.checkIn.time,   "20:00");
    assert.strictEqual(r.checkIn.status, "Pending");
    assert.ok(r.checkIn.name.toLowerCase().includes("evening"),
      "expected 'evening' in name, got: \"" + r.checkIn.name + "\"");
    // Confirm persisted
    const list = await request("GET", "/api/checkins");
    assert.ok(list.body.find((c) => c.id === r.checkIn.id), "new check-in should be in DB");
  });

  await test("complete_checkin via chat: check-in 3 marked complete", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "mark check-in 3 complete",
    });
    assert.strictEqual(status, 200);
    const r = body.results[0];
    assert.strictEqual(r.action, "complete_checkin");
    assert.ok(!r.error);
    assert.strictEqual(r.checkIn.id,     3);
    assert.strictEqual(r.checkIn.status, "Completed");
  });

  await test("complete_checkin with unknown ID: result carries error field", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "complete check-in 99999",
    });
    assert.strictEqual(status, 200);
    assert.ok(body.results[0].error, "should have an error for unknown id");
  });

  await test("missing person: no action, clarification reply", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "add a check-in at 8pm",
    });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.results, []);
    assert.match(body.reply, /who|family member|mention/i);
  });

  await test("missing time: no action, clarification reply", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "add a check-in for Dad",
    });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.results, []);
    assert.match(body.reply, /time|when|schedule/i);
  });

  await test("unknown intent: no action, suggests help", async () => {
    const { status, body } = await request("POST", "/api/chat", {
      message: "xyzzy plugh",
    });
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.results, []);
    assert.match(body.reply, /not sure|try asking|help/i);
  });

  // =========================================================================
  section("Persistence -- check-in survives a backend restart");
  // =========================================================================

  await test("record created in process A is readable in a fresh process B", async () => {
    // Step 1: create a uniquely-named check-in in this process via the REST API.
    const uniqueName = "Persistence-test-" + Date.now();
    const createResp = await request("POST", "/api/checkins", {
      name: uniqueName, person: "Mom", time: "10:00",
    });
    assert.strictEqual(createResp.status, 201, "creation should return 201");
    const createdId = createResp.body.checkIn.id;

    // Step 2: close the DB in this process so the WAL is flushed and
    //         the SQLite file is in a consistent state for the child process.
    dbClose();

    // Step 3: spawn a fresh Node process that reads the same DB file and
    //         looks for the record we just created. It exits 0 if found,
    //         non-zero otherwise.
    const probeScript = `
      "use strict";
      process.env.DB_PATH = ${JSON.stringify(TEMP_DB)};
      const { dbGetAll } = require(${JSON.stringify(path.join(__dirname, "db"))});
      const found = dbGetAll().some(c => c.id === ${createdId});
      process.exit(found ? 0 : 1);
    `;

    const result = spawnSync(process.execPath, ["-e", probeScript], {
      encoding: "utf8",
      timeout:  10000,
    });

    assert.strictEqual(
      result.status,
      0,
      "Probe process failed (exit " + result.status + "). " +
      "stderr: " + (result.stderr || "").trim()
    );
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

testServer = app.listen(0, "127.0.0.1", async () => {
  const { port } = testServer.address();
  console.log("Test server on http://127.0.0.1:" + port);
  console.log("Temp DB:      " + TEMP_DB + "\n");

  try {
    await runTests();
  } finally {
    testServer.close(() => {
      // Clean up the temp database file.
      try { fs.unlinkSync(TEMP_DB); } catch { /* already gone */ }
      try { fs.unlinkSync(TEMP_DB + "-wal"); } catch { /* optional WAL file */ }
      try { fs.unlinkSync(TEMP_DB + "-shm"); } catch { /* optional SHM file */ }

      console.log("\n" + "=".repeat(50));
      if (failed === 0) {
        console.log("All " + passed + " tests passed.");
      } else {
        console.log(passed + " passed, " + failed + " failed.\n");
        for (const f of failures) {
          console.error("  FAILED: " + f.label);
          console.error("          " + f.message);
        }
        process.exitCode = 1;
      }
    });
  }
});
