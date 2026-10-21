"use strict";

const express = require("express");
const cors    = require("cors");
require("dotenv").config();

const { chat }                          = require("./ai");
const { dbGetAll, dbCreate, dbComplete } = require("./db");

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Shared mutation helpers
//
// These are called by both the REST routes and the /api/chat action executor.
// They delegate to db.js so mutations are persisted immediately.
// The return shape is unchanged from the in-memory version so every caller
// (routes, chat executor, existing tests) continues to work without edits.
// ---------------------------------------------------------------------------

/**
 * Create a new check-in and persist it.
 *
 * @param {string} name
 * @param {string} person
 * @param {string} time
 * @returns {{ ok: true, checkIn: object } | { ok: false, status: number, message: string }}
 */
function createCheckIn(name, person, time) {
  if (
    typeof name   !== "string" || !name.trim()   ||
    typeof person !== "string" || !person.trim() ||
    typeof time   !== "string" || !time.trim()
  ) {
    return { ok: false, status: 400, message: "Name, family member, and time are required." };
  }

  try {
    const checkIn = dbCreate(name.trim(), person.trim(), time.trim());
    return { ok: true, checkIn };
  } catch (err) {
    console.error("[createCheckIn] Database error:", err.message);
    return { ok: false, status: 500, message: "Failed to save check-in." };
  }
}

/**
 * Mark an existing check-in as Completed and persist it.
 *
 * @param {number|string} id
 * @returns {{ ok: true, checkIn: object } | { ok: false, status: number, message: string }}
 */
function completeCheckIn(id) {
  try {
    const checkIn = dbComplete(Number(id));
    if (!checkIn) {
      return { ok: false, status: 404, message: "Check-in not found." };
    }
    return { ok: true, checkIn };
  } catch (err) {
    console.error("[completeCheckIn] Database error:", err.message);
    return { ok: false, status: 500, message: "Failed to update check-in." };
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({ message: "CareCue backend is running!", status: "OK" });
});

// ---------------------------------------------------------------------------
// GET /api/checkins  -- list all check-ins
// ---------------------------------------------------------------------------

app.get("/api/checkins", (req, res) => {
  try {
    res.json(dbGetAll());
  } catch (err) {
    console.error("[GET /api/checkins] Database error:", err.message);
    res.status(500).json({ message: "Failed to load check-ins." });
  }
});

// ---------------------------------------------------------------------------
// POST /api/checkins  -- create a check-in
// ---------------------------------------------------------------------------

app.post("/api/checkins", (req, res) => {
  const { name, person, time } = req.body;
  const result = createCheckIn(name, person, time);

  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }

  res.status(201).json({ message: "Check-in created successfully.", checkIn: result.checkIn });
});

// ---------------------------------------------------------------------------
// PATCH /api/checkins/:id/complete  -- mark a check-in as completed
// ---------------------------------------------------------------------------

app.patch("/api/checkins/:id/complete", (req, res) => {
  const result = completeCheckIn(req.params.id);

  if (!result.ok) {
    return res.status(result.status).json({ message: result.message });
  }

  res.json({ message: "Check-in completed successfully.", checkIn: result.checkIn });
});

// ---------------------------------------------------------------------------
// POST /api/chat  -- conversational assistant endpoint
//
// Request body:  { "message": "<user text>" }
//
// Response body:
// {
//   "reply":   "<assistant text>",
//   "mode":    "bedrock" | "fallback",
//   "results": [
//     { "action": "list_checkins",    "checkIns": [...] }
//     { "action": "create_checkin",   "checkIn": {...} }
//     { "action": "complete_checkin", "checkIn": {...} }
//     { "action": "...", "error": "<message>" }
//   ]
// }
// ---------------------------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const { message } = req.body ?? {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      message: "Request body must contain a non-empty \"message\" string.",
    });
  }

  // Pass a snapshot of current check-ins for Bedrock grounding context.
  let currentCheckIns;
  try {
    currentCheckIns = dbGetAll();
  } catch (err) {
    console.error("[/api/chat] Failed to load check-ins for context:", err.message);
    currentCheckIns = [];
  }

  let aiResult;
  try {
    aiResult = await chat(message.trim(), currentCheckIns);
  } catch (err) {
    console.error("[/api/chat] Unexpected error from chat():", err);
    return res.status(500).json({ message: "Internal error processing your request." });
  }

  const results = [];

  for (const action of aiResult.actions) {
    switch (action.type) {
      case "list_checkins": {
        try {
          const all = dbGetAll();
          const filtered =
            action.filter && action.filter.person
              ? all.filter(
                  (c) => c.person.toLowerCase() === action.filter.person.toLowerCase()
                )
              : all;
          results.push({ action: "list_checkins", checkIns: filtered });
        } catch (err) {
          console.error("[/api/chat] list_checkins DB error:", err.message);
          results.push({ action: "list_checkins", error: "Failed to load check-ins." });
        }
        break;
      }

      case "create_checkin": {
        const r = createCheckIn(action.name, action.person, action.time);
        results.push(
          r.ok
            ? { action: "create_checkin", checkIn: r.checkIn }
            : { action: "create_checkin", error: r.message }
        );
        break;
      }

      case "complete_checkin": {
        const r = completeCheckIn(action.id);
        results.push(
          r.ok
            ? { action: "complete_checkin", checkIn: r.checkIn }
            : { action: "complete_checkin", error: r.message }
        );
        break;
      }

      default:
        results.push({ action: action.type, error: "Action type not handled by server." });
    }
  }

  res.json({ reply: aiResult.reply, mode: aiResult.mode, results });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log("CareCue backend running on http://localhost:" + PORT);
});

// Export for testing (test file points DB_PATH at a temp file before require)
module.exports = { app, server, createCheckIn, completeCheckIn };
