# CareCue — Family Check-In Coordination

**Stay connected. Check in. Care together.**

CareCue is a web application that helps families coordinate check-ins and keep track of whether planned check-ins have been completed. It provides a centralized place to view check-in activity and identify pending check-ins.

## 🚀 Live Demo

- **Application:** https://staging.d1wig0f4y185xe.amplifyapp.com
- **Backend API:** https://12jjhmz6wypq80kw.8lc.lambda-web.ap-south-1.on.aws
- **GitHub Repository:** https://github.com/aditya052003/CareCue

## ✨ Features

- **Check-In Management:** Create and track family check-ins.
- **Status Tracking:** Distinguish between completed and pending check-ins.
- **Persistent Storage:** Store check-in records in Amazon DynamoDB.
- **Dashboard:** View check-in activity and completion statistics.
- **Chat Interface:** Interact with the application's check-in assistant.
- **Cloud Deployment:** Frontend and backend hosted using AWS services.

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, JavaScript |
| Backend | Node.js, Express.js |
| Database | Amazon DynamoDB |
| Frontend Hosting | AWS Amplify |
| Backend Hosting | AWS Lambda Web Function |
| Version Control | Git and GitHub |

## 🏗️ Architecture

1. The user interacts with the React frontend.
2. The frontend sends HTTP requests to the Express.js backend.
3. The backend processes check-in operations.
4. Check-in records are stored in Amazon DynamoDB.
5. The frontend displays the latest check-in information and status.

```text
User
  |
  v
React + Vite Frontend
  |
  v
Express.js Backend
(AWS Lambda Web Function)
  |
  v
Amazon DynamoDB
```

## 💻 Run Locally

### Prerequisites

- Node.js and npm
- Git
- An AWS account with appropriate permissions if you want to connect to DynamoDB

### 1. Clone the repository

```bash
git clone https://github.com/aditya052003/CareCue.git
cd CareCue
```

### 2. Set up the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite in your terminal.

### 3. Set up the backend

Open a separate terminal:

```bash
cd backend
npm install
```

Configure the environment variables required by the backend using the provided `.env.example` file and the project's configuration. Do not commit real credentials or secret values.

Start the backend using the start script defined in `backend/package.json`.

> **Note:** The local backend requires the appropriate database configuration. AWS-backed storage also requires valid AWS permissions and configuration.

## ☁️ AWS Deployment

The deployed application uses:

- **AWS Amplify** for frontend hosting.
- **AWS Lambda Web Function** for the backend API.
- **Amazon DynamoDB** for persistent check-in data.

Deployment requires the correct API URL, environment configuration, AWS permissions, and database setup.

## 🔒 Security Notes

- Never commit AWS access keys, passwords, API secrets, or real `.env` files.
- Use fictional information when demonstrating the application publicly.
- Configure appropriate access controls before using real family or personal data.
- Review API authentication and authorization before production use.

## 🗺️ Future Improvements

- Scheduled check-in reminders and notifications.
- Stronger user authentication and family-specific access controls.
- AI-powered assistance using Amazon Bedrock.
- Improved accessibility and mobile experience.
- Additional monitoring and error handling.

## 👨‍💻 Author

Developed as a cloud-based project exploring web development, backend APIs, and AWS deployment.

**Built with React, Node.js, and AWS.**
