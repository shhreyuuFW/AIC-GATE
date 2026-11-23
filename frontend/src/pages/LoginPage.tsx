import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Lock, Moon, Shield, Sun, Terminal, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { NoticeBanner } from "../components/TacticalUI";

export function LoginPage() {
  const { user, login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return (
      <Navigate to={user.role === "admin" ? "/admin" : "/client"} replace />
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const profile = await login(username, password);
      navigate(profile.role === "admin" ? "/admin" : "/client", {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const quickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="endfield-grid-bg flex min-h-screen flex-col justify-between p-5 lg:p-10">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="endfield-chamfer-sm flex h-10 w-10 items-center justify-center bg-[var(--accent-volt)] font-mono-tech text-lg font-bold text-[var(--accent-volt-ink)]">
            A
          </div>
          <div>
            <span className="font-mono-tech text-sm font-bold tracking-widest">
              AIC-GATE // V2
            </span>
            <p className="font-mono-tech text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
              JUST-IN-TIME AWS ACCESS GATEWAY
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
        {/* Left Briefing Column */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.28 }}
          className="space-y-6 lg:col-span-6"
        >
          <div className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-1 text-[11px] font-semibold tracking-wider text-[var(--accent-cyan)] uppercase">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-green)] animate-scan-pulse" />
            SYS.AUTH // ZERO-STANDING-PRIVILEGE
          </div>

          <h1 className="text-4xl font-bold tracking-tight lg:text-5xl">
            Scoped AWS Access.
            <br />
            <span className="text-[var(--accent-cyan)]">On Demand Only.</span>
          </h1>

          <p className="max-w-md text-sm leading-relaxed text-[var(--text-muted)]">
            AIC-GATE separates requesters from approvers. Operators request
            prefix-scoped S3 permissions; Security Commanders review, approve,
            and monitor time-bounded STS role assumptions.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="endfield-panel p-4">
              <div className="font-mono-tech mb-1 text-[10px] font-bold tracking-widest text-[var(--accent-cyan)]">
                CHANNEL 01 // CLIENT
              </div>
              <div className="text-sm font-bold">Operator Portal</div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Submit scoped requests, inspect live STS policies, mint
                temporary keys, and test S3 boundaries.
              </p>
            </div>
            <div className="endfield-panel p-4">
              <div className="font-mono-tech mb-1 text-[10px] font-bold tracking-widest text-[var(--accent-amber)]">
                CHANNEL 02 // ADMIN
              </div>
              <div className="text-sm font-bold">Commander Console</div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Approve or reject requests, visualize live entitlements, audit
                events, and revoke active sessions.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Right Login Terminal */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.05 }}
          className="endfield-panel relative p-6 sm:p-8 lg:col-span-6"
        >
          <span className="pointer-events-none absolute top-0 left-0 h-3 w-3 border-t-2 border-l-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute top-0 right-0 h-3 w-3 border-t-2 border-r-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-[var(--border-strong)]" />
          <span className="pointer-events-none absolute right-0 bottom-0 h-3 w-3 border-r-2 border-b-2 border-[var(--border-strong)]" />

          <div className="mb-6 border-b border-[var(--border-hair)] pb-4">
            <p className="font-mono-tech text-[10px] font-semibold tracking-[0.2em] text-[var(--accent-cyan)] uppercase">
              IDENTITY VERIFICATION
            </p>
            <h2 className="mt-1 text-xl font-bold">Sign in to AIC-GATE</h2>
          </div>

          {error && (
            <div className="mb-4">
              <NoticeBanner
                message={error}
                tone="error"
                onDismiss={() => setError(null)}
              />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="font-mono-tech mb-1.5 block text-[11px] font-semibold tracking-wider uppercase"
              >
                Operator / Commander ID
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
                  autoComplete="username"
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="font-mono-tech mb-1.5 block text-[11px] font-semibold tracking-wider uppercase"
              >
                Access Passphrase
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
                  autoComplete="current-password"
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-2.5 pr-3 pl-9 text-sm outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-3 text-xs font-bold tracking-wider text-[var(--accent-volt-ink)] uppercase transition hover:bg-[var(--accent-volt-hover)] disabled:opacity-50"
            >
              {submitting ? "AUTHENTICATING..." : "ESTABLISH SESSION"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {/* Local Dev Quick-Fill */}
          <div className="mt-6 border-t border-[var(--border-hair)] pt-5">
            <div className="font-mono-tech mb-2.5 flex items-center justify-between text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
              <span>LOCAL LAB DEMO CREDENTIALS</span>
              <span>JWT // HS256</span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => quickFill("operator", "operator-demo-pass")}
                className="flex items-center gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left transition hover:border-[var(--accent-cyan)]"
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
                className="flex items-center gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left transition hover:border-[var(--accent-amber)]"
              >
                <Shield className="h-4 w-4 shrink-0 text-[var(--accent-amber)]" />
                <div>
                  <div className="font-mono-tech text-xs font-bold">
                    commander
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    Admin Approver
                  </div>
                </div>
              </button>
            </div>
          </div>
        </motion.div>
      </main>

      <footer className="font-mono-tech mx-auto w-full max-w-5xl text-center text-[11px] text-[var(--text-muted)]">
        AIC-GATE // STS + DYNAMODB + S3 LEAST-PRIVILEGE ORCHESTRATOR
      </footer>
    </div>
  );
}
