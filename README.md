# AIC-Gate

**Automated Identity Controller & JIT Gateway**

A cloud security project implementing Just-in-Time (JIT) access control for Amazon S3, temporary AWS credentials, session tracking, automated expiry, and live entitlement visualization.

## Objectives

- Enforce least-privilege access to private S3 resources.
- Grant approved access through short-lived AWS STS credentials.
- Track active access sessions and their expiration times.
- Revoke or expire access and clean up entitlement records.
- Visualize active identity-to-resource relationships.
- Detect and investigate unauthorized access attempts.

## Architecture

- **Backend:** Python, Boto3, AWS Lambda, API Gateway
- **Identity and authorization:** AWS IAM, STS, S3
- **Session state:** Amazon DynamoDB
- **Workflow orchestration:** AWS Step Functions
- **Dashboard:** JavaScript and Cytoscape.js
- **Testing:** Python and AWS CLI

## Development Roadmap

1. Secure AWS lab and access-control baseline.
2. JIT access broker and policy validation.
3. Session tracking and expiration.
4. Automated cleanup and revocation testing.
5. Live entitlement graph.
6. Security testing and documentation.

## Security Principles

- Default deny and least privilege.
- No production data in the development lab.
- No credentials or secrets committed to Git.
- Individual contributor identities and restricted AWS permissions.
- Explicit testing of access expiry and unauthorized requests.

## Project Status

Initial setup and architecture planning.

## Disclaimer

This is an educational security engineering project. AWS authorization behavior and revocation guarantees must be verified experimentally before any production use.
