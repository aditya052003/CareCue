
const express = require("express");
const { randomUUID } = require("node:crypto");
const {
  McpServer,
} = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StreamableHTTPServerTransport,
} = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");

const app = express();
app.use(express.json());

const API_URL = (
  process.env.CARECUE_API_URL || "http://localhost:5000"
).replace(/\/$/, "");

const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;

const HOST = endpoint ? endpoint.split(":")[0] : "0.0.0.0";
const PORT = endpoint
  ? Number(endpoint.split(":")[1])
  : Number(process.env.PORT || 5001);

function createCareCueMcpServer() {
  const server = new McpServer({
    name: "carecue",
    version: "1.0.0",
  });

  server.registerTool(
    "list_checkins",
    {
      title: "List family check-ins",
      description: "Retrieve the current family check-ins from CareCue.",
      inputSchema: {},
    },
    async () => {
      const response = await fetch(`${API_URL}/api/checkins`);

      if (!response.ok) {
        throw new Error("Could not retrieve CareCue check-ins.");
      }

      const checkIns = await response.json();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(checkIns, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "create_checkin",
    {
      title: "Create a family check-in",
      description:
        "Create a check-in for a family member. Requires a name, family member and time in HH:MM 24-hour format.",
      inputSchema: {
        name: z.string().min(1).describe("Check-in name"),
        person: z.string().min(1).describe("Family member name"),
        time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .describe("Time in 24-hour HH:MM format"),
      },
    },
    async ({ name, person, time }) => {
      const response = await fetch(`${API_URL}/api/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, person, time }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Could not create check-in.");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.checkIn, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "complete_checkin",
    {
      title: "Complete a family check-in",
      description: "Mark an existing CareCue check-in as completed using its numeric ID.",
      inputSchema: {
        id: z.number().int().positive().describe("Check-in ID"),
      },
    },
    async ({ id }) => {
      const response = await fetch(
        `${API_URL}/api/checkins/${id}/complete`,
        { method: "PATCH" }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Could not complete check-in.");
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.checkIn, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

// MCP endpoint: Streamable HTTP transport
app.post("/mcp", async (req, res) => {
  const server = createCareCueMcpServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal MCP server error",
        },
        id: req.body?.id ?? null,
      });
    }
  }
});

// MCP clients can send notifications through POST.
app.get("/mcp", (req, res) => {
  res.status(405).set("Allow", "POST, DELETE").json({
    error: "Use POST for MCP requests.",
  });
});

app.delete("/mcp", (req, res) => {
  res.status(405).json({
    error: "This MCP server uses stateless requests.",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`CareCue MCP server running on http://${HOST}:${PORT}/mcp`);
});