import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Crown,
  KeyRound,
  Lock,
  Moon,
  Shield,
  Sun,
  Terminal,
  User,
  UserPlus,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { BrandLogo, NoticeBanner } from "../components/TacticalUI";
import type { InviteLookupResponse, UserRole } from "../types/api";

type AuthMode = "login" | "signup" | "register-org";

function routeForRole(role: UserRole): string {
  if (role === "platform_admin") return "/master";
  if (role === "admin") return "/admin";
  return "/client";
}

export function LoginPage() {
  const { user, login, verifyMfa, applySessionToken } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");

  // Org registration & member signup fields
  const [orgName, setOrgName] = useState("");
  const [allowedDomain, setAllowedDomain] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteMatch, setInviteMatch] = useState<InviteLookupResponse | null>(
    null
  );
  const [inviteLookupError, setInviteLookupError] = useState(false);
  const [email, setEmail] = useState("");
  const [emailManuallyEdited, setEmailManuallyEdited] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [department, setDepartment] = useState("Cloud Operations");

  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "error" | "success" | "info";
  } | null>(null);

  useEffect(() => {
    if (mode !== "signup") return;
    const trimmed = inviteCode.trim();
    if (trimmed.length < 4) {
      setInviteMatch(null);
      setInviteLookupError(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.lookupInvite(trimmed);
        setInviteMatch(res);
        setInviteLookupError(false);
      } catch {
        setInviteMatch(null);
        setInviteLookupError(true);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [inviteCode, mode]);

  useEffect(() => {
    if (mode !== "signup" || !inviteMatch?.allowed_domain) return;
    const domain = inviteMatch.allowed_domain;
    if (!emailManuallyEdited && username.trim()) {
      const cleanLocal = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (cleanLocal) {
        setEmail(`${cleanLocal}@${domain}`);
      }
    }
  }, [username, inviteMatch, mode, emailManuallyEdited]);

  if (user) {
    return <Navigate to={routeForRole(user.role)} replace />;
  }

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await login(username, password);
      if (res.mfaRequired) {
        setMfaChallenge(res.challengeToken);
        setNotice({
          message: "MFA CHALLENGE ISSUED // ENTER 6-DIGIT TOTP CODE",
          tone: "info",
        });
      } else {
        navigate(routeForRole(res.user.role), {
          replace: true,
        });
      }
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Authentication failed",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mfaChallenge) return;
    setNotice(null);
    setSubmitting(true);
    try {
      const profile = await verifyMfa(mfaChallenge, otpCode);
      navigate(routeForRole(profile.role), {
        replace: true,
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Invalid TOTP code",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMemberSignup = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await api.memberSignup({
        invite_code: inviteCode,
        username,
        email,
        display_name: displayName,
        department,
        password,
      });
      setNotice({
        message: res.message,
        tone: "success",
      });
      setMode("login");
      setPassword("");
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Signup failed",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterOrg = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await api.registerOrg({
        org_name: orgName,
        allowed_domain: allowedDomain,
        admin_username: username,
        admin_email: email,
        admin_display_name: displayName,
        admin_department: department,
        password,
      });
      applySessionToken(res.access_token, res.user);
      navigate("/admin/team", { replace: true });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Organization registration failed",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const quickFill = (u: string, p: string) => {
    setMode("login");
    setMfaChallenge(null);
    setUsername(u);
    setPassword(p);
    setNotice(null);
  };

  return (
    <div className="endfield-grid-bg flex min-h-screen flex-col justify-between p-5 lg:p-10">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandLogo size="lg" />
          <div>
            <span className="font-mono-tech text-sm font-bold tracking-widest">
              AIC-GATE // V4
            </span>
            <p className="font-mono-tech text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
              MULTI-TENANT JIT CLOUD ACCESS GATEWAY
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-xs hover:border-[var(--border-strong)]"
        >
          {theme === "dark" ? (
            <>
              <Sun className="h-3.5 w-3.5" /> INDUSTRIAL LIGHT
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5" /> TACTICAL DARK
            </>
          )}
        </button>
      </div>

      <main className="mx-auto my-8 grid w-full max-w-5xl gap-8 lg:grid-cols-12 lg:items-center">
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28 }}
          className="space-y-6 lg:col-span-5"
        >
          <div className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-1 text-[11px] font-semibold tracking-wider text-[var(--accent-cyan)] uppercase">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-green)] animate-scan-pulse" />
            ZERO STANDING PRIVILEGES
          </div>

          <h1 className="text-4xl font-bold tracking-tight">
            Org-Managed JIT Access.
            <br />
            <span className="text-[var(--accent-cyan)]">Zero Idle Keys.</span>
          </h1>

          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            Employees join only via an approved organization invite code and
            Admin verification. Requests are scoped across S3, DynamoDB,
            CloudWatch Logs, and SSM with optional TOTP MFA.
          </p>

          <div className="grid gap-3">
            <div className="endfield-panel p-4">
              <div className="font-mono-tech mb-1 text-[10px] font-bold tracking-widest text-[var(--accent-cyan)]">
                CHANNEL 01 // OPERATOR PORTAL
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Pick approved services from the catalog without exposing raw
                ARNs or IAM internals.
              </p>
            </div>
            <div className="endfield-panel p-4">
              <div className="font-mono-tech mb-1 text-[10px] font-bold tracking-widest text-[var(--accent-amber)]">
                CHANNEL 02 // COMMANDER CONSOLE
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Approve org members, inspect compiled STS policies, view the
                entitlement graph, and export compliance logs.
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.05 }}
          className="endfield-panel relative p-6 sm:p-8 lg:col-span-7"
        >
          <span className="pointer-events-none absolute top-0 left-0 h-3 w-3 border-t-2 border-l-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute top-0 right-0 h-3 w-3 border-t-2 border-r-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute right-0 bottom-0 h-3 w-3 border-r-2 border-b-2 border-[var(--border-strong)]" />

          {/* Mode Tabs */}
          <div className="mb-5 grid grid-cols-3 gap-1.5 border-b border-[var(--border-hair)] pb-4">
            {[
              { id: "login", label: "SIGN IN", icon: <User className="h-3.5 w-3.5" /> },
              {
                id: "signup",
                label: "JOIN ORG",
                icon: <UserPlus className="h-3.5 w-3.5" />,
              },
              {
                id: "register-org",
                label: "NEW ORG",
                icon: <Building2 className="h-3.5 w-3.5" />,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMode(tab.id as AuthMode);
                  setMfaChallenge(null);
                  setNotice(null);
                }}
                className={`font-mono-tech flex items-center justify-center gap-1.5 border py-2 text-[11px] font-bold uppercase transition ${
                  mode === tab.id
                    ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                    : "border-[var(--border-hair)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {notice && (
            <div className="mb-4">
              <NoticeBanner
                message={notice.message}
                tone={notice.tone}
                onDismiss={() => setNotice(null)}
              />
            </div>
          )}

          {mode === "login" && mfaChallenge && (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-[var(--accent-cyan)]">
                <KeyRound className="h-4 w-4" />
                <span className="font-mono-tech font-bold">
                  TWO-FACTOR VERIFICATION REQUIRED
                </span>
              </div>
              <div>
                <label
                  htmlFor="otp"
                  className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
                >
                  6-Digit Authenticator Code
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="000000"
                  required
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMfaChallenge(null)}
                  className="font-mono-tech border border-[var(--border-hair)] px-4 py-2.5 text-xs uppercase"
                >
                  BACK
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="endfield-chamfer font-mono-tech flex flex-1 items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
                >
                  {submitting ? "VERIFYING..." : "VERIFY & ENTER"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}

          {mode === "login" && !mfaChallenge && (
            <>
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="username"
                    className="font-mono-tech mb-1.5 block text-[11px] font-semibold uppercase"
                  >
                    Username
                  </label>
                  <div className="relative">
                    <User className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="operator or commander"
                      required
                      className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-[var(--accent-cyan)]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="font-mono-tech mb-1.5 block text-[11px] font-semibold uppercase"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-[var(--accent-cyan)]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-3 text-xs font-bold tracking-wider text-[var(--accent-volt-ink)] uppercase hover:bg-[var(--accent-volt-hover)] disabled:opacity-50"
                >
                  {submitting ? "AUTHENTICATING..." : "ESTABLISH SESSION"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-6 border-t border-[var(--border-hair)] pt-4">
                <div className="font-mono-tech mb-2.5 flex items-center justify-between text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
                  <span>LAB DEMO CREDENTIALS (ORG INVITE: LAB-AICGATE-2026)</span>
                  <span>JWT // TOTP</span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => quickFill("operator", "operator-demo-pass")}
                    className="flex items-center gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-left hover:border-[var(--accent-cyan)]"
                  >
                    <Terminal className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
                    <div>
                      <div className="font-mono-tech text-xs font-bold">
                        operator
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Client Requester
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => quickFill("commander", "commander-demo-pass")}
                    className="flex items-center gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-left hover:border-[var(--accent-amber)]"
                  >
                    <Shield className="h-4 w-4 shrink-0 text-[var(--accent-amber)]" />
                    <div>
                      <div className="font-mono-tech text-xs font-bold">
                        commander
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Org Owner
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => quickFill("master", "master-demo-pass")}
                    className="flex items-center gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-left hover:border-[var(--accent-green)]"
                  >
                    <Crown className="h-4 w-4 shrink-0 text-[var(--accent-green)]" />
                    <div>
                      <div className="font-mono-tech text-xs font-bold">
                        master
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Platform Master
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === "signup" && (
            <form onSubmit={handleMemberSignup} className="space-y-3">
              {inviteMatch && (
                <div className="flex items-center justify-between gap-2 border border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] px-3 py-2 text-xs">
                  <span className="font-mono-tech flex items-center gap-1.5 font-bold text-[var(--accent-green)]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    JOINING: {inviteMatch.org_name}
                  </span>
                  {inviteMatch.allowed_domain && (
                    <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                      DOMAIN: @{inviteMatch.allowed_domain}
                    </span>
                  )}
                </div>
              )}
              {inviteLookupError && inviteCode.trim().length >= 4 && (
                <p className="font-mono-tech text-[10px] text-[var(--accent-red)]">
                  INVITE CODE NOT RECOGNIZED
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Org Invite Code
                  </label>
                  <input
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="LAB-AICGATE-2026"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Username
                  </label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="j.doe"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Corporate Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmailManuallyEdited(true);
                      setEmail(e.target.value);
                    }}
                    onBlur={() => {
                      if (
                        inviteMatch?.allowed_domain &&
                        email.trim() &&
                        !email.includes("@")
                      ) {
                        setEmail(
                          `${email.trim().toLowerCase()}@${inviteMatch.allowed_domain}`
                        );
                      }
                    }}
                    placeholder={
                      inviteMatch?.allowed_domain
                        ? `user@${inviteMatch.allowed_domain}`
                        : "user@aicgate.local"
                    }
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Display Name
                  </label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane Doe"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Department
                  </label>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Password (min 6 chars)
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
              >
                {submitting ? "SUBMITTING..." : "REQUEST ORG ACCESS"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {mode === "register-org" && (
            <form onSubmit={handleRegisterOrg} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Organization Name
                  </label>
                  <input
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Acme Security Ops"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Allowed Email Domain (Optional)
                  </label>
                  <input
                    value={allowedDomain}
                    onChange={(e) => setAllowedDomain(e.target.value)}
                    placeholder="acme.io"
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Admin Username
                  </label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin.alice"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Admin Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alice@acme.io"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Display Name
                  </label>
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alice Admin"
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Admin Password (min 6 chars)
                  </label>
                  <input
                    type="password"
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
              >
                {submitting ? "PROVISIONING ORG..." : "CREATE ORGANIZATION & SIGN IN"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}
        </motion.div>
      </main>

      <footer className="font-mono-tech mx-auto w-full max-w-5xl text-center text-[11px] text-[var(--text-muted)]">
        AIC-GATE // MULTI-TENANT STS + DYNAMODB + S3 + CW + SSM ORCHESTRATOR
      </footer>
    </div>
  );
}
