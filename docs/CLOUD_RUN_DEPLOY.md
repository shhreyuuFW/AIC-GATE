# Deploying AIC-GATE to Google Cloud Run (GitHub + Docker + Secret Manager)

This guide connects the GitHub repository (`shhreyuuFW/AIC-GATE`) directly to **Google Cloud Run** using the multi-stage [Dockerfile](../Dockerfile) and **Google Secret Manager** so you can test the live web app over HTTPS without starting local servers.

---

## 1. AWS Prerequisites (Dedicated Cloud Run Backend IAM User)

Locally, AIC-GATE uses `~/.aws` profiles (`aic-gate-dev` and `aic-gate-logs-reader`). On Cloud Run (`AIC_GATE_USE_DEFAULT_AWS_CREDS=1`), `boto3` reads `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from environment variables injected via Secret Manager.

Create a dedicated least-privilege IAM user (e.g., `AICGateCloudRunBackend`) with **only** the permissions below:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeJITRole",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::023644376485:role/AICGateJITRole"
    },
    {
      "Sid": "ManageDynamoDBTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:Scan",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:023644376485:table/AICGateSession",
        "arn:aws:dynamodb:ap-south-1:023644376485:table/AICGateAccessRequest",
        "arn:aws:dynamodb:ap-south-1:023644376485:table/AICGateIdentity"
      ]
    },
    {
      "Sid": "ReadLabLogsPrefix",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cloudsec.proj.aicgate",
        "arn:aws:s3:::cloudsec.proj.aicgate/logs/*"
      ]
    }
  ]
}
```

Also update **`AICGateJITRole`**'s trust relationship so `AICGateCloudRunBackend` is allowed to assume it (in addition to `AIC_GATE_DEV`).

Ensure these three DynamoDB tables exist in `ap-south-1`:
- **`AICGateSession`** — partition key `session_id` (`String`)
- **`AICGateAccessRequest`** — partition key `request_id` (`String`)
- **`AICGateIdentity`** — partition key `pk` (`String`) *(stores Organizations, Members, Custom Roles, Retired Invite Ledger, Notifications, and Master Tickets so zero data is ever lost across Cloud Run redeploys or scale-to-zero!)*

> **Migrating local data to DynamoDB:** Once `AICGateIdentity` exists, run `python scripts/sync_identity_to_dynamodb.py` locally to upload your saved `.local_data/aic_gate_identity.json` records directly into AWS DynamoDB.

---

## 2. Store Secrets in Google Secret Manager

Enable the required GCP APIs and store sensitive values in Secret Manager (never commit secrets or bake them into Docker images):

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com

# Replace placeholder strings with your actual values
printf "%s" "YOUR_AWS_ACCESS_KEY_ID"     | gcloud secrets create aic-gate-aws-access-key-id --data-file=-
printf "%s" "YOUR_AWS_SECRET_ACCESS_KEY" | gcloud secrets create aic-gate-aws-secret-access-key --data-file=-
openssl rand -base64 48                  | tr -d '\n' | gcloud secrets create aic-gate-jwt-secret --data-file=-
printf "%s" "CHANGE_ME_OPERATOR_PASS"    | gcloud secrets create aic-gate-operator-pass --data-file=-
printf "%s" "CHANGE_ME_COMMANDER_PASS"   | gcloud secrets create aic-gate-commander-pass --data-file=-
```

Grant your Cloud Run runtime service account access to read those secrets (`roles/secretmanager.secretAccessor`):

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in aic-gate-aws-access-key-id aic-gate-aws-secret-access-key aic-gate-jwt-secret aic-gate-operator-pass aic-gate-commander-pass; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${RUN_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 3. Connect GitHub to Cloud Run (Continuous Deployment)

### Option A — Google Cloud Console (Recommended, 2 Minutes)

1. Open **Cloud Run → Create Service**.
2. Select **Continuously deploy from a repository (source or function)** → **Set up with Cloud Build**.
3. Connect GitHub repository **`shhreyuuFW/AIC-GATE`**, branch **`^feat/v2-platform$`** (or `^main$` once merged), and choose **Dockerfile** (`/Dockerfile`).
4. Set service settings:
   - **Region:** `asia-south1` (Mumbai — co-located with `ap-south-1` AWS DynamoDB/S3 for low latency) or your preferred region.
   - **Authentication:** *Allow unauthenticated invocations* (AIC-GATE enforces its own JWT login screen at `/login`).
   - **Container port:** `8080`.
   - **Min instances:** `0` (scales to zero when idle), **Max instances:** `2`.
5. Under **Variables & Secrets → Environment Variables**, add:
   - `AIC_GATE_ENV=production`
   - `AIC_GATE_DEMO_USERS_ENABLED=1` *(set to `0` if you disable demo logins later)*
   - `AIC_GATE_USE_DEFAULT_AWS_CREDS=1`
   - `AWS_REGION=ap-south-1`
   - `AIC_GATE_JIT_ROLE_ARN=arn:aws:iam::023644376485:role/AICGateJITRole`
   - `AIC_GATE_SESSIONS_TABLE=AICGateSession`
   - `AIC_GATE_REQUESTS_TABLE=AICGateAccessRequest`
   - `AIC_GATE_IDENTITY_TABLE=AICGateIdentity`
   - `AIC_GATE_IDENTITY_BACKEND=dynamodb`
   - `AIC_GATE_ALLOWED_BUCKETS=cloudsec.proj.aicgate`
6. Under **Secrets** (Reference as Environment Variable):
   - `AWS_ACCESS_KEY_ID` → `aic-gate-aws-access-key-id:latest`
   - `AWS_SECRET_ACCESS_KEY` → `aic-gate-aws-secret-access-key:latest`
   - `AIC_GATE_JWT_SECRET` → `aic-gate-jwt-secret:latest`
   - `AIC_GATE_DEMO_REQUESTER_PASSWORD` → `aic-gate-operator-pass:latest`
   - `AIC_GATE_DEMO_ADMIN_PASSWORD` → `aic-gate-commander-pass:latest`
   - `AIC_GATE_DEMO_MASTER_PASSWORD` *(optional env/secret; defaults to `master-demo-pass` in dev, set in prod if `AIC_GATE_DEMO_USERS_ENABLED=1`)*
7. Deploy. Once Cloud Run outputs your HTTPS URL (e.g., `https://aic-gate-cloud-216638814215.asia-south1.run.app`), edit the service once more to add:
   - `AIC_GATE_CORS_ORIGINS=https://aic-gate-cloud-216638814215.asia-south1.run.app`

### Option B — Deploy via Google Cloud Shell (`gcloud run deploy`)

```bash
git clone https://github.com/shhreyuuFW/AIC-GATE.git
cd AIC-GATE
git checkout feat/v3-multi-service-org-mfa   # or main once merged

gcloud config set project autumn-7
gcloud run deploy aic-gate-cloud \
  --source . \
  --region asia-south1 \
  --service-account aic-gate-runner@autumn-7.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars "AIC_GATE_ENV=production,AIC_GATE_DEMO_USERS_ENABLED=1,AIC_GATE_USE_DEFAULT_AWS_CREDS=1,AWS_REGION=ap-south-1,AIC_GATE_JIT_ROLE_ARN=arn:aws:iam::023644376485:role/AICGateJITRole,AIC_GATE_SESSIONS_TABLE=AICGateSession,AIC_GATE_REQUESTS_TABLE=AICGateAccessRequest,AIC_GATE_IDENTITY_TABLE=AICGateIdentity,AIC_GATE_IDENTITY_BACKEND=dynamodb,AIC_GATE_ALLOWED_BUCKETS=cloudsec.proj.aicgate,AIC_GATE_CORS_ORIGINS=https://aic-gate-cloud-216638814215.asia-south1.run.app" \
  --set-secrets "AWS_ACCESS_KEY_ID=aic-gate-aws-access-key-id:latest,AWS_SECRET_ACCESS_KEY=aic-gate-aws-secret-access-key:latest,AIC_GATE_JWT_SECRET=aic-gate-jwt-secret:latest,AIC_GATE_DEMO_REQUESTER_PASSWORD=aic-gate-operator-pass:latest,AIC_GATE_DEMO_ADMIN_PASSWORD=aic-gate-commander-pass:latest"
```

---

## 4. Post-Deploy Verification

1. **Health check:** `curl https://<your-cloud-run-url>/health` → `{"status":"ok"}`.
2. **UI & Auth:** Open `https://<your-cloud-run-url>/login` and sign in with your configured `operator` / `commander` passwords.
3. **Structured Audit Logs:** Every login, request, approval, STS session issuance, S3 read, and revocation emits single-line JSON to `stdout`, automatically indexed in **Google Cloud Logging** (no secrets logged).
4. **End-to-End Scope Proof:** Submit a `logs/` request as `operator`, approve & provision as `commander`, test `logs/sample.log` (Allow) vs `restricted/secret.txt` (Deny) in the S3 Scope Tester, and export the STS keys into AWS CLI to verify direct S3 enforcement.
