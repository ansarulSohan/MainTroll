# MainTroll – AI-Powered Maintenance Management System

**An AWS-powered maintenance management platform for the Oil & Gas industry.**

MainTroll is a cloud-based application designed to help Oil & Gas teams manage equipment, track maintenance activities, monitor documentation, and receive automated maintenance alerts.

The project combines AWS cloud services, serverless computing, database management, and generative AI to improve maintenance visibility, operational efficiency, and decision-making.

## 1. Key Features

- **Equipment Management:** Maintain equipment records and monitor operational status.
- **Maintenance Tracking:** Manage maintenance schedules, overdue tasks, and maintenance history.
- **Document Management:** Track equipment-related documents and expiration dates.
- **Automated Notifications:** Deliver scheduled maintenance alerts using Amazon EventBridge Scheduler and Amazon SNS.
- **AI Maintenance Assistant:** Use generative AI to retrieve equipment information, identify overdue maintenance, and generate maintenance summaries.

## 2. AWS Architecture

MainTroll uses AWS managed and serverless services to support its application functionality.

| AWS Service                  | Purpose                                  |
| ---------------------------- | ---------------------------------------- |
| Amazon S3                    | Frontend hosting                         |
| AWS Lambda                   | Backend processing and application logic |
| Amazon API Gateway           | HTTP API integration                     |
| Amazon RDS (MySQL)           | Relational database                      |
| Amazon Cognito               | User authentication                      |
| Amazon Bedrock               | Generative AI integration                |
| Amazon EventBridge Scheduler | Scheduled automation                     |
| Amazon SNS                   | Notifications                            |
| AWS IAM                      | Access management                        |
| Amazon CloudWatch            | Monitoring and logging                   |

### Architecture Overview

```text
             USERS
               |
               v
         Amazon Cognito
         Authentication
               |
               v
           Amazon S3
         Frontend Hosting
               |
               v
          API Gateway
               |
          AWS Lambda
               |
       +-------+--------+
       |                |
       v                v
   Amazon RDS      Amazon Bedrock
     MySQL          Generative AI
                        |
                        v
                   AI Lambda

       AUTOMATED NOTIFICATIONS

       EventBridge Scheduler
               |
               v
          AWS Lambda
               |
               v
            Amazon SNS
```

## 3. Technology Stack

- **Cloud:** Amazon Web Services (AWS)
- **Backend:** Python, AWS Lambda, PyMySQL
- **Frontend:** HTML, CSS, JavaScript
- **Database:** MySQL, Amazon RDS
- **AI:** Amazon Bedrock, Amazon Nova Lite
- **Authentication:** Amazon Cognito
- **Automation:** EventBridge Scheduler, Amazon SNS
- **Tools:** Git, GitHub, Postman, MySQL Workbench, Visual Studio Code

## 4. Security

Security considerations include:

- Amazon Cognito authentication.
- IAM roles and permissions.
- Environment variables for sensitive configuration.
- Parameterized SQL queries.
- Read-only database operations for AI-assisted information retrieval.

## 5. Project Structure

```text
MainTroll/
│
├── lambda/
│   ├── Backend Functions
│   ├── AI Assistant Functions
│   └── Notification Functions
│
├── Maintroll-Frontend/
│   ├── index.html
│   ├── style.css
│   └── JavaScript files
├── postman/
│   └── API Testing Collections
├── static/
│   └── Static Application Resources
└── README.md
```

## 6. Learning Outcomes

This project provided practical experience in:

- AWS cloud architecture and deployment.
- Serverless application development.
- API development and integration.
- Relational database management.
- Generative AI integration with Amazon Bedrock.
- Cloud security and IAM.
- Automated notifications and monitoring.
- Git and GitHub collaboration.

## 7. Project Status

✅ **Completed**

MainTroll is a collaborative cloud computing project demonstrating how AWS and generative AI can address real-world maintenance management challenges in the Oil & Gas industry.

## 8. Future Enhancements

- Predictive maintenance.
- Advanced equipment risk assessment.
- AI-generated maintenance recommendations.
- Real-time equipment monitoring.
- Advanced analytics and reporting.

---

**Project:** MainTroll
**Industry:** Oil & Gas
**Platform:** Amazon Web Services
**Focus:** Cloud Computing, Serverless Architecture and Generative AI

*Making maintenance smarter, more connected, and more proactive through cloud technology and AI.*
