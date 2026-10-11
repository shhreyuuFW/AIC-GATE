# AIC-GATE: Project History, Changes, and Timeline

> **Purpose:** A teammate-friendly record of development milestones,
> implementation changes, AWS setup, verification results, known
> limitations, and next steps.
>
> **Project:** Automated Identity Controller & JIT Gateway\
> **Active branch at the latest recorded checkpoint:**
> `feature/jit-request-validation`\
> **Last documented work session:** 11--12 October 2026 (UTC timestamps
> appear in AWS/DynamoDB test data)\
> **Status:** Working prototype with real AWS S3 and DynamoDB
> integration. Full JIT credential issuance and AWS-side revocation
> enforcement remain incomplete.

------------------------------------------------------------------------

## 1. Executive summary

AIC-GATE is an event-driven, Zero-Trust access-control project intended
to provide temporary, narrowly scoped access to AWS resources. The
intended workflow is:

1.  A requester submits an access request.
2.  The backend validates the bucket, prefix, actions, duration, and
    reason.
3.  A session is created with a unique ID and timestamps.
4.  Session metadata is persisted in DynamoDB.
5.  The application checks session status before allowing an S3 object
    read.
6.  Expiry and revocation state changes are recorded.
7.  Future work will issue genuinely time-bounded AWS access and enforce
    it on the AWS side, not just in application logic.

The current prototype has a FastAPI API, request validation, session
lifecycle logic, a real S3 read path through an assumed IAM role, and
DynamoDB persistence functions. The access checks and integration tests
have been exercised against a real AWS lab account.

**Important distinction:** this is not yet a complete JIT credential
broker. Changing a DynamoDB record to `REVOKED` or `EXPIRED` does not,
by itself, revoke AWS STS credentials that have already been issued. The
current application checks its session record before the S3 read path,
but real per-request credential issuance and AWS-side expiry/revocation
enforcement remain future work.

## 2. Project goals and design intent

### 2.1 Intended security properties

-   **Least privilege:** allow only approved actions on the intended
    resource scope.
-   **Just-in-Time access:** grant access only when requested and only
    for a limited duration.
-   **Prefix-level scope:** a request for `logs/` must not allow access
    to `restricted/`.
-   **Session lifecycle:** track creation, active status, expiry, and
    explicit revocation.
-   **Persistence:** recover session records after an API process
    restart.
-   **Auditable behavior:** retain session metadata and make state
    transitions observable.
-   **Testability:** verify allowed and denied paths, including
    malformed keys and unauthorized resources.

### 2.2 Current implementation versus target design

  --------------------------------------------------------------------------
  Capability                 Current state           Notes
  -------------------------- ----------------------- -----------------------
  Request validation         Implemented             Bucket, prefix,
                                                     actions, duration, and
                                                     reason are validated.

  FastAPI endpoints          Implemented             Local prototype API.

  S3 read through assumed    Implemented and tested  Uses a named local AWS
  role                                               profile.

  Prefix and action checks   Implemented and tested  Application checks run
                                                     before S3 reads.

  DynamoDB session           Implemented in service  New sessions are saved;
  persistence                path                    reads can recover
                                                     sessions from DynamoDB.

  Expiry calculation         Implemented             Expiry is calculated
                                                     from timestamps when
                                                     status is checked.

  Expiry-state persistence   Implemented             A detected transition
                                                     is written to DynamoDB.

  Revocation-state           Implemented             Explicit revocation
  persistence                                        updates the stored
                                                     status.

  Per-session temporary AWS  Not yet implemented     Major remaining
  credentials                                        milestone.

  Immediate revocation of    Not                     Database status alone
  issued STS credentials     implemented/verified    cannot revoke
                                                     credentials already
                                                     issued.

  Entitlement graph          Planned                 Not implemented in the
                                                     recorded code.

  Event-driven               Planned                 Not implemented end to
  detection/response                                 end.

  API caller authentication  Not implemented         Local development
                                                     prototype, not
                                                     production-ready.

  Concurrency-safe           Not fully solved        A race can exist
  authorization/revocation                           between checking a
                                                     session and completing
                                                     an S3 request.
  --------------------------------------------------------------------------

## 3. Timeline

The dates below distinguish recorded activity from approximate
sequencing. Exact commit dates and hashes should be taken from Git
history.

### Phase 1 --- AWS lab foundation

**Goal:** establish a small, private AWS environment for scoped-access
tests using synthetic data.

#### Account and region

-   AWS account used for the lab: `023644376485`.
-   Region: `ap-south-1` (Mumbai).
-   The lab uses synthetic data only.
-   The application path uses an IAM user profile that assumes a
    dedicated role. Root credentials are not intended for application
    operations.

#### S3 bucket and test objects

-   Bucket: `cloudsec.proj.aicgate`.
-   Synthetic object: `logs/sample.log`.
-   Restricted object: `restricted/secret.txt`.
-   Recorded bucket settings:
    -   all four S3 Block Public Access options enabled;
    -   Bucket owner enforced object ownership, with ACLs disabled;
    -   SSE-S3 default encryption enabled;
    -   versioning and Object Lock were not enabled in the recorded
        setup.

Example `logs/sample.log` contents:

``` text
2026-10-11T10:00:00Z INFO AIC-Gate lab started
2026-10-11T10:01:00Z INFO Synthetic test event
```

Example `restricted/secret.txt` contents:

``` text
AIC-Gate restricted-prefix test file.
Synthetic data only. No real credentials or secrets.
```

These objects are deliberately synthetic. Do not place real secrets,
personal data, production logs, or access keys in the lab bucket.

#### IAM roles and policies

The lab established these identities and permissions:

-   IAM user: `AIC_GATE_DEV`.
-   IAM role: `AICGateLogsReader`.
-   S3 policy: `AICGate-LogsReadOnly`.
-   Assume-role policy attached to the developer IAM user:
    `AICGate-AssumeLogsReader`.
-   DynamoDB policy: `AICGate-SessionsAccess`.

The role trust policy was narrowed to allow the intended IAM user to
assume `AICGateLogsReader`. The S3 read-only policy allowed listing the
`logs/` prefix and reading objects under `logs/*`; it did not allow
reading `restricted/`.

The local AWS configuration uses two named profiles:

-   `aic-gate-dev`: credentials for the IAM developer user.
-   `aic-gate-logs-reader`: assumes `AICGateLogsReader` using
    `aic-gate-dev` as its source profile.

The role session name observed during testing was `aic-gate-test`.

**Credential hygiene:** never commit AWS access keys, secret keys,
session tokens, or populated credential files to Git. Do not paste
credentials into issues, documentation, or chat. Profile names are safe
to document; credential values are not.

#### S3 access verification

The following behavior was verified using the assumed role:

-   Reading `s3://cloudsec.proj.aicgate/logs/sample.log` succeeded.
-   Reading `s3://cloudsec.proj.aicgate/restricted/secret.txt` was
    denied with `AccessDenied`.
-   IAM policy simulation showed the intended allowed/denied split.

This established a real AWS enforcement boundary for the role's static
policy. It did not establish per-request JIT credentials.

### Phase 2 --- Python backend and request validation

**Goal:** implement a testable backend for validating access requests
and managing session metadata.

#### Backend structure

The Python backend lives under `backend/src/aic_gate/`, with tests under
`backend/tests/`.

Key modules:

-   `validation.py`: access request model and validation rules.
-   `session.py`: session model, creation, status calculation, and
    revocation helper.
-   `service.py`: session workflow and authorization checks.
-   `aws_client.py`: Boto3 setup and S3 object reading.
-   `session_store.py`: DynamoDB persistence helpers.
-   `main.py`: FastAPI endpoints.

Run the local API with:

``` bash
uvicorn aic_gate.main:app --reload --app-dir backend/src
```

Swagger UI is available at:

``` text
http://127.0.0.1:8000/docs
```

Run tests from the repository root:

``` bash
PYTHONPATH=backend/src python -m pytest backend/tests -v
```

#### Request validation

The `AccessRequest` validation logic records these rules:

-   The bucket must match the expected format and configured bucket
    allowlist.
-   The configured lab bucket is `cloudsec.proj.aicgate`.
-   Prefixes are checked for unsafe traversal/path characters and
    control characters.
-   The action list must be non-empty, contain no duplicates, and use
    allowed actions.
-   The recorded allowed action names are `s3:GetObject` and
    `s3:ListBucket`.
-   Duration must be an integer, not a boolean masquerading as an
    integer, and must be between 15 and 60 minutes inclusive.
-   The reason must be non-empty and no longer than 300 characters.

These are application validation rules. AWS IAM permissions must
independently enforce the actual resource/action boundary.

#### Session model

`AccessSession` records:

-   `session_id`
-   `bucket`
-   `prefix`
-   `actions`
-   `created_at`
-   `expires_at`
-   `status`

Recorded status values are `ACTIVE`, `EXPIRED`, and `REVOKED`.

Session helper functions create unique IDs and timestamps, calculate
expiry, and mark a session revoked. Expiry is evaluated from the
timestamp rather than trusting a stored `ACTIVE` value indefinitely.

#### FastAPI endpoints

The recorded API exposes:

-   `GET /health`
-   `POST /requests`
-   `GET /sessions/{session_id}`
-   `POST /sessions/{session_id}/revoke`
-   `GET /sessions/{session_id}/objects?key=...`

The object endpoint calls `read_session_object()`. Recorded response
behavior includes:

-   `404` for an unknown session;
-   `403` when a session is inactive or the requested object is outside
    the permitted scope;
-   success JSON containing the session ID, key, and object content when
    authorized.

The API currently has no caller authentication. Keep it local until
authentication and other production controls are implemented.

### Phase 3 --- Real S3 integration through Boto3

**Goal:** connect object reads to real S3, rather than relying only on
mocked responses.

`aws_client.py` creates an S3 client using the `aic-gate-logs-reader`
profile and `ap-south-1` region. `read_s3_object(bucket, key)` calls
`get_object`, decodes the body as UTF-8, and closes the response body in
a `finally` block.

This profile-based setup is suitable for local development. A deployed
service should use a workload IAM role or equivalent managed identity
instead of depending on a developer's local profile.

`backend/tests/test_aws_client.py` includes integration tests for:

-   successful read of the permitted synthetic log object;
-   expected denial when reading the restricted object.

These tests make real AWS calls and depend on the configured profile,
network access, and current IAM setup. They differ from unit tests that
mock AWS calls.

### Phase 4 --- API-level access checks and revocation behavior

**Goal:** verify that the API checks session state and requested object
scope before reading S3.

The service's object-read workflow checks:

1.  whether the session exists;
2.  whether the session is active and has not expired;
3.  whether `s3:GetObject` is in the session's allowed actions;
4.  whether the key belongs to the session's authorized prefix;
5.  only then, calls the S3 client.

Recorded manual Swagger verification:

1.  Submit a request for bucket `cloudsec.proj.aicgate`, prefix `logs/`,
    action `s3:GetObject`, and a 15-minute duration.
2.  Read `logs/sample.log` through the session object endpoint; it
    returned success and synthetic log contents.
3.  Try `restricted/secret.txt`; the request was rejected with `403`.
4.  Revoke the session.
5.  Try reading `logs/sample.log` again; the request was rejected with
    `403` because the session was no longer active.

This verifies application-level checks on the API path. It does not
prove immediate revocation of an already-issued AWS credential;
per-session STS credential issuance has not yet been implemented.

### Phase 5 --- DynamoDB session store

**Goal:** persist session records so they can be recovered after an API
process restart.

#### Table setup

The DynamoDB table is named **`AICGateSession`** (singular). An earlier
code constant mistakenly used `AICGateSessions` (plural); this was
corrected after AWS returned `ResourceNotFoundException`.

Recorded configuration:

-   Region: `ap-south-1`.
-   Partition key: `session_id` (String).
-   No sort key.
-   On-demand billing mode/default configuration.
-   Default encryption.
-   Table status was successfully checked as `ACTIVE`.

The IAM policy resource ARN must match the singular table name:

``` text
arn:aws:dynamodb:ap-south-1:023644376485:table/AICGateSession
```

#### IAM permissions for the store

The `AICGate-SessionsAccess` policy is attached to `AICGateLogsReader`.
The intended actions in the policy are:

-   `dynamodb:PutItem`
-   `dynamodb:GetItem`
-   `dynamodb:UpdateItem`
-   `dynamodb:DescribeTable`

The resource is limited to the `AICGateSession` table.

A cleanup attempt failed because `dynamodb:DeleteItem` is not allowed.
No extra permission was added solely to delete temporary test records.
Deletion was not required for the application workflow, and retaining
session history may help with auditing. If deletion becomes a real
product requirement, define its lifecycle and authorization deliberately
rather than casually broadening the policy.

#### Boto3 session configuration correction

The first implementation attempted to pass `profile_name` directly to
`boto3.resource()`, causing:

``` text
TypeError: Session.resource() got an unexpected keyword argument 'profile_name'
```

It was corrected to create a Boto3 session first and then create the
DynamoDB resource from that session:

``` python
def get_sessions_table():
    session = boto3.Session(
        profile_name="aic-gate-logs-reader",
        region_name="ap-south-1",
    )
    dynamodb = session.resource("dynamodb")
    return dynamodb.Table(TABLE_NAME)
```

After fixing IAM permissions and the table name,
`get_sessions_table().table_status` returned `ACTIVE`.

#### Store functions

`session_store.py` has the following recorded responsibilities:

-   `get_sessions_table()`: creates a DynamoDB table resource through
    the assumed-role profile.
-   `save_session(session)`: converts a session to a DynamoDB item,
    serializing `actions` as a list and timestamps as ISO-8601 strings,
    then writes the item.
-   `load_session(session_id)`: fetches an item by partition key and
    returns the item or `None`.
-   `load_access_session(session_id)`: reconstructs an `AccessSession`
    from a DynamoDB item and parses timestamps with
    `datetime.fromisoformat`.
-   `update_session_status(session_id, status)`: updates the status
    attribute, with a condition that the record already exists.

The current repository implementation is the source of truth if it
differs from this summary.

#### Connecting persistence to the service

The service was updated incrementally:

1.  `submit_access_request()` validates the request, creates a session,
    saves it to DynamoDB, and retains it in the in-memory cache.
2.  `get_session()` initially used the in-memory cache with a DynamoDB
    fallback.
3.  It was then changed to load from DynamoDB on each lookup and refresh
    the cache. This makes DynamoDB the source of truth for retrieval
    instead of relying on the cache alone.
4.  `get_current_session_status()` recalculates expiry from timestamps
    and writes changed status back to DynamoDB.
5.  `revoke_access_session()` marks the session revoked and persists
    `REVOKED`.
6.  `read_session_object()` checks the loaded session's status, allowed
    action, and prefix before calling S3.

The `_sessions` dictionary remains as a cache, but session retrieval no
longer relies on it as the sole store.

#### Persistence verification

The following checks were run successfully:

-   The table status check returned `ACTIVE`.
-   A synthetic record was saved and loaded with its fields and
    timestamps intact.
-   Clearing `_sessions` and calling `get_session('ddb-smoke-test')`
    recovered the session from DynamoDB.
-   Revoking the smoke-test session persisted `REVOKED`; after clearing
    the cache, the recovered session still showed `REVOKED`.
-   A record named `ddb-expiry-test` was written with an old
    `expires_at` timestamp but a stored status of `ACTIVE`.
-   Calling `get_current_session_status('ddb-expiry-test')` calculated
    `EXPIRED` and persisted that status.
-   Loading the item directly from DynamoDB then returned stored status
    `EXPIRED`.

Synthetic IDs used during these checks:

-   `ddb-smoke-test`
-   `ddb-expiry-test`

An attempt to delete them failed with `AccessDeniedException` because
the assumed role lacks `dynamodb:DeleteItem`. The records may therefore
still exist. This does not affect normal application behavior. Do not
claim they were deleted.

### Phase 6 --- Object-key hardening

**Goal:** reject malformed S3 keys and prevent path-like input from
bypassing the intended prefix boundary.

The service's `read_session_object()` function was corrected after a
malformed edit during manual code changes. Its current recorded flow is:

1.  Load the session from the service.
2.  Raise `LookupError` if it doesn't exist.
3.  Calculate status with `get_session_status()`.
4.  If status changed, persist it using `update_session_status()`.
5.  Reject non-active sessions.
6.  Require `s3:GetObject`.
7.  Normalize the configured prefix with `session.prefix.strip("/")`.
8.  Reject a key if it is empty, begins with `/`, contains a backslash,
    or contains an empty, `.` or `..` path component.
9.  Require the key to start with the authorized prefix plus `/`.
10. Call `read_s3_object()` only after the checks succeed.

Focused tests in `backend/tests/test_service.py` cover these invalid
keys:

-   empty string;
-   `/logs/sample.log`;
-   `logs/../restricted/secret.txt`;
-   `logs/./sample.log`;
-   `logs//sample.log`;
-   `logs\\sample.log` (backslash path form).

The tests also fail explicitly if `read_s3_object()` is called for an
invalid key. All service tests passed after this addition.

**Boundary note:** string checks are useful input validation, but they
do not replace AWS IAM restrictions. Keep application checks and
AWS-side least-privilege controls.

## 4. Test history and recorded verification

The following outcomes were reported during development:

  -----------------------------------------------------------------------
  Test/check              Result                  What it demonstrates
  ----------------------- ----------------------- -----------------------
  Validation tests        Passed                  Request constraints are
                                                  enforced by the
                                                  validator.

  Session tests           Passed                  Session creation,
                                                  status, and revocation
                                                  helpers behave as
                                                  expected.

  Service tests after     Passed                  Existing service
  DynamoDB integration                            behavior remained
                                                  compatible as
                                                  persistence was
                                                  introduced.

  API tests               Passed in earlier       Endpoints and error
                          recorded run            responses worked with
                                                  the service layer.

  S3 integration tests    Passed in earlier       Assumed role could read
                          recorded run            the log object and was
                                                  denied the restricted
                                                  object.

  DynamoDB table status   Passed (`ACTIVE`)       Table was reachable
  check                                           using the configured
                                                  assumed-role profile.

  DynamoDB save/load      Passed                  Session fields were
  smoke test                                      serialized and
                                                  reconstructed.

  Cache-clear retrieval   Passed                  Service recovered a
  test                                            session from DynamoDB
                                                  after clearing the
                                                  cache.

  Revocation persistence  Passed                  `REVOKED` remained
  test                                            after a cache clear and
                                                  reload.

  Expiry recalculation    Passed                  Stale stored `ACTIVE`
  test                                            became `EXPIRED` when
                                                  evaluated after expiry.

  Stored expiry status    Passed                  DynamoDB contained
  check                                           `EXPIRED` after the
                                                  transition.

  Invalid object-key      Passed                  Malformed keys were
  tests                                           rejected before S3 was
                                                  called.

  Latest full test suite  Passed, with one        The suite passed after
                          previously observed     the recorded
                          non-fatal warning       persistence and
                                                  validation changes.
  -----------------------------------------------------------------------

The exact final test count was not captured at the latest checkpoint. Do
not infer or publish a precise count unless it is obtained from a fresh
test run.

### Common commands

Run from the repository root with the project virtual environment
activated:

``` bash
PYTHONPATH=backend/src python -m pytest backend/tests -v
```

Service-only tests:

``` bash
PYTHONPATH=backend/src python -m pytest backend/tests/test_service.py -v
```

Local API:

``` bash
uvicorn aic_gate.main:app --reload --app-dir backend/src
```

The Python shell must use the project's `.venv`. In the recorded setup,
external Git Bash initially did not have `boto3` in its active Python
environment. Activating `.venv` and installing `boto3` into it resolved
the missing-module error. Different terminals can select different
Python environments, so verify with:

``` bash
python -c "import sys; print(sys.executable)"
```

## 5. AWS resources and configuration inventory

  ---------------------------------------------------------------------------------
  Resource                Name / value                 Purpose
  ----------------------- ---------------------------- ----------------------------
  AWS account             `023644376485`               Personal lab account

  AWS region              `ap-south-1`                 Mumbai

  S3 bucket               `cloudsec.proj.aicgate`      Synthetic test data

  S3 permitted prefix     `logs/`                      Test prefix allowed for
                                                       reads

  S3 restricted prefix    `restricted/`                Negative authorization test

  IAM developer user      `AIC_GATE_DEV`               Local source identity for
                                                       assuming the role

  IAM reader role         `AICGateLogsReader`          Assumed role used by local
                                                       AWS integration

  S3 policy               `AICGate-LogsReadOnly`       List/read permissions for
                                                       logs prefix

  Assume-role policy      `AICGate-AssumeLogsReader`   Allows the intended
                                                       developer identity to assume
                                                       the reader role

  DynamoDB table          `AICGateSession`             Persistent session records

  DynamoDB policy         `AICGate-SessionsAccess`     Session
                                                       read/write/update/describe
                                                       permissions

  Local source profile    `aic-gate-dev`               Developer IAM credentials;
                                                       secret values remain local

  Local assumed-role      `aic-gate-logs-reader`       Assumes `AICGateLogsReader`
  profile                                              in `ap-south-1`

  Observed role session   `aic-gate-test`              Example STS session name
  name                                                 
  ---------------------------------------------------------------------------------

This describes the recorded lab setup, not a guarantee that the AWS
console still has exactly these settings. Confirm live configuration
before relying on it for a demo.

## 6. Repository and Git status

-   Repository: `shhreyuuFW/AIC-GATE` (private, as recorded).
-   Working branch: `feature/jit-request-validation`.
-   The latest recorded branch state before the final Git cleanup
    discussion was reported as up to date with
    `origin/feature/jit-request-validation`.
-   The latest `git status` output also showed uncommitted changes and
    untracked files:
    -   Modified: `backend/src/aic_gate/main.py`
    -   Modified: `backend/src/aic_gate/validation.py`
    -   Modified: `backend/tests/test_api.py`
    -   Modified: `backend/tests/test_session.py`
    -   Modified: `backend/tests/test_validation.py`
    -   Untracked: `backend/src/aic_gate/aws_client.py`
    -   Untracked: `backend/tests/test_aws_client.py`
    -   Untracked: `test_aws_connection.py`

The user then staged the seven project files listed above, excluding
`test_aws_connection.py`, and was instructed to inspect the staged diff
before committing/pushing. A successful commit and push for those files
was **not confirmed in the recorded conversation**. Do not assume these
changes are pushed until `git status` and `git log` confirm it.

Useful commands:

``` bash
git status
git diff --check
git diff --stat
git diff --cached --stat
git log -5 --oneline
```

Before committing, check that no AWS credentials, secret keys, session
tokens, `.env` files, or other sensitive files are staged. Avoid blindly
staging everything with `git add .`.

## 7. Known limitations and risks

### 7.1 Not yet per-session JIT credential issuance

The service currently uses the assumed-role profile to perform S3 reads.
It does not yet issue unique, scoped temporary AWS credentials for each
approved request. This is the central remaining architectural milestone.

### 7.2 Database status is not STS credential revocation

Changing a DynamoDB record to `REVOKED` or `EXPIRED` affects the
application's decision when it checks that record. It does not
invalidate an AWS STS credential that has already been issued. Design
and test AWS-side enforcement before claiming immediate credential
revocation.

### 7.3 API has no caller authentication

The current FastAPI prototype does not authenticate API callers. Keep it
local and use synthetic data until authentication, requester
authorization, secure deployment settings, and audit requirements are
implemented.

### 7.4 Concurrency and in-flight requests

There may be a time-of-check/time-of-use gap between reading session
state and performing the S3 request. A concurrent revocation cannot
necessarily stop an S3 request that has already passed the application
check. Define and test guarantees for concurrent and in-flight
operations.

### 7.5 Expiry is evaluated on checks

The expiry logic calculates status when the application checks a
session. It is not a background scheduler that updates every expired
record exactly at the expiry timestamp. Authorization must calculate or
verify expiry at time of use, even if stored status has not yet
refreshed.

### 7.6 Local AWS profile dependency

The AWS client and session store use a local named profile. This is a
development convenience, not the preferred deployment identity model.
Production should use workload role credentials and avoid static
developer credentials.

### 7.7 Dependency declaration

`boto3` was installed in the local virtual environment. The recorded
`pyproject.toml` dependencies did not yet include `boto3`. Add it to
declared project dependencies before expecting a fresh clone or clean
install to run AWS integration code reliably.

### 7.8 Test warning

One non-fatal Starlette/httpx-related deprecation warning was observed.
It did not cause test failures. Revisit it as a separate maintenance
task.

### 7.9 AWS costs

AWS resources may incur charges depending on usage, account plan, and
current pricing. Check Billing and active resources periodically. Do not
assume an account plan or past free-tier entitlement makes all usage
free.

## 8. Recommended next milestones

### Milestone 1 --- Confirm repository state and dependencies

-   Confirm all intended changes are committed and pushed.
-   Inspect `git status` and recent commit history.
-   Add `boto3` to `pyproject.toml` dependencies if still missing.
-   Decide whether `test_aws_connection.py` is a permanent test or
    temporary script.
-   Run the full suite.

**Completion criterion:** a clean checkout can install declared
dependencies and run non-AWS tests; AWS tests have clear setup
requirements.

### Milestone 2 --- Make persistence behavior explicit and robust

-   Review `session_store.py` imports and formatting.
-   Add focused tests for save, load, reconstruction, and status
    updates.
-   Test missing-session behavior.
-   Test that status updates do not silently create partial records.
-   Decide whether `_sessions` is needed as a cache; if retained,
    document its purpose.
-   Define expected behavior for concurrent updates and conditional
    writes.

**Completion criterion:** persistent lifecycle behavior is covered by
tests and has documented error semantics.

### Milestone 3 --- Design actual JIT grant issuance

Before coding, document a threat model and credential flow:

-   who may request access;
-   who approves or automatically authorizes a request;
-   how the request is bound to an identity;
-   how the role session is scoped to the requested bucket, prefix, and
    actions;
-   how duration maps to AWS session limits;
-   how credentials are delivered safely and never logged;
-   how expiry is enforced by AWS;
-   what happens on early revocation;
-   how failures and partial operations are handled.

Do not equate an application session ID with AWS credentials. A session
ID is a database identifier, not an authorization token.

**Completion criterion:** the written design identifies the AWS
mechanism that enforces the temporary grant and its limitations.

### Milestone 4 --- Implement least-privilege temporary access

-   Use the appropriate STS/IAM mechanism for scoped temporary access.
-   Constrain each grant to the approved bucket, prefix, and actions.
-   Avoid broad wildcards or user-controlled arbitrary IAM policy
    documents.
-   Test allowed and denied access using the resulting temporary
    credentials.
-   Test that credentials stop working after AWS-enforced expiry.
-   Define and test early-revocation behavior rather than claiming it
    exists because a database flag changed.

**Completion criterion:** the actual AWS credentials, not merely the API
response, demonstrate the intended permissions and time boundary.

### Milestone 5 --- Authentication, audit, and operations

-   Authenticate API callers and bind requests to identities.
-   Separate requester, approver, and service roles if required by the
    threat model.
-   Record request, grant, denial, expiry, and revocation events without
    storing secrets.
-   Define retention for session/audit records.
-   Add structured logging and safe error handling.
-   Decide whether the service needs background expiry processing,
    event-driven hooks, or on-demand status recalculation.

**Completion criterion:** a reviewer can trace a grant lifecycle without
seeing credentials or relying on unstructured console output.

### Milestone 6 --- Entitlement graph and detection

-   Define graph entities and edges (identity, session, role, resource,
    action, grant).
-   Define how the graph updates and how stale edges are removed or
    marked.
-   Add detection rules for unauthorized requests, scope violations,
    expired-session use, and unusual grant patterns.
-   Test detection with synthetic events.
-   Document false-positive behavior and response actions.

**Completion criterion:** the graph and detection layer have clear
semantics, sample data, tests, and a demonstrable use case.

### Milestone 7 --- Demo and documentation

-   Keep architecture diagrams aligned with the implementation, not only
    the original ambition.
-   Document setup, IAM prerequisites, profile configuration, and test
    commands.
-   Include a threat model, security assumptions, limitations, and test
    evidence.
-   Demonstrate positive and negative cases.
-   Remove temporary scripts and test records only through an explicitly
    authorized cleanup path.

**Completion criterion:** a teammate can set up the lab, run tests,
reproduce the demo, and understand exactly what has and has not been
proven.

## 9. Working conventions

1.  Make one small, reviewable change at a time.
2.  Run the smallest relevant test first, then the full suite before a
    milestone commit.
3.  Keep AWS integration tests distinct from mocked unit tests.
4.  Never store credentials or secrets in source control.
5.  Prefer explicit IAM resources and actions over broad permissions.
6.  Document the difference between application-level status and
    AWS-enforced authorization.
7.  Do not claim immediate revocation, guaranteed expiry, or production
    readiness without corresponding enforcement and tests.
8.  Update this timeline when a milestone is implemented, tested, and
    committed.
9.  Record commit hashes for meaningful milestones so this narrative can
    be tied to repository history.
10. If cleanup fails due to IAM, do not broaden permissions
    automatically; decide whether the action is actually required.

## 10. Quick onboarding

### Local development

From the repository root, activate the virtual environment. In Git Bash
on Windows, the recorded command is:

``` bash
source .venv/Scripts/activate
```

Confirm the interpreter:

``` bash
python -c "import sys; print(sys.executable)"
```

Run tests:

``` bash
PYTHONPATH=backend/src python -m pytest backend/tests -v
```

Run the API:

``` bash
uvicorn aic_gate.main:app --reload --app-dir backend/src
```

Open Swagger at `http://127.0.0.1:8000/docs`.

### AWS prerequisites

-   Configure local AWS profiles without putting keys in the repository.
-   Ensure `aic-gate-logs-reader` assumes the intended role.
-   Use region `ap-south-1`.
-   Confirm S3 bucket and DynamoDB table names match the application
    constants.
-   Ensure IAM policies reference `AICGateSession` (singular) and the
    intended S3 bucket/prefix.
-   Remember AWS integration tests make real calls and may incur
    charges.

### First task for a new contributor

Confirm the current Git state and that the latest work is pushed. Then
design the actual per-request JIT credential flow and AWS-side
enforcement before adding more implementation code.

## 11. Change log at a glance

  ----------------------------------------------------------------------------------------
  Area                    Change                                   Verification
  ----------------------- ---------------------------------------- -----------------------
  AWS identity            Configured developer profile and assumed STS identity showed
                          reader role                              assumed role

  S3 policy               Restricted reads to `logs/`              Allowed log read;
                                                                   restricted object
                                                                   denied

  Request validation      Added                                    Validation tests passed
                          bucket/prefix/action/duration/reason     
                          checks                                   

  Session lifecycle       Added session creation, expiry           Session tests passed
                          calculation, and revocation helpers      

  FastAPI                 Added request, status, revoke, and       API tests and manual
                          object-read endpoints                    Swagger checks passed
                                                                   in recorded runs

  S3 client               Added Boto3 read function with           AWS integration tests
                          response-body cleanup                    passed in recorded runs

  DynamoDB                Created `AICGateSession` table and       Table status returned
                          access policy                            `ACTIVE`

  Session persistence     Added                                    Save/load and recovery
                          save/load/reconstruction/status-update   checks passed
                          helpers                                  

  Service integration     Persisted creation, lookup, expiry       Service tests passed
                          transition, and revocation               

  Object-key validation   Rejected malformed path-like keys before Focused invalid-key
                          S3 access                                tests passed

  Git workflow            Worked on                                Latest commit/push
                          `feature/jit-request-validation`         status needs
                                                                   confirmation
  ----------------------------------------------------------------------------------------

## 12. Final status

AIC-GATE has progressed from an AWS lab and API prototype to a prototype
with real S3 authorization checks and persistent session metadata. The
main remaining work is **designing, implementing, and proving actual JIT
credential grants and AWS-side enforcement**.

Treat this document as a development log, not proof that the project is
production-ready. Update the status and add commit hashes as milestones
are completed.
