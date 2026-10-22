
"use strict";

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { chat } = require("./ai");

const { callCareCueMcpTool } = require("./remote-mcp");

// --------------------------------------------------
// Storage adapter selection
// --------------------------------------------------

const useDynamoDB = process.env.CARECUE_STORAGE === "dynamodb";

const { dbGetAll, dbCreate, dbComplete } = useDynamoDB
  ? require("./db-dynamodb")
  : require("./db");

if (useDynamoDB) {
  console.log(
    "[CareCue] Storage: DynamoDB (table: " +
      (process.env.CARECUE_TABLE || "CareCueCheckIns") +
      ")"
  );
} else {
  console.log("[CareCue] Storage: SQLite");
}

// --------------------------------------------------
// Express application
// --------------------------------------------------

const app = express();

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// Create a check-in
// --------------------------------------------------

async function createCheckIn(name, person, time) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof person !== "string" ||
    !person.trim() ||
    typeof time !== "string" ||
    !time.trim()
  ) {
    return {
      ok: false,
      status: 400,
      message: "Name, family member, and time are required.",
    };
  }

  try {
    const checkIn = await dbCreate(
      name.trim(),
      person.trim(),
      time.trim()
    );

    return { ok: true, checkIn };
  } catch (err) {
    console.error("[createCheckIn] Database error:", err.message);

    return {
      ok: false,
      status: 500,
      message: "Failed to save check-in.",
    };
  }
}

// --------------------------------------------------
// Complete a check-in
// --------------------------------------------------

async function completeCheckIn(id) {
  try {
    const checkIn = await dbComplete(Number(id));

    if (!checkIn) {
      return {
        ok: false,
        status: 404,
        message: "Check-in not found.",
      };
    }

    return { ok: true, checkIn };
  } catch (err) {
    console.error("[completeCheckIn] Database error:", err.message);

    return {
      ok: false,
      status: 500,
      message: "Failed to update check-in.",
    };
  }
}

// --------------------------------------------------
// Health check
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    message: "CareCue backend is running!",
    status: "OK",
  });
});

// --------------------------------------------------
// GET /api/checkins
// --------------------------------------------------

app.get("/api/checkins", async (req, res) => {
  try {
    const checkIns = await dbGetAll();
    res.json(checkIns);
  } catch (err) {
    console.error("[GET /api/checkins] Database error:", err.message);

    res.status(500).json({
      message: "Failed to load check-ins.",
    });
  }
});

// --------------------------------------------------
// POST /api/checkins
// --------------------------------------------------

app.post("/api/checkins", async (req, res) => {
  const { name, person, time } = req.body || {};

  const result = await createCheckIn(name, person, time);

  if (!result.ok) {
    return res.status(result.status).json({
      message: result.message,
    });
  }

  res.status(201).json({
    message: "Check-in created successfully.",
    checkIn: result.checkIn,
  });
});

// --------------------------------------------------
// PATCH /api/checkins/:id/complete
// --------------------------------------------------

app.patch("/api/checkins/:id/complete", async (req, res) => {
  const result = await completeCheckIn(req.params.id);

  if (!result.ok) {
    return res.status(result.status).json({
      message: result.message,
    });
  }

  res.json({
    message: "Check-in completed successfully.",
    checkIn: result.checkIn,
  });
});

// --------------------------------------------------
// POST /api/chat
// --------------------------------------------------

app.post("/api/chat", async (req, res) => {
  const { message } = req.body || {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      message: 'Request body must contain a non-empty "message" string.',
    });
  }

  // Load current check-ins for AI context.
  let currentCheckIns;

  try {
    currentCheckIns = await dbGetAll();
  } catch (err) {
    console.error(
      "[/api/chat] Failed to load check-ins for context:",
      err.message
    );

    currentCheckIns = [];
  }

  let aiResult;

  try {
    aiResult = await chat(message.trim(), currentCheckIns);
  } catch (err) {
    console.error("[/api/chat] Unexpected chat error:", err);

    return res.status(500).json({
      message: "Internal error processing your request.",
    });
  }

  const results = [];

  for (const action of aiResult.actions || []) {
    switch (action.type) {
      case "list_checkins": {
        try {
          const all = await dbGetAll();

          const filtered =
            action.filter && action.filter.person
              ? all.filter(
                  (c) =>
                    c.person.toLowerCase() ===
                    action.filter.person.toLowerCase()
                )
              : all;

          results.push({
            action: "list_checkins",
            checkIns: filtered,
          });
        } catch (err) {
          console.error("[/api/chat] List check-ins error:", err.message);

          results.push({
            action: "list_checkins",
            error: "Failed to load check-ins.",
          });
        }

        break;
      }

      case "create_checkin": {
        const result = await createCheckIn(
          action.name,
          action.person,
          action.time
        );

        results.push(
          result.ok
            ? {
                action: "create_checkin",
                checkIn: result.checkIn,
              }
            : {
                action: "create_checkin",
                error: result.message,
              }
        );

        break;
      }

      case "complete_checkin": {
        const result = await completeCheckIn(action.id);

        results.push(
          result.ok
            ? {
                action: "complete_checkin",
                checkIn: result.checkIn,
              }
            : {
                action: "complete_checkin",
                error: result.message,
              }
        );

        break;
      }

      default:
        results.push({
          action: action.type,
          error: "Action type not handled by server.",
        });
    }
  }

  res.json({
    reply: aiResult.reply,
    mode: aiResult.mode,
    results,
  });
});

// --------------------------------------------------
// POST /api/mcp/tool — securely call remote MCP tools
// --------------------------------------------------

app.post("/api/mcp/tool", async (req, res) => {
  const { name, arguments: toolArguments = {} } = req.body || {};

  const allowedTools = [
    "list_checkins",
    "create_checkin",
    "complete_checkin",
  ];

  if (!allowedTools.includes(name)) {
    return res.status(400).json({
      message: "Unsupported MCP tool.",
    });
  }

  try {
    const result = await callCareCueMcpTool(name, toolArguments);

    if (result.isError) {
      return res.status(502).json({
        message: "The MCP tool returned an error.",
        result,
      });
    }

    res.json({ result });
  } catch (error) {
    console.error("[/api/mcp/tool] MCP call failed:", error.message);

    res.status(502).json({
      message: "Could not call the remote MCP tool.",
    });
  }
});

// --------------------------------------------------
// Start server
// --------------------------------------------------

// Lambda Web Functions supplies AWS_LAMBDA_HTTP_ENDPOINT.
// When absent, use localhost and PORT for local development.

const lambdaEndpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;

let HOST = "localhost";
let SERVER_PORT = Number(process.env.PORT || 5000);

if (lambdaEndpoint) {
  const endpointUrl = new URL(
    lambdaEndpoint.includes("://")
      ? lambdaEndpoint
      : `http://${lambdaEndpoint}`
  );

  HOST = endpointUrl.hostname;
  SERVER_PORT = Number(
    endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)
  );
}

const server = app.listen(SERVER_PORT, HOST, () => {
  console.log(
    `CareCue backend listening on ${HOST}:${SERVER_PORT}`
  );
});

// Export for automated tests.
module.exports = {
  app,
  server,
  createCheckIn,
  completeCheckIn,
};
