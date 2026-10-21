
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

async function main() {
  const client = new Client({
    name: "carecue-action-test",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:5001/mcp")
  );

  try {
    await client.connect(transport);

    console.log("Connected to CareCue MCP!\n");

    // 1. Read existing check-ins
    const before = await client.callTool({
      name: "list_checkins",
      arguments: {},
    });

    console.log("STEP 1: Retrieved existing check-ins");
    console.log(before.content);

    // 2. Create a test check-in
    const created = await client.callTool({
      name: "create_checkin",
      arguments: {
        name: "MCP integration test",
        person: "Dad",
        time: "18:30",
      },
    });

    console.log("\nSTEP 2: Created test check-in");
    console.log(created.content);

    // 3. Extract the created check-in ID
    const createdText = created.content.find(
      (item) => item.type === "text"
    )?.text;

    if (created.isError || !createdText) {
      throw new Error("MCP create_checkin failed.");
    }

    const checkIn = JSON.parse(createdText);

    // 4. Mark the test check-in completed
    const completed = await client.callTool({
      name: "complete_checkin",
      arguments: {
        id: checkIn.id,
      },
    });

    console.log("\nSTEP 3: Completed test check-in");
    console.log(completed.content);

    if (completed.isError) {
      throw new Error("MCP complete_checkin failed.");
    }

    console.log("\nAll MCP action tests passed!");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("MCP action test failed:", error);
  process.exitCode = 1;
});
