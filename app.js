import dotenv from "dotenv";
dotenv.config();
import express from "express";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const app = express();
const port = 3030;

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

const ddbDocClient = DynamoDBDocumentClient.from(client);

app.get("/", async (req, res) => {
  try {
    const params = {
      TableName: "User", // Replace with your DynamoDB table name
      Key: {
        // Replace with your primary key attributes
        user_id: 1,
      },
    };
    
    const command = new GetCommand(params);
    const data = await ddbDocClient.send(command);

    res.json(data.Item);
  } catch (error) {
    console.error("Error fetching data from DynamoDB:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});