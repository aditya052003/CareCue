
"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "ap-south-1";
const TABLE_NAME = process.env.CARECUE_TABLE || "CareCueCheckIns";

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

const SEED = [
  {
    id: "1",
    name: "Morning check-in",
    person: "Dad",
    time: "09:00 AM",
    status: "Completed",
  },
  {
    id: "2",
    name: "Afternoon check-in",
    person: "Dad",
    time: "02:00 PM",
    status: "Pending",
  },
  {
    id: "3",
    name: "Evening check-in",
    person: "Mom",
    time: "07:00 PM",
    status: "Pending",
  },
];

// Seed each default item only if its ID does not already exist.
// Conditional writes prevent duplicate seed records across Lambda instances.
let initializationPromise;

async function initializeTable() {
  for (const item of SEED) {
    try {
      await client.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: "attribute_not_exists(id)",
        })
      );
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") {
        throw err;
      }
    }
  }
}

function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initializeTable().catch((err) => {
      initializationPromise = undefined;
      throw err;
    });
  }

  return initializationPromise;
}

function toApiRecord(item) {
  return {
    ...item,
    id: Number(item.id),
  };
}

async function dbGetAll() {
  await ensureInitialized();

  const result = await client.send(
    new ScanCommand({
      TableName: TABLE_NAME,
    })
  );

  return (result.Items || [])
    .map(toApiRecord)
    .sort((a, b) => a.id - b.id);
}

async function dbCreate(name, person, time) {
  await ensureInitialized();

  // Keep IDs numeric in the API and string-valued in DynamoDB.
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);

  const checkIn = {
    id,
    name,
    person,
    time,
    status: "Pending",
  };

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...checkIn, id: String(id) },
      ConditionExpression: "attribute_not_exists(id)",
    })
  );

  return checkIn;
}

async function dbComplete(id) {
  await ensureInitialized();

  const key = String(id);

  const existing = await client.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { id: key },
    })
  );

  if (!existing.Item) {
    return null;
  }

  const result = await client.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: key },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "Completed",
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return toApiRecord(result.Attributes);
}

module.exports = {
  dbGetAll,
  dbCreate,
  dbComplete,
};
