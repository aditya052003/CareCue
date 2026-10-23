# CareCue 💙
### Stay connected. Check in. Care together.

**CareCue is a cloud-based family check-in coordination platform that helps families organize check-ins, track completion, and stay informed through a centralized dashboard and chat interface.**

Built with React, Node.js, AWS, and the Model Context Protocol (MCP), CareCue demonstrates how cloud services and tool integrations can simplify everyday coordination.

<p align="center">
  <a href="https://staging.d1wig0f4y185xe.amplifyapp.com/">
    <strong>🚀 Try the Live Demo</strong>
  </a>
  &nbsp; • &nbsp;
  <a href="https://github.com/aditya052003/CareCue">
    <strong>📂 View Source Code</strong>
  </a>
</p>

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Problem Statement](#-problem-statement)
- [Key Features](#-key-features)
- [Live Deployment](#-live-deployment)
- [Technology Stack](#-technology-stack)
- [System Architecture](#-system-architecture)
- [MCP Integration](#-mcp-integration)
- [Getting Started](#-getting-started)
- [AWS Deployment](#-aws-deployment)
- [Security and Privacy](#-security-and-privacy)
- [Roadmap](#-roadmap)
- [License](#-license)
- [Author](#-author)

## 💡 Overview

Families often need a simple way to coordinate planned check-ins and keep track of which ones are complete. CareCue brings this activity into one place.

Users can create check-ins for family members, view their schedules, and mark completed check-ins. The application also includes a chat interface for supported natural-language requests and an MCP server that exposes check-in operations as tools for compatible clients.

CareCue is designed as a cloud-based project demonstrating full-stack development, persistent storage, serverless deployment, and MCP integration.

## 🎯 Problem Statement

Family check-in coordination can become difficult when schedules and updates are scattered across different conversations or applications.

CareCue addresses this by providing:

- A centralized view of planned check-ins.
- A simple way to track pending and completed check-ins.
- A consistent backend for storing and retrieving check-in records.
- A tool-based interface that can be used by compatible MCP clients.

## ✨ Key Features

### 📅 Check-In Management
Create check-ins for family members and specify their scheduled times.

### ✅ Completion Tracking
Distinguish between pending and completed check-ins.

### 📊 Centralized Dashboard
View check-in activity and completion statistics in one place.

### 💬 Interactive Chat
Use supported natural-language requests to create, list, and complete check-ins.

### 🔌 MCP Tool Integration
Expose check-in operations through a remote Model Context Protocol server for compatible clients.

### ☁️ AWS-Powered Infrastructure
Use AWS hosting and managed storage to support the deployed application.

## 🌐 Live Deployment

| Resource | Link |
|---|---|
| Web application | [Open CareCue](https://staging.d1wig0f4y185xe.amplifyapp.com/) |
| Backend API | [Open backend endpoint](https://12jjhmz6wypq80kw.8lc.lambda-web.ap-south-1.on.aws) |
| Remote MCP endpoint | `https://3rkx4656ghxd50r5.8lc.lambda-web.ap-south-1.on.aws/mcp` |
| GitHub repository | [aditya052003/CareCue](https://github.com/aditya052003/CareCue) |

> **Note:** The MCP endpoint may require authentication and an MCP-compatible client. Keep authentication tokens private.

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, JavaScript |
| Backend | Node.js, Express.js |
| Database | Amazon DynamoDB |
| Frontend hosting | AWS Amplify |
| Backend hosting | AWS Lambda Web Function |
| Tool integration | Model Context Protocol (MCP) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Version control | Git and GitHub |

## 🏗️ System Architecture

```text
                    ┌──────────────────────┐
                    │         User         │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   React + Vite UI    │
                    │   AWS Amplify        │
                    └──────────┬───────────┘
                               │ HTTP requests
                               ▼
                    ┌──────────────────────┐
                    │   Backend API        │
                    │   AWS Lambda         │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    ▼                      ▼
          ┌─────────────────┐   ┌──────────────────┐
          │ Amazon DynamoDB │   │ Remote MCP Server│
          │ Check-In Data   │   │ Check-In Tools   │
          └─────────────────┘   └────────┬─────────┘
                                         │
                                         ▼
                               ┌──────────────────┐
                               │ Compatible MCP   │
                               │ Clients          │
                               └──────────────────┘
```

### Architecture Overview

1. Users interact with the React frontend hosted on AWS Amplify.
2. The frontend sends application requests to the backend API.
3. The backend handles check-in operations and connects to the configured data store.
4. Amazon DynamoDB stores check-in records.
5. The remote MCP server exposes supported check-in operations as tools.
6. Compatible MCP clients can invoke the exposed tools when correctly configured.

## 🔌 MCP Integration

CareCue provides a remote MCP server for interacting with check-in data through a standardized tool interface.

### Available Tools

| Tool | Description | Arguments |
|---|---|---|
| `list_checkins` | Retrieves check-in records | None |
| `create_checkin` | Creates a new check-in | `name`, `person`, `time` |
| `complete_checkin` | Marks a check-in as completed | `id` |

### Example Tool Arguments

Create a check-in:

```json
{
  "name": "Mom's check-in",
  "person": "Mom",
  "time": "21:00"
}
```

Complete a check-in:

```json
{
  "id": 123456789
}
```

Use the actual numeric ID returned by CareCue when completing a check-in. The ID above is illustrative.

### MCP Endpoint

```text
https://3rkx4656ghxd50r5.8lc.lambda-web.ap-south-1.on.aws/mcp
```

The endpoint is intended for MCP-compatible clients that support the server's transport and authentication requirements.

**Alexa+ compatibility:** An MCP endpoint alone does not prove that an Alexa+ connection has been configured or tested. Describe the Alexa+ integration as completed only after verifying the actual connection and demo.

## 💻 Getting Started

### Prerequisites

Install the following:

- [Node.js](https://nodejs.org/) and npm
- [Git](https://git-scm.com/)
- A code editor such as [Visual Studio Code](https://code.visualstudio.com/)
- AWS configuration and permissions for AWS-backed functionality

### 1. Clone the Repository

```bash
git clone https://github.com/aditya052003/CareCue.git
cd CareCue
```

### 2. Start the Frontend

Open a terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local development URL printed by Vite.

### 3. Configure the Backend

Open a second terminal:

```bash
cd backend
npm install
```

Review `backend/.env.example` for the environment variables expected by the backend.

Create your own local `.env` file with the appropriate values. Use the application's configuration and source code to determine the required settings.

**Never copy real tokens or credentials into the README or commit them to GitHub.**

### 4. Start the Backend

Use the start script defined in `backend/package.json`. For example, if the script is named `start`:

```bash
npm start
```

The local backend may require AWS permissions, DynamoDB configuration, and MCP endpoint settings to support all features.

> **Troubleshooting:** If an endpoint or database operation fails, check the backend logs, configured environment variables, AWS permissions, and the availability of the deployed services.

## ☁️ AWS Deployment

The deployed application uses AWS services for hosting, backend execution, and persistent storage.

| AWS service | Purpose |
|---|---|
| AWS Amplify | Hosts the web frontend |
| AWS Lambda Web Functions | Runs the backend API and remote MCP server |
| Amazon DynamoDB | Stores check-in records |

### Deployment Considerations

- Configure the correct frontend API URL.
- Set the necessary Lambda environment variables.
- Configure DynamoDB access permissions.
- Keep authentication tokens and other secrets out of source control.
- Test the deployed frontend, backend, database, and MCP endpoint after updates.

## 🔒 Security and Privacy

CareCue is a project demonstration and should be reviewed before use with real family or personal information.

- Never commit AWS credentials, MCP tokens, passwords, or real `.env` files.
- Use fictional family data in public demos.
- Restrict access to backend endpoints and data.
- Apply appropriate authentication and authorization before production use.
- Avoid exposing sensitive personal information in application logs.
- Review AWS IAM permissions and database access policies regularly.

## 🗺️ Roadmap

Potential future improvements include:

- ⏰ Scheduled check-in reminders and notifications.
- 👨‍👩‍👧 Family-specific accounts and access controls.
- 🤖 Optional AI-powered assistance using Amazon Bedrock.
- 📱 Enhanced mobile experience and accessibility.
- 📈 More detailed activity history and reporting.
- 🧪 Expanded automated testing and monitoring.

These items are planned improvements, not claims that the functionality is already implemented.

## 📜 License

This project is distributed under the [MIT License](LICENSE).

## 👨‍💻 Author

**Aditya Raut**

B.Tech in Computer Science and Engineering — IIIT Nagpur

Interested in full-stack development, cloud computing, backend engineering, and building practical technology solutions.

- **GitHub:** [@aditya052003](https://github.com/aditya052003)

---

<p align="center">
  <strong>CareCue 💙</strong><br>
  Stay connected. Check in. Care together.
</p>
