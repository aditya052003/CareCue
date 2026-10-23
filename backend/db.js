"use strict";

/**
 * db.js -- CareCue SQLite persistence layer
 *
 * Uses better-sqlite3 (synchronous API) so callers stay synchronous and
 * the existing route/helper signatures do not change.
 *
 * Database location
 * -----------------
 * Defaults to ./carecue.db relative to the working directory.
 * Set the DB_PATH environment variable to override -- used by tests to
 * point at a temporary file so they never touch the development database.
 *
 * Schema
 * ------
 * Table: checkins
 *   id      INTEGER PRIMARY KEY   -- numeric, matches existing API shape
 *   name    TEXT    NOT NULL
 *   person  TEXT    NOT NULL
 *   time    TEXT    NOT NULL
 *   status  TEXT    NOT NULL DEFAULT 'Pending'
 *
 * Seed data
 * ---------
 * If the table is empty on first startup, the original three seed records
 * are inserted so the app behaves identically to the in-memory version.
 */

const path     = require("path");
const Database = require("better-sqlite3");


// Open / create the database


const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "carecue.db");

let db;

try {
  db = new Database(DB_PATH);
} catch (err) {
  console.error("[CareCue DB] Failed to open database at " + DB_PATH + ":", err.message);
  process.exit(1);
}

// Enable WAL mode for better concurrent read performance.
db.pragma("journal_mode = WAL");


// Schema migration (idempotent)


db.exec(`
  CREATE TABLE IF NOT EXISTS checkins (
    id     INTEGER PRIMARY KEY,
    name   TEXT    NOT NULL,
    person TEXT    NOT NULL,
    time   TEXT    NOT NULL,
    status TEXT    NOT NULL DEFAULT 'Pending'
  );
`);


// Seed data
// Inserted only when the table is empty (i.e. first run).


const SEED = [
  { id: 1, name: "Morning check-in",   person: "Dad", time: "09:00 AM", status: "Completed" },
  { id: 2, name: "Afternoon check-in", person: "Dad", time: "02:00 PM", status: "Pending"   },
  { id: 3, name: "Evening check-in",   person: "Mom", time: "07:00 PM", status: "Pending"   },
];

const isEmpty = db.prepare("SELECT COUNT(*) AS n FROM checkins").get().n === 0;

if (isEmpty) {
  const insertSeed = db.prepare(
    "INSERT INTO checkins (id, name, person, time, status) VALUES (@id, @name, @person, @time, @status)"
  );
  const seedAll = db.transaction((records) => {
    for (const r of records) insertSeed.run(r);
  });
  seedAll(SEED);
  console.log("[CareCue DB] Database created at " + DB_PATH + " and seeded with default check-ins.");
} else {
  console.log("[CareCue DB] Database opened at " + DB_PATH + ".");
}


// Prepared statements


const stmtGetAll    = db.prepare("SELECT * FROM checkins ORDER BY id");
const stmtInsert    = db.prepare(
  "INSERT INTO checkins (id, name, person, time, status) VALUES (@id, @name, @person, @time, @status)"
);
const stmtFindById  = db.prepare("SELECT * FROM checkins WHERE id = ?");
const stmtComplete  = db.prepare("UPDATE checkins SET status = 'Completed' WHERE id = ?");


// Public helpers


/**
 * Return all check-ins ordered by id.
 * @returns {object[]}
 */
function dbGetAll() {
  return stmtGetAll.all();
}

/**
 * Insert a new check-in row and return the full record.
 *
 * @param {string} name
 * @param {string} person
 * @param {string} time
 * @returns {{ id: number, name: string, person: string, time: string, status: string }}
 * @throws {Error} on database error
 */
function dbCreate(name, person, time) {
  const id = Date.now();
  stmtInsert.run({ id, name, person, time, status: "Pending" });
  return { id, name, person, time, status: "Pending" };
}

/**
 * Mark a check-in as Completed and return the updated record,
 * or null if no row with that id exists.
 *
 * @param {number} id
 * @returns {object|null}
 */
function dbComplete(id) {
  const result = stmtComplete.run(id);
  if (result.changes === 0) return null;
  return stmtFindById.get(id);
}

/**
 * Close the database connection (used by tests).
 */
function dbClose() {
  db.close();
}

module.exports = { dbGetAll, dbCreate, dbComplete, dbClose, DB_PATH };
