/**
 * ai.js -- CareCue AI layer
 *
 * Strategy
 * --------
 * 1. If the feature flag CARECUE_USE_BEDROCK=true is set AND the AWS SDK is
 *    installed, call Amazon Bedrock (Claude). Credentials are resolved by the
 *    standard AWS credential provider chain (environment variables,
 *    ~/.aws/credentials, IAM instance role, etc.). No key is ever hardcoded.
 *
 * 2. On any failure -- SDK not installed, flag not set, credentials missing,
 *    API error -- fall back to the deterministic rule-based engine and mark
 *    the response with mode:"fallback" so callers can show a UI badge.
 *
 * Exported API
 * ------------
 * chat(message, context?) -> Promise<ChatResult>
 *
 * ChatResult:
 *   reply:   string         -- natural-language response to show the user
 *   actions: Action[]       -- zero or more validated side-effect descriptors
 *   mode:    "bedrock" | "fallback"
 *
 * Action types (only types whose backend endpoint exists):
 *   { type: "list_checkins" }
 *   { type: "create_checkin", name: string, person: string, time: string }
 *   { type: "complete_checkin", id: number }
 *
 * NOTE: delete_checkin is intentionally absent. The backend DELETE endpoint
 * does not exist yet and has not been tested. It will be added here once the
 * endpoint is live and verified.
 */

"use strict";


// Feature flag


/**
 * Set CARECUE_USE_BEDROCK=true in your environment to opt in to Bedrock.
 * All AWS credentials are handled by the SDK's own provider chain.
 */
const USE_BEDROCK =
  process.env.CARECUE_USE_BEDROCK === "true" ||
  process.env.CARECUE_USE_BEDROCK === "1";


// Optional Bedrock import


let BedrockRuntimeClient = null;
let InvokeModelCommand = null;

if (USE_BEDROCK) {
  try {
    const sdk = require("@aws-sdk/client-bedrock-runtime");
    BedrockRuntimeClient = sdk.BedrockRuntimeClient;
    InvokeModelCommand = sdk.InvokeModelCommand;
    console.log("[CareCue AI] Bedrock SDK loaded -- will use Amazon Bedrock.");
  } catch {
    console.warn(
      "[CareCue AI] CARECUE_USE_BEDROCK is set but @aws-sdk/client-bedrock-runtime" +
        " is not installed. Falling back to rule-based engine."
    );
  }
}


// Action validation


const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate and normalise a raw action object.
 * Returns the clean action or throws a descriptive Error.
 *
 * @param {object} raw
 * @returns {{ type: string } & object}
 */
function validateAction(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    throw new Error("Action must be an object with a string 'type' field.");
  }

  switch (raw.type) {
    case "list_checkins": {
      // Optional filter: { person: string }
      if (raw.filter !== undefined) {
        if (
          typeof raw.filter !== "object" ||
          raw.filter === null ||
          typeof raw.filter.person !== "string" ||
          !raw.filter.person.trim()
        ) {
          throw new Error(
            "list_checkins 'filter.person' must be a non-empty string when filter is provided."
          );
        }
        return { type: "list_checkins", filter: { person: raw.filter.person.trim() } };
      }
      return { type: "list_checkins" };
    }

    case "create_checkin": {
      const name   = typeof raw.name   === "string" ? raw.name.trim()   : "";
      const person = typeof raw.person === "string" ? raw.person.trim() : "";
      const time   = typeof raw.time   === "string" ? raw.time.trim()   : "";

      if (!name)
        throw new Error("create_checkin requires a non-empty 'name'.");
      if (!person)
        throw new Error("create_checkin requires a non-empty 'person'.");
      if (!HH_MM.test(time))
        throw new Error(
          "create_checkin 'time' must be HH:MM (24-hour). Got: \"" + raw.time + "\"."
        );

      return { type: "create_checkin", name, person, time };
    }

    case "complete_checkin": {
      const id = Number(raw.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          "complete_checkin 'id' must be a positive integer. Got: \"" + raw.id + "\"."
        );
      }
      return { type: "complete_checkin", id };
    }

    // Explicitly reject delete_checkin until the backend endpoint exists.
    case "delete_checkin":
      throw new Error(
        "delete_checkin is not supported yet -- the backend DELETE endpoint has not been implemented."
      );

    default:
      throw new Error("Unknown action type: \"" + raw.type + "\".");
  }
}


// Bedrock inference


const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";

const BEDROCK_REGION = process.env.AWS_REGION || "us-east-1";

const SYSTEM_PROMPT = [
  "You are CareCue, a warm and practical family-care assistant.",
  "You help families manage check-ins for elderly or care-dependent relatives.",
  "",
  "Respond ONLY with a JSON object using this exact structure:",
  "{",
  "  \"reply\": \"<friendly natural-language reply>\",",
  "  \"actions\": []",
  "}",
  "",
  "Supported action types (include zero or more):",
  "  { \"type\": \"list_checkins\" }",
  "  { \"type\": \"create_checkin\", \"name\": \"...\", \"person\": \"...\", \"time\": \"HH:MM\" }",
  "  { \"type\": \"complete_checkin\", \"id\": <positive integer> }",
  "",
  "Rules:",
  "- reply is always a warm, concise sentence or two.",
  "- Only emit actions the user explicitly requested.",
  "- If information is missing (e.g. which family member), ask in reply instead of guessing.",
  "- Times must be 24-hour HH:MM. Never fabricate IDs.",
].join("\n");

let _bedrockClientInstance = null;

function getBedrockClient() {
  if (_bedrockClientInstance) return _bedrockClientInstance;
  _bedrockClientInstance = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  return _bedrockClientInstance;
}

async function callBedrock(message, context) {
  const contextBlock =
    context && context.length > 0
      ? "\n\nCurrent check-ins for context:\n" + JSON.stringify(context, null, 2)
      : "";

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 512,
    system: SYSTEM_PROMPT + contextBlock,
    messages: [{ role: "user", content: message }],
  });

  const command = new InvokeModelCommand({
    modelId: BEDROCK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await getBedrockClient().send(command);
  const text =
    JSON.parse(Buffer.from(response.body).toString("utf-8")).content?.[0]?.text ?? "";

  // Extract the first JSON object from the response text.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Bedrock response did not contain a JSON object.");
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (typeof parsed.reply !== "string") {
    throw new Error("Bedrock response missing 'reply' field.");
  }

  const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
  const validatedActions = [];
  for (const raw of rawActions) {
    try {
      validatedActions.push(validateAction(raw));
    } catch (err) {
      console.warn("[CareCue AI] Discarding invalid Bedrock action:", err.message, raw);
    }
  }

  return { reply: parsed.reply, actions: validatedActions, mode: "bedrock" };
}


// Rule-based fallback


// Intent patterns
const RE_GREETING  = /^(hi|hello|hey|good\s+(morning|afternoon|evening)|howdy)\b/i;
const RE_WELLBEING = /\bhow are you\b/i;
const RE_THANKS    = /\b(thanks|thank you|cheers|ty)\b/i;
const RE_HELP      = /\b(help|what can you do|commands|options|how do i)\b/i;
const RE_LIST      = /\b(list|show|get|fetch|display|what are|tell me)\b.*(check.?in|reminder|schedule)/i;
const RE_CREATE    = /\b(add|create|new|schedule|set up|book|remind)\b/i;
const RE_COMPLETE  = /\b(complet|done|finish|mark|check off)/i;

// Field extraction
const RE_ID      = /\b(?:check.?in\s+)?(?:id\s*[:#]?\s*)?(\d+)\b/i;
const RE_TIME_12 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
const RE_TIME_24 = /\b(\d{1,2}):(\d{2})\b/;

// Person keywords -> canonical label
const PERSON_MAP = {
  dad: "Dad", father: "Dad", papa: "Dad",
  mom: "Mom", mum: "Mom", mother: "Mom", mama: "Mom",
  grandma: "Grandparent", grandpa: "Grandparent",
  grandmother: "Grandparent", grandfather: "Grandparent",
  grandparent: "Grandparent", gran: "Grandparent",
  granny: "Grandparent", grandad: "Grandparent",
};
const RE_PERSON = new RegExp(
  "\\b(" + Object.keys(PERSON_MAP).join("|") + ")\\b",
  "i"
);

//
// Parsers


/**
 * Extract a positive integer ID from the message.
 * @param {string} msg
 * @returns {number|null}
 */
function parseId(msg) {
  const m = msg.match(RE_ID);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/**
 * Parse a time expression and return "HH:MM" (24-hour) or null.
 * Handles "8pm", "8:30 PM", "20:00", "8:00 am".
 * @param {string} msg
 * @returns {string|null}
 */
function parseTime(msg) {
  // Try 12-hour first (requires am/pm to be present)
  let m = msg.match(RE_TIME_12);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3].toLowerCase();
    if (meridiem === "pm" && h !== 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
    }
  }
  // Try bare 24-hour HH:MM
  m = msg.match(RE_TIME_24);
  if (m) {
    const h   = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
    }
  }
  return null;
}

/**
 * Parse a canonical family-member label from the message.
 * @param {string} msg
 * @returns {string|null}
 */
function parsePerson(msg) {
  const m = msg.match(RE_PERSON);
  if (!m) return null;
  return PERSON_MAP[m[1].toLowerCase()] ?? null;
}

/**
 * Derive a human-readable check-in name from the message.
 *
 * Priority:
 *   1. Explicit quoted string: add "Bedtime routine"
 *   2. Time-of-day label:      "at 8pm"  ->  "<Person>'s evening check-in"
 *   3. Person + generic:       person present -> "<Person>'s check-in"
 *   4. Last resort:            "Check-in"
 *
 * @param {string}      msg
 * @param {string|null} person -- already-parsed canonical person label
 * @param {string|null} time   -- already-parsed HH:MM string
 * @returns {string}
 */
function parseName(msg, person, time) {
  // 1. Explicit quoted name
  const quoted = msg.match(/["']([^"']{2,40})["']/);
  if (quoted) return quoted[1].trim();

  // 2. Infer from time of day
  if (time) {
    const h = parseInt(time.split(":")[0], 10);
    const prefix = person ? person + "'s " : "";
    if (h >= 5  && h < 12) return prefix + "morning check-in";
    if (h >= 12 && h < 17) return prefix + "afternoon check-in";
    if (h >= 17 && h < 21) return prefix + "evening check-in";
    return prefix + "check-in";
  }

  // 3. Person-based fallback
  if (person) return person + "'s check-in";

  return "Check-in";
}

/**
 * Format an HH:MM string as "8:00 PM" for display in replies.
 * @param {string} hhmm
 * @returns {string}
 */
function displayTime(hhmm) {
  const parts = hhmm.split(":");
  const h     = parseInt(parts[0], 10);
  const mStr  = parts[1];
  const ampm  = h >= 12 ? "PM" : "AM";
  const dh    = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return dh + ":" + mStr + " " + ampm;
}

// Fallback engine


/**
 * Deterministic rule-based chat handler.
 * @param {string} message
 * @returns {{ reply: string, actions: object[], mode: "fallback" }}
 */
function fallback(message) {
  // Greeting
  if (RE_GREETING.test(message)) {
    return {
      reply:
        "Hi there! I'm CareCue, your family-care assistant. " +
        "I can list, create, and complete check-ins for your family. What would you like to do?",
      actions: [],
      mode: "fallback",
    };
  }

  // Well-being ("how are you")
  if (RE_WELLBEING.test(message)) {
    return {
      reply:
        "I'm doing well, thanks for asking! I'm here whenever you need help managing " +
        "your family's check-ins. What can I do for you?",
      actions: [],
      mode: "fallback",
    };
  }

  // Thanks
  if (RE_THANKS.test(message)) {
    return {
      reply: "You're welcome! Let me know if there's anything else I can help with.",
      actions: [],
      mode: "fallback",
    };
  }

  // Help
  if (RE_HELP.test(message)) {
    return {
      reply:
        "Here's what I can help you with:\n" +
        "- \"Show check-ins\" -- list all family check-ins\n" +
        "- \"Show Dad's check-ins\" -- list check-ins for a specific person\n" +
        "- \"Add a check-in for Dad at 8 pm\" -- schedule a new check-in\n" +
        "- \"Mark check-in 2 complete\" -- record a check-in as done\n\n" +
        "Just ask in plain English!",
      actions: [],
      mode: "fallback",
    };
  }

  // List (with optional person filter)
  if (RE_LIST.test(message)) {
    const person = parsePerson(message);
    if (person) {
      return {
        reply: "Here are the check-ins for " + person + ":",
        actions: [validateAction({ type: "list_checkins", filter: { person } })],
        mode: "fallback",
      };
    }
    return {
      reply: "Here are the current family check-ins:",
      actions: [validateAction({ type: "list_checkins" })],
      mode: "fallback",
    };
  }

  // Complete
  if (RE_COMPLETE.test(message)) {
    const id = parseId(message);
    if (!id) {
      return {
        reply:
          "Which check-in should I mark complete? " +
          "Please include its ID, e.g. \"mark check-in 2 complete\".",
        actions: [],
        mode: "fallback",
      };
    }
    return {
      reply: "Got it -- marking check-in #" + id + " as complete.",
      actions: [validateAction({ type: "complete_checkin", id })],
      mode: "fallback",
    };
  }

  // Create
  if (RE_CREATE.test(message)) {
    const person = parsePerson(message);
    const time   = parseTime(message);
    const name   = parseName(message, person, time);

    if (!person) {
      return {
        reply:
          "Who is this check-in for? " +
          "Please mention a family member, e.g. Dad, Mom, or Grandparent.",
        actions: [],
        mode: "fallback",
      };
    }

    if (!time) {
      return {
        reply:
          "Got it -- a check-in for " + person + ". " +
          "What time should it be scheduled? (e.g. \"at 8 pm\")",
        actions: [],
        mode: "fallback",
      };
    }

    return {
      reply: "Creating \"" + name + "\" for " + person + " at " + displayTime(time) + ".",
      actions: [validateAction({ type: "create_checkin", name, person, time })],
      mode: "fallback",
    };
  }

  // Unknown
  return {
    reply:
      "I'm not sure what you mean. " +
      "Try asking me to \"show check-ins\", \"add a check-in for Mom at 9 am\", " +
      "or \"complete check-in 1\". Type \"help\" for a full list.",
    actions: [],
    mode: "fallback",
  };
}


// Public API


/**
 * chat(message, context?)
 *
 * @param {string}   message -- user's natural-language message
 * @param {object[]} context -- current check-ins (passed to Bedrock for grounding)
 * @returns {Promise<{ reply: string, actions: object[], mode: string }>}
 */
async function chat(message, context = []) {
  if (typeof message !== "string" || !message.trim()) {
    return {
      reply: "I didn't catch that. Could you try again?",
      actions: [],
      mode: "fallback",
    };
  }

  if (USE_BEDROCK && BedrockRuntimeClient && InvokeModelCommand) {
    try {
      return await callBedrock(message, context);
    } catch (err) {
      console.warn(
        "[CareCue AI] Bedrock call failed -- using rule-based fallback.",
        err.message
      );
    }
  }

  return fallback(message);
}

module.exports = { chat, fallback, validateAction, parseTime, parsePerson, parseName };
