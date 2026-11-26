import type {
  AccessRequestItem,
  AccessSessionItem,
  AuditEventItem,
  CatalogResourceItem,
  CreatedSessionWithCredentials,
  LoginResponse,
  MemberAccount,
  MfaSetupResponse,
  ObjectReadResponse,
  OrganizationInfo,
  PolicyDocument,
  SecurityProofResponse,
  TemporaryCredentials,
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
};
