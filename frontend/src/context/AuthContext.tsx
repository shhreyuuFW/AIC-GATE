import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, getStoredToken, setStoredToken } from "../lib/api";
import type { LoginResult, UserProfile } from "../types/api";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyMfa: (challengeToken: string, otpCode: string) => Promise<UserProfile>;
  applySessionToken: (token: string, profile: UserProfile) => void;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .me()
      .then((profile) => setUser(profile))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (username: string, password: string): Promise<LoginResult> => {
      const res = await api.login(username, password);
      if (res.mfa_required && res.mfa_challenge_token) {
        return {
          mfaRequired: true,
          challengeToken: res.mfa_challenge_token,
        };
      }
      if (!res.access_token || !res.user) {
        throw new Error("Incomplete authentication response");
      }
      setStoredToken(res.access_token);
      setUser(res.user);
      return { mfaRequired: false, user: res.user };
    },
    []
  );

  const verifyMfa = useCallback(
    async (challengeToken: string, otpCode: string): Promise<UserProfile> => {
      const res = await api.verifyMfaLogin(challengeToken, otpCode);
      if (!res.access_token || !res.user) {
        throw new Error("MFA verification failed");
      }
      setStoredToken(res.access_token);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const applySessionToken = useCallback(
    (token: string, profile: UserProfile) => {
      setStoredToken(token);
      setUser(profile);
    },
    []
  );

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    try {
      const profile = await api.me();
      setUser(profile);
    } catch {
      // Preserve session unless explicitly logged out
    }
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        verifyMfa,
        applySessionToken,
        refreshUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
