# AIC-GATE

**Automated Identity Controller & Just-in-Time Access Gateway**

AIC-GATE is an application-driven Just-in-Time (JIT) access gateway for Amazon S3. It centralizes scoped access requests, human administrator approval, temporary AWS STS credential issuance with restrictive session policies, DynamoDB tracking, and role-separated web portals.

> **Important boundary:** AIC-GATE does not replace AWS IAM. AWS IAM role policies and STS session policies enforce resource authorization on every S3 request.

---

## Architecture & Portals

- **Backend:** Python 3.13+, FastAPI, `PyJWT` (`HS256`), `bcrypt`, `boto3` (cached clients & DynamoDB resources)
- **AWS Services:** AWS IAM (`AICGateJITRole`, `AICGateLogsReader`), AWS STS (`AssumeRole` + inline session policies), Amazon DynamoDB (`AICGateSession`, `AICGateAccessRequest`), Amazon S3
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide Icons (Arknights: Endfield-inspired industrial light & tactical dark theme)

### Separated Dual-Role Interface

| Portal | Routes | Capabilities |
|---|---|---|
| **Client / Operator Portal** | `/client`, `/client/sessions`, `/client/s3-tester`, `/client/guide` | Scoped request builder, **Live STS Session Policy Preview** (`POST /policy/preview`), personal request/session tracking, in-memory STS credential vault (PowerShell/Bash export), proxied S3 scope tester, and a **Client-only Field Manual**. |
| **Admin / Commander Console** | `/admin`, `/admin/sessions`, `/admin/graph`, `/admin/audit-log`, `/admin/guide` | Filterable approval queue (`PENDING` → `APPROVED` / `REJECTED`), atomic session provisioning (`APPROVED` → `CREATING_SESSION` → `SESSION_CREATED` with automatic rollback on failure), global session telemetry, **Live Entitlement Graph** (`Identity → Session → S3 Prefix`), secret-redacted **Security Audit Log**, and an **Admin-only Operations Manual**. |

---

## Security Model & Known Guarantees

- **Server-Side Authentication & RBAC:** All API endpoints (except `/health`, `/auth/login`, and static UI routes) require a signed Bearer JWT. `/admin/*` endpoints strictly enforce `role == "admin"`. Ownership checks prevent IDOR across requests and sessions.
- **Prefix Hardening:** Request validation and STS policy construction reject wildcards (`*`, `?`), path traversal (`..`, `.`), backslashes, leading `/`, and empty segments (`//`).
- **Secret Handling:** Temporary STS credentials are returned with `Cache-Control: no-store`, kept strictly in memory in the UI, and never written to browser storage or audit logs (audit metadata automatically redacts `secret`, `token`, `password`, and `credential` keys).
- **Revocation Semantics:** Marking a session `REVOKED` in `AICGateSession` immediately blocks new STS key minting and proxied API S3 reads. **Already-issued STS credentials remain valid against AWS S3 directly until their STS `Expiration` timestamp.** Keep durations short (`15–60` minutes).

---

## Quick Start

### 1. Configure Environment

Copy `.env.example` to `.env` and adjust values for your AWS lab if needed:

```powershell
Copy-Item .env.example .env
```

In `development` mode (`AIC_GATE_ENV=development`), local demo credentials are enabled:
- **Client Operator:** `operator` / `operator-demo-pass`
- **Admin Commander:** `commander` / `commander-demo-pass`

In `production` mode (`AIC_GATE_ENV=production`), demo users are disabled by default and `AIC_GATE_JWT_SECRET` must be set to at least 32 characters.

### 2. Install Dependencies

```powershell
# Backend (from repository root)
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"

# Frontend
cd frontend
npm install
npm run build
cd ..
```

### 3. Run Locally

Use the helper script from the repository root (builds the frontend if `frontend/dist` is missing and starts FastAPI on `http://127.0.0.1:8000`):

```powershell
.\scripts\dev.ps1
```

For hot-reloading UI development alongside the backend, also run `npm run dev` inside `frontend/` (`http://localhost:5173`).

### 4. Deploy to Google Cloud Run (GitHub + Docker)

A multi-stage [Dockerfile](Dockerfile) and [.dockerignore](.dockerignore) are included to run both the React bundle and FastAPI backend in one container. See [docs/CLOUD_RUN_DEPLOY.md](docs/CLOUD_RUN_DEPLOY.md) for full instructions using **Google Secret Manager** and **Cloud Run Continuous Deployment**.

---

## Running Tests

### Fast Unit Tests (Mocked, No AWS Calls)

```powershell
$env:PYTHONPATH="backend/src"; .\.venv\Scripts\python.exe -m pytest backend/tests -m "not integration" -v
```

### Live AWS Integration Tests (Requires Configured Lab Profiles & Network)

```powershell
$env:PYTHONPATH="backend/src"; .\.venv\Scripts\python.exe -m pytest backend/tests -m integration -v
```

---

## Disclaimer

This is a security engineering project. Verify your AWS IAM policies, DynamoDB tables (`AICGateSession`, `AICGateAccessRequest`), and S3 bucket configuration before deploying beyond a local or isolated lab environment.
