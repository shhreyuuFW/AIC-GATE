export type UserRole = "requester" | "admin";
export type ServiceType = "s3" | "dynamodb" | "cloudwatch_logs" | "ssm";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface UserProfile {
  user_id: string;
  username: string;
  display_name: string;
  role: UserRole;
  department: string;
  org_id: string;
  mfa_enabled: boolean;
}

export interface OrganizationInfo {
  org_id: string;
  org_name: string;
  allowed_domain: string;
  invite_code: string;
  created_at: string;
}

export interface MemberAccount {
  user_id: string;
  org_id: string;
  username: string;
  email: string;
  display_name: string;
  department: string;
  role: UserRole;
  status: "ACTIVE" | "PENDING_APPROVAL" | "REJECTED";
  mfa_enabled: boolean;
  created_at: string;
}

export interface LoginResponse {
  mfa_required: boolean;
  mfa_challenge_token?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: UserProfile;
}

export type LoginResult =
  | { mfaRequired: true; challengeToken: string }
  | { mfaRequired: false; user: UserProfile };

export interface MfaSetupResponse {
  secret: string;
  otpauth_uri: string;
}

export interface CatalogResourceItem {
  resource_id: string;
  service: ServiceType;
  label: string;
  description: string;
  environment: string;
  allowed_actions: string[];
  related_resource_ids: string[];
  default_scope: string;
}

export type RequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CREATING_SESSION"
  | "SESSION_CREATED";

export interface AccessRequestItem {
  request_id: string;
  requester_id: string;
  org_id: string;
  service: ServiceType;
  resource_id: string | null;
  bucket: string;
  prefix: string;
  actions: string[];
  duration_minutes: number;
  reason: string;
  risk_level: RiskLevel;
  status: RequestStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  session_id?: string | null;
}

export type SessionStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface AccessSessionItem {
  session_id: string;
  request_id: string | null;
  requester_id: string | null;
  org_id: string;
  service: ServiceType;
  resource_id: string | null;
  bucket: string;
  prefix: string;
  actions: string[];
  created_at: string;
  expires_at: string;
  status: SessionStatus;
}

export interface TemporaryCredentials {
  access_key_id: string;
  secret_access_key: string;
  session_token: string;
  expires_at: string;
}

export interface CreatedSessionWithCredentials extends AccessSessionItem {
  credentials: TemporaryCredentials;
}

export interface PolicyStatement {
  Sid: string;
  Effect: "Allow" | "Deny";
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, unknown>;
}

export interface PolicyDocument {
  Version: string;
  Statement: PolicyStatement[];
}

export interface ObjectReadResponse {
  session_id: string;
  key: string;
  content: string;
}

export interface AuditEventItem {
  event_id: string;
  timestamp: string;
  action: string;
  actor_id: string;
  actor_role: string;
  resource_id: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
  details: Record<string, unknown>;
}

export interface SecurityProofCheck {
  id: string;
  control: string;
  expected: string;
  passed: boolean;
  detail: string;
}

export interface SecurityProofResponse {
  passed: number;
  total: number;
  executed_at: string;
  checks: SecurityProofCheck[];
}
