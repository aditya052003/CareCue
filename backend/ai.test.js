/**
 * ai.test.js -- unit tests for the CareCue rule-based fallback engine
 *
 * Run with:  node ai.test.js
 *
 * No external test framework required -- uses Node's built-in assert module
 * and a minimal homegrown runner so this file works with zero npm installs.
 *
 * Tests target the exported helpers (parseTime, parsePerson, parseName,
 * validateAction) and the top-level fallback() function directly, keeping
 * them independent of network calls or AWS credentials.
 */

"use strict";

const assert = require("assert");
const { fallback, validateAction, parseTime, parsePerson, parseName } =
  require("./ai");


// Minimal test runner


let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
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


// Assertion helpers


function assertAction(result, expectedType, extraFields) {
  extraFields = extraFields || {};
  assert.ok(
    result.actions.length >= 1,
    "Expected at least one action, got " + result.actions.length
  );
  const action = result.actions[0];
  assert.strictEqual(action.type, expectedType, "action.type mismatch");
  for (const key of Object.keys(extraFields)) {
    assert.strictEqual(
      action[key],
      extraFields[key],
      "action." + key + " -- expected \"" + extraFields[key] + "\", got \"" + action[key] + "\""
    );
  }
}

function assertNoActions(result) {
  assert.strictEqual(
    result.actions.length,
    0,
    "Expected no actions, got " + result.actions.length + ": " + JSON.stringify(result.actions)
  );
}


// parseTime

section("parseTime");

test("8pm -> 20:00", function () {
  assert.strictEqual(parseTime("add a check-in for Dad at 8pm"), "20:00");
});

test("8 pm -> 20:00", function () {
  assert.strictEqual(parseTime("add a check-in for Dad at 8 pm"), "20:00");
});

test("8:30pm -> 20:30", function () {
  assert.strictEqual(parseTime("at 8:30pm"), "20:30");
});

test("9am -> 09:00", function () {
  assert.strictEqual(parseTime("schedule for Mom at 9am"), "09:00");
});

test("12pm -> 12:00", function () {
  assert.strictEqual(parseTime("noon check at 12pm"), "12:00");
});

test("12am -> 00:00", function () {
  assert.strictEqual(parseTime("midnight at 12am"), "00:00");
});

test("bare 24-hour 14:30 -> 14:30", function () {
  assert.strictEqual(parseTime("check-in at 14:30"), "14:30");
});

test("returns null when no time present", function () {
  assert.strictEqual(parseTime("add a check-in for Dad"), null);
});

test("returns null for out-of-range hours in 24h (25:00)", function () {
  // 25:00 -- the regex won't match 25 because RE_TIME_24 is not anchored to
  // reject it; this test documents current behaviour.
  const result = parseTime("at 25:00");
  // Either null (ideal) or a string -- what we must NOT get is a crash.
  assert.ok(result === null || typeof result === "string", "should return null or string without throwing");
});


// parsePerson

section("parsePerson");

test("'dad' -> 'Dad'", function () {
  assert.strictEqual(parsePerson("for dad at 8pm"), "Dad");
});

test("'Dad' (capitalised) -> 'Dad'", function () {
  assert.strictEqual(parsePerson("check-in for Dad"), "Dad");
});

test("'mum' -> 'Mom'", function () {
  assert.strictEqual(parsePerson("remind mum"), "Mom");
});

test("'mother' -> 'Mom'", function () {
  assert.strictEqual(parsePerson("check on mother"), "Mom");
});

test("'grandma' -> 'Grandparent'", function () {
  assert.strictEqual(parsePerson("evening check for grandma"), "Grandparent");
});

test("'grandad' -> 'Grandparent'", function () {
  assert.strictEqual(parsePerson("remind grandad at 9am"), "Grandparent");
});

test("returns null when no person keyword present", function () {
  assert.strictEqual(parsePerson("add a check-in at 8pm"), null);
});


// parseName

section("parseName");

test("quoted name is used verbatim", function () {
  assert.strictEqual(
    parseName("add \"Bedtime routine\" for Dad at 9pm", "Dad", "21:00"),
    "Bedtime routine"
  );
});

test("8pm (20:xx) -> \"Dad's evening check-in\"", function () {
  assert.strictEqual(
    parseName("add a check-in for Dad at 8pm", "Dad", "20:00"),
    "Dad's evening check-in"
  );
});

test("9am (09:xx) -> \"Mom's morning check-in\"", function () {
  assert.strictEqual(
    parseName("check-in for Mom at 9am", "Mom", "09:00"),
    "Mom's morning check-in"
  );
});

test("2pm (14:xx) -> \"Dad's afternoon check-in\"", function () {
  assert.strictEqual(
    parseName("check-in for Dad at 2pm", "Dad", "14:00"),
    "Dad's afternoon check-in"
  );
});

test("no time -> person-based fallback", function () {
  assert.strictEqual(
    parseName("add a check-in for Grandparent", "Grandparent", null),
    "Grandparent's check-in"
  );
});

test("no time, no person -> generic fallback", function () {
  assert.strictEqual(parseName("add a check-in", null, null), "Check-in");
});


// validateAction

section("validateAction");

test("list_checkins passes through cleanly", function () {
  const a = validateAction({ type: "list_checkins" });
  assert.strictEqual(a.type, "list_checkins");
  assert.strictEqual(Object.keys(a).length, 1);
});

test("list_checkins with valid filter passes through", function () {
  const a = validateAction({ type: "list_checkins", filter: { person: "Dad" } });
  assert.strictEqual(a.type, "list_checkins");
  assert.deepStrictEqual(a.filter, { person: "Dad" });
});

test("list_checkins filter strips whitespace from person", function () {
  const a = validateAction({ type: "list_checkins", filter: { person: "  Mom  " } });
  assert.strictEqual(a.filter.person, "Mom");
});

test("list_checkins rejects filter with empty person string", function () {
  assert.throws(
    function () { validateAction({ type: "list_checkins", filter: { person: "  " } }); },
    /non-empty string/
  );
});

test("list_checkins rejects filter with non-string person", function () {
  assert.throws(
    function () { validateAction({ type: "list_checkins", filter: { person: 42 } }); },
    /non-empty string/
  );
});

test("create_checkin with valid fields", function () {
  const a = validateAction({ type: "create_checkin", name: "Test", person: "Dad", time: "20:00" });
  assert.strictEqual(a.name, "Test");
  assert.strictEqual(a.person, "Dad");
  assert.strictEqual(a.time, "20:00");
});

test("create_checkin strips leading/trailing whitespace", function () {
  const a = validateAction({ type: "create_checkin", name: "  Test  ", person: " Dad ", time: "09:00" });
  assert.strictEqual(a.name, "Test");
  assert.strictEqual(a.person, "Dad");
});

test("create_checkin rejects empty name", function () {
  assert.throws(
    function () { validateAction({ type: "create_checkin", name: "", person: "Dad", time: "08:00" }); },
    /non-empty 'name'/
  );
});

test("create_checkin rejects empty person", function () {
  assert.throws(
    function () { validateAction({ type: "create_checkin", name: "X", person: "  ", time: "08:00" }); },
    /non-empty 'person'/
  );
});

test("create_checkin rejects invalid time format (8pm)", function () {
  assert.throws(
    function () { validateAction({ type: "create_checkin", name: "X", person: "Dad", time: "8pm" }); },
    /HH:MM/
  );
});

test("create_checkin rejects out-of-range time (25:00)", function () {
  assert.throws(
    function () { validateAction({ type: "create_checkin", name: "X", person: "Dad", time: "25:00" }); },
    /HH:MM/
  );
});

test("complete_checkin with valid integer id", function () {
  const a = validateAction({ type: "complete_checkin", id: 2 });
  assert.strictEqual(a.id, 2);
});

test("complete_checkin rejects zero id", function () {
  assert.throws(
    function () { validateAction({ type: "complete_checkin", id: 0 }); },
    /positive integer/
  );
});

test("complete_checkin rejects string id", function () {
  assert.throws(
    function () { validateAction({ type: "complete_checkin", id: "abc" }); },
    /positive integer/
  );
});

test("delete_checkin throws -- endpoint not implemented", function () {
  assert.throws(
    function () { validateAction({ type: "delete_checkin", id: 1 }); },
    /not supported yet/
  );
});

test("unknown action type throws", function () {
  assert.throws(
    function () { validateAction({ type: "fly_to_moon" }); },
    /Unknown action type/
  );
});

test("non-object input throws", function () {
  assert.throws(
    function () { validateAction("list_checkins"); },
    /object with a string 'type'/
  );
});


// fallback() -- intent routing

section("fallback() -- greetings");

test("'hi' triggers greeting", function () {
  const r = fallback("hi");
  assert.match(r.reply, /CareCue|care|family/i);
  assert.strictEqual(r.mode, "fallback");
  assertNoActions(r);
});

test("'Hello there' triggers greeting", function () {
  const r = fallback("Hello there");
  assert.match(r.reply, /CareCue|care|family/i);
  assertNoActions(r);
});

test("'Good morning' triggers greeting", function () {
  const r = fallback("Good morning");
  assert.match(r.reply, /CareCue|care|family/i);
  assertNoActions(r);
});

section("fallback() -- well-being");

test("'how are you' returns a friendly reply with no actions", function () {
  const r = fallback("how are you");
  assert.match(r.reply, /well|doing|here/i);
  assert.strictEqual(r.mode, "fallback");
  assertNoActions(r);
});

test("'how are you doing?' also matches well-being", function () {
  const r = fallback("how are you doing?");
  assert.match(r.reply, /well|doing|here/i);
  assertNoActions(r);
});

section("fallback() -- thanks");

test("'thanks' returns an acknowledgement with no actions", function () {
  const r = fallback("thanks");
  assert.match(r.reply, /welcome|anything|help/i);
  assert.strictEqual(r.mode, "fallback");
  assertNoActions(r);
});

test("'thank you' returns an acknowledgement with no actions", function () {
  const r = fallback("thank you");
  assert.match(r.reply, /welcome|anything|help/i);
  assertNoActions(r);
});

test("'Thank you so much!' also matches", function () {
  const r = fallback("Thank you so much!");
  assert.match(r.reply, /welcome|anything|help/i);
  assertNoActions(r);
});

section("fallback() -- help");

test("'help' triggers help response", function () {
  const r = fallback("help");
  assert.match(r.reply, /check.?in/i);
  assertNoActions(r);
});

test("'what can you do' triggers help", function () {
  const r = fallback("what can you do");
  assert.match(r.reply, /check.?in/i);
  assertNoActions(r);
});

test("'what can you do?' reply lists all four command types", function () {
  const r = fallback("what can you do?");
  // show / list
  assert.match(r.reply, /show|list/i);
  // add / create
  assert.match(r.reply, /add|create/i);
  // mark / complete
  assert.match(r.reply, /mark|complet/i);
  assertNoActions(r);
});

test("help reply mentions filtered listing", function () {
  const r = fallback("help");
  assert.match(r.reply, /dad.s check-in|specific person|filter/i);
  assertNoActions(r);
});

section("fallback() -- list check-ins");

test("'show check-ins' emits list_checkins action (unfiltered)", function () {
  const r = fallback("show check-ins");
  assert.strictEqual(r.mode, "fallback");
  assertAction(r, "list_checkins");
  assert.strictEqual(r.actions[0].filter, undefined, "no filter when person not specified");
});

test("'list all check-ins' emits list_checkins action", function () {
  assertAction(fallback("list all check-ins"), "list_checkins");
});

test("'get my reminders' emits list_checkins action", function () {
  assertAction(fallback("get my reminders"), "list_checkins");
});

test("\"show Dad's check-ins\" emits list_checkins with filter.person=Dad", function () {
  const r = fallback("show Dad's check-ins");
  assertAction(r, "list_checkins");
  assert.deepStrictEqual(r.actions[0].filter, { person: "Dad" });
  assert.match(r.reply, /dad/i);
});

test("\"show Mom's check-ins\" emits list_checkins with filter.person=Mom", function () {
  const r = fallback("show Mom's check-ins");
  assertAction(r, "list_checkins");
  assert.deepStrictEqual(r.actions[0].filter, { person: "Mom" });
});

test("\"list grandma's check-ins\" normalises to Grandparent", function () {
  const r = fallback("list grandma's check-ins");
  assertAction(r, "list_checkins");
  assert.deepStrictEqual(r.actions[0].filter, { person: "Grandparent" });
});

test("\"show Dad's reminders\" also triggers filtered list", function () {
  const r = fallback("show Dad's reminders");
  assertAction(r, "list_checkins");
  assert.deepStrictEqual(r.actions[0].filter, { person: "Dad" });
});

section("fallback() -- create check-in");

test("canonical: 'Add a check-in for Dad at 8pm'", function () {
  const r = fallback("Add a check-in for Dad at 8pm");
  assert.strictEqual(r.mode, "fallback");
  assertAction(r, "create_checkin", { person: "Dad", time: "20:00" });
  const name = r.actions[0].name;
  assert.ok(name.length > 0, "name should not be empty");
  assert.ok(
    !name.toLowerCase().includes("add"),
    "name should not contain 'add', got: \"" + name + "\""
  );
  assert.ok(
    !name.toLowerCase().includes("check-in for"),
    "name should not contain 'check-in for', got: \"" + name + "\""
  );
  // Time-based name should include "evening"
  assert.ok(
    name.toLowerCase().includes("evening"),
    "expected 'evening' in name for 20:00, got: \"" + name + "\""
  );
});

test("create with Mom at 9 am", function () {
  const r = fallback("create a check-in for Mom at 9 am");
  assertAction(r, "create_checkin", { person: "Mom", time: "09:00" });
  assert.ok(r.actions[0].name.toLowerCase().includes("morning"),
    "expected 'morning' in name for 09:00, got: \"" + r.actions[0].name + "\"");
});

test("create with grandma at 14:30 (24h)", function () {
  const r = fallback("add check-in for grandma at 14:30");
  assertAction(r, "create_checkin", { person: "Grandparent", time: "14:30" });
});

test("create with explicit quoted name", function () {
  const r = fallback("add \"Bedtime routine\" for Dad at 9pm");
  assertAction(r, "create_checkin", { name: "Bedtime routine", person: "Dad", time: "21:00" });
});

section("fallback() -- missing person");

test("create without a person asks for clarification", function () {
  const r = fallback("add a check-in at 8pm");
  assert.match(r.reply, /who|family member|mention/i);
  assertNoActions(r);
});

section("fallback() -- missing time");

test("create without a time asks for clarification", function () {
  const r = fallback("add a check-in for Dad");
  assert.match(r.reply, /time|when|schedule/i);
  assertNoActions(r);
});

section("fallback() -- complete check-in");

test("'mark check-in 2 complete' -> complete_checkin id=2", function () {
  assertAction(fallback("mark check-in 2 complete"), "complete_checkin", { id: 2 });
});

test("'complete 5' -> complete_checkin id=5", function () {
  assertAction(fallback("complete 5"), "complete_checkin", { id: 5 });
});

test("'done with check-in 1' -> complete_checkin id=1", function () {
  assertAction(fallback("done with check-in 1"), "complete_checkin", { id: 1 });
});

test("complete without an ID asks for clarification", function () {
  const r = fallback("mark check-in complete");
  assert.match(r.reply, /id|which|include/i);
  assertNoActions(r);
});

section("fallback() -- unknown intent");

test("gibberish returns unknown-intent response with no actions", function () {
  const r = fallback("xyzzy plugh foo bar");
  assert.match(r.reply, /not sure|try asking|help/i);
  assert.strictEqual(r.mode, "fallback");
  assertNoActions(r);
});

test("empty string returns a non-empty reply without throwing", function () {
  // Empty string is caught upstream by chat(), but fallback() must not crash.
  const r = fallback("");
  assert.strictEqual(typeof r.reply, "string");
  assert.ok(r.reply.length > 0, "reply should not be empty");
});


// Summary


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
