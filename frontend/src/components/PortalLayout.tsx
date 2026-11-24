import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Activity,
  BookOpen,
  FileCode2,
  GitFork,
  KeyRound,
  LogOut,
  Moon,
  PlusSquare,
  RefreshCw,
  ShieldCheck,
  Sun,
  Terminal,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

interface NavItem {
  to: string;
  label: string;
  code: string;
  icon: ReactNode;
  end?: boolean;
}

const CLIENT_NAV: NavItem[] = [
  {
    to: "/client",
    label: "Access Requests",
    code: "01",
    icon: <PlusSquare className="h-4 w-4" />,
    end: true,
  },
  {
    to: "/client/sessions",
    label: "My Sessions & Keys",
    code: "02",
    icon: <KeyRound className="h-4 w-4" />,
  },
  {
    to: "/client/s3-tester",
    label: "S3 Scope Tester",
    code: "03",
    icon: <Terminal className="h-4 w-4" />,
  },
  {
    to: "/client/guide",
    label: "Operator Guide",
    code: "04",
    icon: <BookOpen className="h-4 w-4" />,
  },
];

const ADMIN_NAV: NavItem[] = [
  {
    to: "/admin",
    label: "Approval Queue",
    code: "01",
    icon: <ShieldCheck className="h-4 w-4" />,
    end: true,
  },
  {
    to: "/admin/sessions",
    label: "Session Telemetry",
    code: "02",
    icon: <Activity className="h-4 w-4" />,
  },
  {
    to: "/admin/graph",
    label: "Entitlement Graph",
    code: "03",
    icon: <GitFork className="h-4 w-4" />,
  },
  {
    to: "/admin/audit-log",
    label: "Security Audit",
    code: "04",
    icon: <FileCode2 className="h-4 w-4" />,
  },
  {
    to: "/admin/guide",
    label: "Commander Guide",
    code: "05",
    icon: <BookOpen className="h-4 w-4" />,
  },
];

export function PortalLayout({
  portal,
  title,
  eyebrow,
  description,
  onRefresh,
  children,
}: {
  portal: "client" | "admin";
  title: string;
  eyebrow: string;
  description: string;
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .health()
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false));
  }, []);

  const navItems = portal === "admin" ? ADMIN_NAV : CLIENT_NAV;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="endfield-grid-bg min-h-screen lg:flex">
      {/* Sidebar */}
      <aside className="flex w-full flex-col border-b border-[var(--border-hair)] bg-[var(--bg-panel)] lg:sticky lg:top-0 lg:h-screen lg:w-68 lg:shrink-0 lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between border-b border-[var(--border-hair)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="endfield-chamfer-sm flex h-9 w-9 items-center justify-center bg-[var(--accent-volt)] font-mono-tech text-base font-bold text-[var(--accent-volt-ink)]">
              A
            </div>
            <div>
              <div className="font-mono-tech text-sm font-bold tracking-wider">
                AIC-GATE
              </div>
              <div className="font-mono-tech text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
                {portal === "admin" ? "COMMANDER // ADMIN" : "OPERATOR // CLIENT"}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="border border-[var(--border-hair)] p-2 text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Portal Switcher for Admins */}
        {user?.role === "admin" && (
          <div className="border-b border-[var(--border-hair)] px-4 py-3">
            <div className="font-mono-tech mb-1.5 text-[10px] tracking-widest text-[var(--text-muted)] uppercase">
              PORTAL CHANNEL
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => navigate("/admin")}
                className={`font-mono-tech border px-2 py-1.5 text-[11px] font-semibold uppercase ${
                  portal === "admin"
                    ? "border-[var(--text-main)] bg-[var(--text-main)] text-[var(--bg-panel)]"
                    : "border-[var(--border-hair)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                ADMIN
              </button>
              <button
                type="button"
                onClick={() => navigate("/client")}
                className={`font-mono-tech border px-2 py-1.5 text-[11px] font-semibold uppercase ${
                  portal === "client"
                    ? "border-[var(--text-main)] bg-[var(--text-main)] text-[var(--bg-panel)]"
                    : "border-[var(--border-hair)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                CLIENT
              </button>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex shrink-0 items-center justify-between border px-3 py-2.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                    : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-hair)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"
                }`
              }
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                <span>{item.label}</span>
              </span>
              <span className="font-mono-tech hidden text-[10px] opacity-60 lg:inline">
                {item.code}
              </span>
            </NavLink>
          ))}
        </nav>

        {/* Identity + API Status */}
        <div className="hidden border-t border-[var(--border-hair)] p-4 lg:block">
          <div className="mb-3 flex items-center justify-between text-[11px]">
            <span className="font-mono-tech text-[var(--text-muted)]">
              STS // AP-SOUTH-1
            </span>
            <span className="font-mono-tech inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  apiOnline === true
                    ? "bg-[var(--accent-green)] animate-scan-pulse"
                    : apiOnline === false
                      ? "bg-[var(--accent-red)]"
                      : "bg-[var(--text-muted)]"
                }`}
              />
              {apiOnline === true
                ? "ONLINE"
                : apiOnline === false
                  ? "OFFLINE"
                  : "CHECKING"}
            </span>
          </div>

          {user && (
            <div className="flex items-center justify-between border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold">
                  {user.display_name}
                </div>
                <div className="font-mono-tech truncate text-[10px] text-[var(--text-muted)]">
                  {user.user_id} · {user.role.toUpperCase()}
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Sign out"
                className="ml-2 p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-red)]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1">
        <header className="border-b border-[var(--border-hair)] bg-[var(--bg-panel)]/85 px-5 py-5 backdrop-blur-sm lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-mono-tech text-[10px] font-semibold tracking-[0.2em] text-[var(--accent-cyan)] uppercase">
                {eyebrow}
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {title}
              </h1>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {description}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3.5 py-2 text-xs font-semibold hover:border-[var(--border-strong)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  SYNC
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent-red)] lg:hidden"
              >
                <LogOut className="h-3.5 w-3.5" />
                EXIT
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-6 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
