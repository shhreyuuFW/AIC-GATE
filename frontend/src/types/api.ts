export type UserRole = "requester" | "admin" | "platform_admin";
export type AdminTier = "none" | "delegated" | "owner" | "master";
export type ServiceType = "s3" | "dynamodb" | "cloudwatch_logs" | "ssm";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RoleColor = "cyan" | "amber" | "green" | "volt" | "red" | "slate";
export type TicketCategory =
  | "ORG_RENAME"
  | "ADMIN_ESCALATION"
  | "MFA_RECOVERY"
  | "SERVICE_CATALOG"
  | "SECURITY_INCIDENT"
  | "GENERAL";
export type TicketStatus = "OPEN" | "IN_REVIEW" | "RESOLVED" | "CLOSED";

export interface UserProfile {
  user_id: string;
  username: string;
  display_name: string;
  role: UserRole;
  admin_tier: AdminTier;
  department: string;
  org_id: string;
  org_name: string;
  mfa_enabled: boolean;
  bio: string;
  avatar: string;
  custom_role_id: string | null;
  custom_role_name: string | null;
  custom_role_color: RoleColor | string;
  effective_role: string;
  last_login_at: string | null;
  previous_login_at: string | null;
}

export interface OrganizationInfo {
  org_id: string;
  org_name: string;
  allowed_domain: string;
  invite_code: string;
  owner_user_id: string;
  status: "ACTIVE" | "SUSPENDED";
  created_at: string;
}

export interface MasterOrgSummary extends OrganizationInfo {
  member_count: number;
  admin_count: number;
  owner_username: string;
}

export interface InviteLookupResponse {
  org_name: string;
  allowed_domain: string;
}

export interface MemberAccount {
  user_id: string;
  org_id: string;
  username: string;
  email: string;
  display_name: string;
  department: string;
  role: UserRole;
  admin_tier: AdminTier;
  status: "ACTIVE" | "PENDING_APPROVAL" | "REJECTED" | "SUSPENDED";
  mfa_enabled: boolean;
  bio: string;
  avatar: string;
  custom_role_id: string | null;
  custom_role_name: string | null;
  custom_role_color: RoleColor | string;
  effective_role: string;
  last_login_at: string | null;
  created_at: string;
}

export interface OrgRoleItem {
  role_id: string;
  org_id: string;
  name: string;
  description: string;
  color: RoleColor | string;
  created_at: string;
  created_by: string;
  member_count?: number;
}

export interface NotificationItem {
  notification_id: string;
  user_id: string;
  org_id: string;
  kind: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
  link: string;
}

export interface NotificationAwaySummary {
  variant: "away" | "live";
  headline: string;
  detail: string;
  count: number;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unread_count: number;
  away_summary: NotificationAwaySummary | null;
}

export interface SupportTicketItem {
  ticket_id: string;
  org_id: string;
  org_name: string;
  created_by_user_id: string;
  created_by_username: string;
  category: TicketCategory;
  subject: string;
  description: string;
  requested_value: string;
  status: TicketStatus;
  resolution_note: string;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  applied_rename?: boolean;
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
  requester_username?: string;
  requester_display_name?: string;
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
  requester_username?: string;
  requester_display_name?: string;
  requester_role_label?: string;
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

export interface ScopeTesterServicePreset {
  label: string;
  placeholder: string;
  allow_presets: Array<{ label: string; query: string }>;
  deny_presets: Array<{ label: string; query: string }>;
}

export type ScopeTesterPresets = Record<ServiceType, ScopeTesterServicePreset>;

export interface ScopeTestResult {
  session_id: string;
  simulated: boolean;
  service: ServiceType;
  resource: string;
  summary: string;
  content?: string;
  rows?: Array<Record<string, unknown>>;
  events?: Array<{
    timestamp: string;
    stream: string;
    level: string;
    message: string;
  }>;
  parameters?: Array<{
    name: string;
    type: string;
    value: string;
    version: number;
  }>;
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
