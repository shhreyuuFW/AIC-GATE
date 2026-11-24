import type {
  AccessRequestItem,
  AccessSessionItem,
  AuditEventItem,
  CreatedSessionWithCredentials,
  LoginResponse,
  ObjectReadResponse,
  PolicyDocument,
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

  me(): Promise<UserProfile> {
    return request<UserProfile>("/auth/me");
  },

  previewPolicy(payload: {
    bucket: string;
    prefix: string;
    actions: string[];
  }): Promise<{ policy: PolicyDocument }> {
    return request<{ policy: PolicyDocument }>("/policy/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  submitRequest(payload: {
    bucket: string;
    prefix: string;
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
};
