import type {
  AccessRequestItem,
  AccessSessionItem,
  AuditEventItem,
  CatalogResourceItem,
  CreatedSessionWithCredentials,
  InviteLookupResponse,
  LoginResponse,
  MasterOrgSummary,
  MemberAccount,
  MfaSetupResponse,
  NotificationsResponse,
  ObjectReadResponse,
  OrganizationInfo,
  OrgRoleItem,
  PolicyDocument,
  ScopeTesterPresets,
  ScopeTestResult,
  SecurityProofResponse,
  ServiceType,
  SupportTicketItem,
  TemporaryCredentials,
  TicketCategory,
  TicketStatus,
  UserProfile,
} from "../types/api";

const TOKEN_STORAGE_KEY = "aic_gate_jwt";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getStoredToken(): string | null {
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  withAuth = true
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (withAuth) {
    const token = getStoredToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : typeof payload === "string" && payload
          ? payload
          : response.statusText;
    throw new ApiError(response.status, detail);
  }

  return payload as T;
}

export const api = {
  health(): Promise<{ status: string }> {
    return request<{ status: string }>("/health", {}, false);
  },

  lookupInvite(inviteCode: string): Promise<InviteLookupResponse> {
    return request<InviteLookupResponse>(
      `/auth/invite/${encodeURIComponent(inviteCode.trim())}`,
      {},
      false
    );
  },

  login(username: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
      false
    );
  },

  verifyMfaLogin(
    mfa_challenge_token: string,
    otp_code: string
  ): Promise<LoginResponse> {
    return request<LoginResponse>(
      "/auth/mfa/verify",
      {
        method: "POST",
        body: JSON.stringify({ mfa_challenge_token, otp_code }),
      },
      false
    );
  },

  registerOrg(payload: {
    org_name: string;
    allowed_domain: string;
    admin_username: string;
    admin_email: string;
    admin_display_name: string;
    admin_department: string;
    password: string;
  }): Promise<{
    access_token: string;
    user: UserProfile;
    organization: OrganizationInfo;
  }> {
    return request(
      "/auth/register-org",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      false
    );
  },

  memberSignup(payload: {
    invite_code: string;
    username: string;
    email: string;
    display_name: string;
    department: string;
    password: string;
  }): Promise<{ message: string; user: MemberAccount }> {
    return request(
      "/auth/signup",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      false
    );
  },

  me(): Promise<UserProfile> {
    return request<UserProfile>("/auth/me");
  },

  updateProfile(payload: {
    display_name?: string;
    bio?: string;
    avatar?: string;
  }): Promise<{ access_token: string; user: UserProfile }> {
    return request("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  getNotifications(): Promise<NotificationsResponse> {
    return request<NotificationsResponse>("/notifications");
  },

  markNotificationsRead(payload: {
    notification_id?: string;
    mark_all?: boolean;
  }): Promise<{ marked: number }> {
    return request<{ marked: number }>("/notifications/read", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  setupMfa(): Promise<MfaSetupResponse> {
    return request<MfaSetupResponse>("/auth/mfa/setup", { method: "POST" });
  },

  enableMfa(otp_code: string): Promise<{
    mfa_enabled: boolean;
    access_token: string;
    user: UserProfile;
  }> {
    return request("/auth/mfa/enable", {
      method: "POST",
      body: JSON.stringify({ otp_code }),
    });
  },

  disableMfa(password: string): Promise<{
    mfa_enabled: boolean;
    access_token: string;
    user: UserProfile;
  }> {
    return request("/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  getCatalog(): Promise<{ resources: CatalogResourceItem[] }> {
    return request<{ resources: CatalogResourceItem[] }>("/catalog");
  },

  adminPreviewPolicy(payload: {
    bucket: string;
    prefix: string;
    actions: string[];
    service: string;
  }): Promise<{ policy: PolicyDocument }> {
    return request<{ policy: PolicyDocument }>("/admin/policy/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  submitRequest(payload: {
    resource_id?: string;
    service?: string;
    bucket?: string;
    prefix?: string;
    actions: string[];
    duration_minutes: number;
    reason: string;
  }): Promise<AccessRequestItem> {
    return request<AccessRequestItem>("/requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  listMyRequests(status?: string): Promise<{ requests: AccessRequestItem[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<{ requests: AccessRequestItem[] }>(`/requests${query}`);
  },

  adminGetOrg(): Promise<OrganizationInfo> {
    return request<OrganizationInfo>("/admin/org");
  },

  adminUpdateOrg(payload: {
    org_name?: string;
    allowed_domain?: string;
  }): Promise<OrganizationInfo> {
    return request<OrganizationInfo>("/admin/org", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  adminRotateInvite(): Promise<OrganizationInfo> {
    return request<OrganizationInfo>("/admin/org/rotate-invite", {
      method: "POST",
    });
  },

  adminListUsers(): Promise<{ users: MemberAccount[] }> {
    return request<{ users: MemberAccount[] }>("/admin/users");
  },

  adminReviewUser(
    username: string,
    decision: "ACTIVE" | "REJECTED"
  ): Promise<MemberAccount> {
    return request<MemberAccount>(
      `/admin/users/${encodeURIComponent(username)}/review`,
      {
        method: "POST",
        body: JSON.stringify({ decision }),
      }
    );
  },

  adminManageUser(
    username: string,
    payload: {
      department?: string;
      status?: "ACTIVE" | "SUSPENDED";
      custom_role_id?: string;
      clear_custom_role?: boolean;
      admin_action?: "PROMOTE_DELEGATED" | "DEMOTE_REQUESTER";
    }
  ): Promise<MemberAccount> {
    return request<MemberAccount>(
      `/admin/users/${encodeURIComponent(username)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  adminListRoles(): Promise<{ roles: OrgRoleItem[] }> {
    return request<{ roles: OrgRoleItem[] }>("/admin/org-roles");
  },

  adminCreateRole(payload: {
    name: string;
    description: string;
    color: string;
  }): Promise<OrgRoleItem> {
    return request<OrgRoleItem>("/admin/org-roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  adminUpdateRole(
    roleId: string,
    payload: { name?: string; description?: string; color?: string }
  ): Promise<OrgRoleItem> {
    return request<OrgRoleItem>(
      `/admin/org-roles/${encodeURIComponent(roleId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  adminDeleteRole(roleId: string): Promise<{ deleted: string }> {
    return request<{ deleted: string }>(
      `/admin/org-roles/${encodeURIComponent(roleId)}`,
      { method: "DELETE" }
    );
  },

  adminAssignRole(
    roleId: string,
    usernames: string[]
  ): Promise<{ updated: MemberAccount[] }> {
    return request<{ updated: MemberAccount[] }>(
      `/admin/org-roles/${encodeURIComponent(roleId)}/assign`,
      {
        method: "POST",
        body: JSON.stringify({ usernames }),
      }
    );
  },

  adminUnassignRoles(
    usernames: string[]
  ): Promise<{ updated: MemberAccount[] }> {
    return request<{ updated: MemberAccount[] }>("/admin/org-roles/unassign", {
      method: "POST",
      body: JSON.stringify({ usernames }),
    });
  },

  adminListTickets(): Promise<{ tickets: SupportTicketItem[] }> {
    return request<{ tickets: SupportTicketItem[] }>("/admin/tickets");
  },

  adminCreateTicket(payload: {
    category: TicketCategory;
    subject: string;
    description: string;
    requested_value?: string;
  }): Promise<SupportTicketItem> {
    return request<SupportTicketItem>("/admin/tickets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  adminListRequests(status?: string): Promise<{ requests: AccessRequestItem[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<{ requests: AccessRequestItem[] }>(`/admin/requests${query}`);
  },

  adminReviewRequest(
    requestId: string,
    decision: "APPROVED" | "REJECTED"
  ): Promise<AccessRequestItem> {
    return request<AccessRequestItem>(
      `/admin/requests/${encodeURIComponent(requestId)}/review`,
      {
        method: "POST",
        body: JSON.stringify({ decision }),
      }
    );
  },

  adminCreateSession(requestId: string): Promise<CreatedSessionWithCredentials> {
    return request<CreatedSessionWithCredentials>(
      `/admin/requests/${encodeURIComponent(requestId)}/create-session`,
      { method: "POST" }
    );
  },

  listSessions(): Promise<{ sessions: AccessSessionItem[] }> {
    return request<{ sessions: AccessSessionItem[] }>("/sessions");
  },

  revokeSession(
    sessionId: string
  ): Promise<{ session_id: string; status: string }> {
    return request<{ session_id: string; status: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: "POST" }
    );
  },

  issueCredentials(sessionId: string): Promise<TemporaryCredentials> {
    return request<TemporaryCredentials>(
      `/sessions/${encodeURIComponent(sessionId)}/credentials`,
      { method: "POST" }
    );
  },

  readSessionObject(
    sessionId: string,
    key: string
  ): Promise<ObjectReadResponse> {
    return request<ObjectReadResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/objects?key=${encodeURIComponent(key)}`
    );
  },

  getScopeTesterPresets(): Promise<{ presets: ScopeTesterPresets }> {
    return request<{ presets: ScopeTesterPresets }>("/scope-tester/presets");
  },

  runSessionScopeTest(
    sessionId: string,
    payload: { service: ServiceType; query: string; use_lab_sample?: boolean }
  ): Promise<ScopeTestResult> {
    return request<ScopeTestResult>(
      `/sessions/${encodeURIComponent(sessionId)}/test`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
  },

  adminAudit(limit = 100): Promise<{ events: AuditEventItem[] }> {
    return request<{ events: AuditEventItem[] }>(
      `/admin/audit?limit=${encodeURIComponent(String(limit))}`
    );
  },

  async adminDownloadAudit(format: "csv" | "json"): Promise<void> {
    const token = getStoredToken();
    const res = await fetch(`/admin/audit/export?format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new ApiError(res.status, "Failed to export audit log");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aic-gate-audit.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  adminRunSecurityProof(): Promise<SecurityProofResponse> {
    return request<SecurityProofResponse>("/admin/security-proof", {
      method: "POST",
    });
  },

  masterListOrgs(): Promise<{ organizations: MasterOrgSummary[] }> {
    return request<{ organizations: MasterOrgSummary[] }>("/master-api/orgs");
  },

  masterUpdateOrg(
    orgId: string,
    payload: {
      org_name?: string;
      allowed_domain?: string;
      status?: "ACTIVE" | "SUSPENDED";
    }
  ): Promise<OrganizationInfo> {
    return request<OrganizationInfo>(
      `/master-api/orgs/${encodeURIComponent(orgId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  masterListOrgUsers(orgId: string): Promise<{ users: MemberAccount[] }> {
    return request<{ users: MemberAccount[] }>(
      `/master-api/orgs/${encodeURIComponent(orgId)}/users`
    );
  },

  masterSetOrgAdmin(
    orgId: string,
    username: string,
    tier: "delegated" | "owner" | "none"
  ): Promise<MemberAccount> {
    return request<MemberAccount>(
      `/master-api/orgs/${encodeURIComponent(orgId)}/admins`,
      {
        method: "POST",
        body: JSON.stringify({ username, tier }),
      }
    );
  },

  masterResetUserMfa(username: string): Promise<MemberAccount> {
    return request<MemberAccount>(
      `/master-api/users/${encodeURIComponent(username)}/reset-mfa`,
      { method: "POST" }
    );
  },

  masterListTickets(status?: string): Promise<{ tickets: SupportTicketItem[] }> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<{ tickets: SupportTicketItem[] }>(
      `/master-api/tickets${query}`
    );
  },

  masterUpdateTicket(
    ticketId: string,
    payload: {
      status: TicketStatus;
      resolution_note?: string;
      apply_org_rename?: boolean;
    }
  ): Promise<SupportTicketItem> {
    return request<SupportTicketItem>(
      `/master-api/tickets/${encodeURIComponent(ticketId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    );
  },

  masterAudit(limit = 150): Promise<{ events: AuditEventItem[] }> {
    return request<{ events: AuditEventItem[] }>(
      `/master-api/audit?limit=${encodeURIComponent(String(limit))}`
    );
  },
};
