
"use strict";

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

async function callCareCueMcpTool(name, args = {}) {
  const endpoint = process.env.CARECUE_MCP_URL;
  const token = process.env.CARECUE_MCP_TOKEN;

  if (!endpoint || !token) {
    throw new Error("Remote MCP URL or token is not configured.");
  }

  const client = new Client({
    name: "carecue-backend",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(endpoint),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    }
  );

  try {
    await client.connect(transport);

    return await client.callTool({
      name,
      arguments: args,
    });
  } finally {
    await client.close();
  }
}

module.exports = { callCareCueMcpTool };
