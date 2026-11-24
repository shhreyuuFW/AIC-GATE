# Project AIC-Gate
## Implementation Plan and Technical Design

**Project name:** Automated Identity Controller & JIT Gateway  
**Project type:** Cloud security engineering project  
**Primary platform:** Amazon Web Services (AWS)  
**Status:** Architecture and implementation plan finalized; implementation is staged  
**Document purpose:** Establish the agreed MVP scope, architecture, security assumptions, implementation sequence, testing strategy, and cost controls before further development.

---

## 1. Executive Summary

AIC-Gate is a Just-in-Time (JIT) cloud access control system for Amazon S3. It is intended to reduce standing privileges by allowing an authenticated identity to request narrowly scoped, time-limited access to approved S3 resources.

The system will validate access requests, authorize them against explicit rules, issue appropriately scoped temporary AWS credentials, record active sessions, visualize active entitlements, and track expiration and revocation events.

The project will prioritize demonstrable security guarantees over visual features. The dashboard will display the system's state; it will not be the security enforcement mechanism. AWS authorization and credential expiry must enforce access independently of the dashboard or session database.

The initial release will be a small, isolated lab implementation using synthetic data. It will not target production data or claim instant revocation unless testing proves the exact behavior and limitations.

## 2. Problem Statement

Standing permissions and long-lived credentials can increase the impact of an identity compromise. Teams may also lack a clear, current view of which identities can access which cloud resources.

AIC-Gate addresses these problems by aiming to:

- Reduce standing access to sensitive S3 data.
- Grant access only to an authenticated and authorized identity.
- Restrict grants to approved resources, actions, and durations.
- Track who has access, to what, and until when.
- Show current and recently expired entitlements.
- Record access decisions and investigate suspicious or denied activity.
- Test expiration and early-revocation behavior rather than assume that a database update revokes cloud permissions.

## 3. Goals and Non-Goals

### 3.1 MVP goals

The first working release will demonstrate:

1. An isolated AWS lab and a private S3 test bucket.
2. An authenticated test identity.
3. Request validation and authorization for a specific S3 prefix.
4. Read-only access to approved objects.
5. Temporary credentials issued through AWS STS.
6. Persistent session records after local prototyping.
7. Session expiration tracking and cleanup.
8. An entitlement graph showing identity, session, and resource relationships.
9. Tests proving that unauthorized requests fail and expired credentials no longer work for the protected resource.
10. Documented limitations, security assumptions, and cost controls.

### 3.2 Out of scope for the first release

The MVP will not initially include:

- Access to production buckets or real sensitive data.
- Broad multi-account or enterprise identity federation.
- Write, delete, or administrative S3 permissions.
- Complex multi-person approval workflows.
- Automated changes to production bucket policies for every request.
- Claims of instantaneous revocation without verified enforcement.
- Advanced attack-path analytics beyond the entitlement information needed for the MVP.

These may be considered after the baseline implementation is tested.

## 4. Core Security Concepts

### 4.1 Authentication

Authentication establishes which user or service is making a request. AIC-Gate must use a verifiable identity source. It must not trust a username or principal identifier supplied freely in the request body.

### 4.2 Authorization

Authorization determines whether the authenticated identity may request the specified resource and actions. The backend must enforce an explicit allowlist and least-privilege rules.

### 4.3 Session management

A session record represents an approved temporary access grant. It includes an identifier, authenticated principal, resource scope, permitted actions, creation time, expiry time, and lifecycle state.

The session record is metadata, not the authorization boundary. Changing a record to `EXPIRED` or `REVOKED` does not by itself invalidate AWS credentials or remove IAM permissions.

### 4.4 Credential expiry and revocation

Temporary AWS STS credentials expire automatically at their assigned expiry. Early revocation is a separate problem and must use a documented AWS enforcement mechanism. A policy update or database status change must not be described as immediate revocation unless its actual effects have been tested.

### 4.5 Entitlement graph

The graph is a visualization of authoritative backend state. It will display relationships such as:

`Identity → Session → S3 Resource`

A browser countdown is informational only. AWS must enforce access expiry even if the browser is closed, the dashboard is offline, or a client clock is inaccurate.

## 5. Proposed Architecture

### 5.1 Logical request flow

1. A user or service authenticates to the chosen identity provider.
2. The identity makes a JIT access request through the API.
3. API Gateway passes the request to a Lambda handler.
4. The handler validates the request and determines whether the identity is allowed to request the resource and actions.
5. The broker uses a controlled IAM role and AWS STS to obtain appropriately scoped temporary credentials.
6. The broker records session metadata in DynamoDB.
7. The authorized client uses the temporary credentials to access the approved S3 resources.
8. Session expiration is enforced by AWS credential expiry.
9. A separate workflow updates session state and graph data, and records lifecycle events.
10. Relevant AWS audit events are used for investigation and detection, subject to actual event coverage and delivery behavior.

### 5.2 Components

| Component | Proposed technology | Responsibility |
|---|---|---|
| API entry point | Amazon API Gateway | Accept requests and apply API-level controls |
| Request handler | AWS Lambda with Python | Validate requests and orchestrate access grants |
| Identity and permissions | AWS IAM | Define trusted principals and permitted actions |
| Temporary credentials | AWS STS | Issue time-limited credentials |
| Object storage | Amazon S3 | Hold synthetic lab data with public access blocked |
| Session state | Amazon DynamoDB | Persist session and lifecycle metadata |
| Expiry orchestration | AWS Step Functions or scheduled processing | Update session state and perform cleanup |
| Dashboard | JavaScript and Cytoscape.js | Display entitlements and countdowns |
| Audit and investigation | AWS CloudTrail and suitable monitoring | Support investigation of recorded AWS activity |
| Tests | Python and pytest | Validate request rules, lifecycle logic, and security behavior |

The final choice between Step Functions and simpler scheduled processing will be made after the session lifecycle and cost requirements are clearer. No component should be added merely because it appears in the original diagram.

## 6. Key Architecture Decision Records

### ADR-001: Temporary access mechanism

**Decision:** Use AWS STS temporary credentials as the primary MVP access mechanism.

**Reasoning:** This demonstrates real temporary AWS authorization without requiring per-request mutation of a shared production bucket policy.

**Alternatives considered:**

- Dynamically add and remove IAM or S3 bucket policy statements.
- Proxy every object request through an application.

**Trade-offs:** STS requires correct role trust, credential handling, session policy scope, and identity validation. Policy mutation introduces concurrency and cleanup risks. A proxy provides centralized request handling but becomes a critical security component and adds operational complexity.

**Future work:** Policy injection and early-revocation experiments may be added in an isolated lab after the basic mechanism works.

### ADR-002: Session state

**Decision:** Use local test data during early development and DynamoDB for deployed persistent state.

**Reasoning:** Local testing avoids cloud cost while basic behavior is being learned. DynamoDB provides persistent records for deployed serverless components.

### ADR-003: Expiration and revocation

**Decision:** Separate AWS credential expiry from application session cleanup and early revocation.

- AWS STS credential expiry limits the credential's lifetime.
- Session cleanup updates DynamoDB and the dashboard's representation.
- Early revocation requires a separately designed enforcement mechanism and dedicated tests.

The project will not claim that changing a session status or removing a policy instantly invalidates all previously issued credentials.

### ADR-004: Entitlement visualization

**Decision:** Use Cytoscape.js after the backend session model and persistence are reliable.

**Reasoning:** The graph must visualize authoritative session state rather than invent or independently control entitlements.

### ADR-005: Development and deployment

**Decision:** Implement and test local logic before deploying AWS resources. Check account-plan limitations, service availability, and costs before deployment.

## 7. MVP Security Boundaries

The initial lab will use:

- One dedicated AWS account or otherwise isolated lab environment.
- One private S3 bucket containing synthetic data.
- S3 Block Public Access.
- One approved test identity.
- One allowlisted bucket and a narrow prefix.
- Read-only object access.
- A bounded session duration of 15–60 minutes for the prototype.
- Restricted IAM roles and least-privilege permissions.
- No permanent AWS access keys committed to the repository.
- No production data.
- Separate testing for expiry and early revocation.

The 15-minute lower bound is compatible with the usual minimum duration for an assumed-role STS session. The exact session duration and role settings must be confirmed against the chosen AWS API and account configuration.

The broker must not be able to assume arbitrary roles or issue permissions broader than its approved role and policy boundaries. Credential delivery must be designed so that secrets are not stored in logs, exposed to unauthorized clients, or written to the dashboard's browser state.

## 8. Implementation Roadmap

### Phase 0 — Architecture and cost readiness

**Tasks**
- Confirm the account plan and service eligibility.
- Establish a cost-control and resource-cleanup procedure.
- Finalize the identity and authorization assumptions.
- Confirm the MVP's approved bucket, prefix, actions, and duration limits.

**Exit criteria**
- The team understands the architecture and its security boundaries.
- No cloud resources are deployed before the account and cost review.

### Phase 1 — Learn and test the local model

**Tasks**
- Review the existing `validation.py` implementation.
- Review the existing `session.py` implementation.
- Explain each function and its responsibility.
- Test valid and invalid access requests.
- Test session creation, exact expiry boundaries, and local revocation state.
- Refactor unclear or unsafe behavior before proceeding.

**Exit criteria**
- The developer can explain the validator, session model, and what they do not enforce.
- Unit tests pass locally.
- No claim is made that local session state grants or revokes AWS access.

### Phase 2 — Secure AWS lab

**Tasks**
- Create the private test bucket and synthetic test object.
- Configure S3 Block Public Access and encryption.
- Create a restricted role and trust relationship.
- Verify that unauthorized identities cannot read the object.
- Record the baseline test results.

**Exit criteria**
- The bucket is private.
- An unauthorized request is denied.
- The test identity and role have only the intended permissions.

### Phase 3 — JIT broker and STS

**Tasks**
- Define the API request and response contract.
- Authenticate the caller using the selected identity mechanism.
- Authorize the identity, bucket, prefix, actions, and duration.
- Use a controlled role and appropriately scoped STS session.
- Deliver credentials securely to the authorized client.
- Add error handling and audit-safe logs.

**Exit criteria**
- An authorized test identity can obtain the intended limited access.
- Requests for unapproved resources, actions, or durations fail.
- Secrets are not exposed in logs or repository files.

### Phase 4 — Persistent sessions

**Tasks**
- Define the DynamoDB session schema and access patterns.
- Store session ID, principal, scope, creation time, expiry, and lifecycle state.
- Handle duplicate requests and retries safely.
- Reconcile persisted records with actual grant expiry.

**Exit criteria**
- Session state survives process restarts.
- Session records accurately represent the granted scope and expiry.
- Failed or partial operations do not silently produce incorrect active records.

### Phase 5 — Expiry, cleanup, and early revocation

**Tasks**
- Implement expiry processing with Step Functions or a suitable scheduled workflow.
- Update session state and remove expired entitlements from the active view.
- Test access at and after credential expiry.
- Design and test an early-revocation mechanism separately.
- Document propagation delays and any limitations discovered.

**Exit criteria**
- Expired credentials fail to access the protected lab resource.
- Cleanup is idempotent and can recover from retries.
- Early-revocation claims match measured behavior.

### Phase 6 — Live entitlement graph

**Tasks**
- Display identity, session, and resource nodes.
- Display current session state and time remaining.
- Distinguish active, expired, revoked, and failed grants.
- Refresh data from the backend.
- Ensure graph state is informational and cannot grant access.

**Exit criteria**
- The graph reflects backend session state.
- Countdown behavior does not affect authorization.
- Expired or revoked records are no longer shown as active.

### Phase 7 — Detection and security evaluation

**Tasks**
- Review available CloudTrail events for relevant actions.
- Add appropriate event processing and alerts if justified.
- Test denied requests and attempts to exceed approved scope.
- Evaluate credential exposure, replay, concurrency, retry, and cleanup failures.
- Document evidence, limitations, and next steps.

**Exit criteria**
- Tests demonstrate allowed and denied behavior.
- The project can explain which events are recorded and how quickly they are detected.
- Results and limitations are documented reproducibly.

## 9. Testing Strategy

### Unit tests

- Empty or malformed resource names.
- Unapproved bucket or prefix.
- Unsupported actions and wildcard permissions.
- Invalid session duration.
- Missing reason or principal.
- Timezone-naive timestamps.
- Session status immediately before, at, and after expiry.
- Duplicate requests and repeated cleanup.

### Integration tests

- Approved role can read only the intended lab objects.
- Unapproved identity cannot read the objects.
- Unapproved prefixes and actions are denied.
- Temporary credentials expire as expected.
- Session records persist and remain consistent.
- Cleanup retries do not produce incorrect state.

### Security tests

- Caller cannot impersonate another principal by changing a request field.
- Caller cannot request broader permissions than allowed.
- Credential material is not written to logs.
- Public access remains blocked.
- Expiry and early revocation are evaluated separately.
- Concurrent grants do not broaden another session's access.

Tests should run first against local code and then against an isolated AWS lab. Test evidence should include the expected result, actual result, timestamp, and relevant sanitized logs.

## 10. Cost and Account Controls

Before deployment:

1. Confirm the actual AWS account plan and eligible services.
2. Review applicable credits and service-specific pricing.
3. Create billing alerts and review existing resources.
4. Avoid unnecessary NAT Gateways, always-on compute, and unrelated paid services.
5. Use synthetic data and deploy only the resources needed for the current phase.
6. Define teardown instructions for disposable lab resources.
7. Review logs, storage, requests, and workflow executions for ongoing costs.

Billing alerts are notifications, not guaranteed spending caps. A Free account plan or remaining credits must not be treated as proof that every possible service usage is free.

## 11. Team Work Allocation

The team may split work once interfaces and security assumptions are agreed.

| Role | Initial responsibility |
|---|---|
| Project lead | Architecture, integration, security review, and release decisions |
| Backend contributor | Request validation, API contract, and Lambda handlers |
| Cloud security contributor | IAM trust, policy scope, S3 baseline, and STS tests |
| Testing and UI contributor | Unit/integration test support, documentation, and graph prototype |

All contributors should work with individual accounts. AWS credentials must not be shared through chat or committed to Git. Cloud deployment permissions should be restricted and granted only when needed.

## 12. Repository Structure

```text
AIC-GATE/
├── backend/
│   ├── src/
│   │   └── aic_gate/
│   │       ├── __init__.py
│   │       ├── validation.py
│   │       └── session.py
│   └── tests/
├── infrastructure/
├── frontend/
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── architecture.md
├── tests/
├── .gitignore
└── README.md
```

The repository should not contain access keys, session tokens, `.env` secrets, production data, or other credentials. Document configuration variable names and use an appropriate secrets mechanism for real deployment.

## 13. Definition of Done

The MVP is complete when:

- An authenticated identity can request approved, limited S3 access.
- The broker rejects requests outside the approved policy.
- AWS issues temporary credentials with the intended scope.
- Access is limited by AWS authorization and credential expiry.
- Session records persist and accurately track lifecycle state.
- The dashboard reflects authoritative session state.
- Relevant audit activity can be investigated.
- Automated tests demonstrate allowed, denied, expired, and failure cases.
- Setup, teardown, cost assumptions, architecture, and limitations are documented.

A working dashboard alone does not constitute a successful security implementation. The central proof is that AWS allows the intended access and denies access outside the grant.

## 14. Immediate Next Steps

No further AWS deployment should happen until the developer can explain the current code and the agreed architecture.

1. Review `validation.py` function by function.
2. Review `session.py` and distinguish local state from AWS enforcement.
3. Confirm the identity source and role-assumption design.
4. Review the AWS account plan and service costs.
5. Build the isolated lab only after these items are understood.

**Final architectural direction:** STS temporary credentials, a private S3 lab bucket, least-privilege authorization, local tests before cloud deployment, DynamoDB for deployed session state, separate expiry cleanup, and Cytoscape.js for the later dashboard. This is the baseline design; changes should be made deliberately and documented rather than introduced ad hoc.
