export type UserRole = "requester" | "admin";

export interface UserProfile {
  user_id: string;
  username: string;
  display_name: string;
  role: UserRole;
  department: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
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
  bucket: string;
  prefix: string;
  actions: string[];
  duration_minutes: number;
  reason: string;
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
