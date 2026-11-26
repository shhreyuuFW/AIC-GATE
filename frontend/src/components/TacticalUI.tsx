import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Check,
  Copy,
  Cpu,
  Crown,
  Eye,
  EyeOff,
  Hexagon,
  KeyRound,
  Lock,
  Radar,
  Shield,
  ShieldAlert,
  Terminal,
  Zap,
} from "lucide-react";
import type { ServiceType, TemporaryCredentials } from "../types/api";

export function BrandLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const cls =
    size === "sm"
      ? "h-9 w-9 p-1.5"
      : size === "lg"
        ? "h-11 w-11 p-1.5"
        : "h-10 w-10 p-1.5";
  return (
    <div
      className={`${cls} endfield-chamfer-sm flex shrink-0 items-center justify-center border border-[var(--border-strong)] bg-[#090c11]`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        className="h-full w-full"
        aria-label="AIC-GATE emblem"
      >
        <path
          d="M 67 15.8 L 50 6 L 12 28 L 12 72 L 50 94 L 88 72 L 88 28 L 76 21"
          stroke="#EDF2F7"
          strokeWidth="6.5"
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
        <line
          x1="69.5"
          y1="22.8"
          x2="74.5"
          y2="14.2"
          stroke="#EDF2F7"
          strokeWidth="2.6"
        />
        <path
          d="M 45.5 29 L 54.5 29 L 73 67 L 63.2 69.8 L 57.6 58.2 L 50.8 58.2 L 50.8 49.5 L 53.6 49.5 L 50 40.5 L 38.2 62.5 L 30.8 57.5 Z"
          fill="#EDF2F7"
        />
        <path
          d="M 49.2 49.5 L 49.2 58.2 L 41.2 58.2 L 45.5 49.5 Z"
          fill="#EDF2F7"
        />
        <polygon
          points="29,61 36.8,65.5 32.3,73.3 24.5,68.8"
          fill="#E5FF00"
        />
      </svg>
    </div>
  );
}

export function ServiceBadge({ service }: { service?: ServiceType | string }) {
  const norm = (service || "s3").toLowerCase();
  const labels: Record<string, { label: string; color: string }> = {
    s3: {
      label: "S3 STORAGE",
      color: "border-[var(--accent-cyan)]/50 text-[var(--accent-cyan)]",
    },
    dynamodb: {
      label: "DYNAMODB",
      color: "border-[var(--accent-amber)]/50 text-[var(--accent-amber)]",
    },
    cloudwatch_logs: {
      label: "CW LOGS",
      color: "border-[var(--accent-green)]/50 text-[var(--accent-green)]",
    },
    ssm: {
      label: "SSM PARAM",
      color: "border-[var(--border-strong)] text-[var(--text-main)]",
    },
  };
  const meta = labels[norm] ?? {
    label: norm.toUpperCase(),
    color: "border-[var(--border-hair)] text-[var(--text-muted)]",
  };
  return (
    <span
      className={`font-mono-tech inline-flex items-center border bg-[var(--bg-panel)] px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const styles: Record<string, string> = {
    ACTIVE:
      "bg-[var(--accent-green-soft)] text-[var(--accent-green)] border-[var(--accent-green)]/40",
    APPROVED:
      "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40",
    SESSION_CREATED:
      "bg-[var(--accent-green-soft)] text-[var(--accent-green)] border-[var(--accent-green)]/40",
    PENDING:
      "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber)]/40",
    PENDING_APPROVAL:
      "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber)]/40",
    CREATING_SESSION:
      "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40",
    EXPIRED:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
    REJECTED:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
    REVOKED:
      "bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border-strong)]/40",
    SUCCESS:
      "bg-[var(--accent-green-soft)] text-[var(--accent-green)] border-[var(--accent-green)]/40",
    DENIED:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
    FAILED:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
    SUSPENDED:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
    OPEN:
      "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber)]/40",
    IN_REVIEW:
      "bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)] border-[var(--accent-cyan)]/40",
    RESOLVED:
      "bg-[var(--accent-green-soft)] text-[var(--accent-green)] border-[var(--accent-green)]/40",
    CLOSED:
      "bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border-strong)]/40",
    LOW:
      "bg-[var(--accent-green-soft)] text-[var(--accent-green)] border-[var(--accent-green)]/40",
    MEDIUM:
      "bg-[var(--accent-amber-soft)] text-[var(--accent-amber)] border-[var(--accent-amber)]/40",
    HIGH:
      "bg-[var(--accent-red-soft)] text-[var(--accent-red)] border-[var(--accent-red)]/40",
  };

  return (
    <span
      className={`font-mono-tech inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${
        styles[normalized] ??
        "bg-[var(--bg-muted)] text-[var(--text-muted)] border-[var(--border-hair)]"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          normalized === "ACTIVE" || normalized === "SUCCESS"
            ? "bg-[var(--accent-green)] animate-scan-pulse"
            : normalized === "PENDING" || normalized === "PENDING_APPROVAL"
              ? "bg-[var(--accent-amber)]"
              : normalized === "APPROVED" || normalized === "SESSION_CREATED"
                ? "bg-[var(--accent-cyan)]"
                : "bg-current"
        }`}
      />
      {normalized.replace("_", " ")}
    </span>
  );
}

export function ReticleCard({
  children,
  className = "",
  tag,
  title,
  subtitle,
  action,
}: {
  children: ReactNode;
  className?: string;
  tag?: string;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`endfield-panel relative p-5 ${className}`}
    >
      <span className="pointer-events-none absolute top-0 left-0 h-2.5 w-2.5 border-t-2 border-l-2 border-[var(--border-strong)]" />
      <span className="pointer-events-none absolute top-0 right-0 h-2.5 w-2.5 border-t-2 border-r-2 border-[var(--border-strong)]" />
      <span className="pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b-2 border-l-2 border-[var(--border-strong)]" />
      <span className="pointer-events-none absolute right-0 bottom-0 h-2.5 w-2.5 border-r-2 border-b-2 border-[var(--border-strong)]" />

      {(tag || title || action) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-hair)] pb-3">
          <div>
            {tag && (
              <p className="font-mono-tech mb-1 text-[10px] font-semibold tracking-[0.16em] text-[var(--accent-cyan)] uppercase">
                {tag}
              </p>
            )}
            {title && (
              <h2 className="text-base font-bold tracking-tight text-[var(--text-main)]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </motion.section>
  );
}

export function CountdownBar({
  createdAt,
  expiresAt,
  status,
}: {
  createdAt: string;
  expiresAt: string;
  status: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "ACTIVE") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const start = new Date(createdAt).getTime();
  const end = new Date(expiresAt).getTime();
  const total = Math.max(1, end - start);
  const remaining = Math.max(0, end - now);
  const pct =
    status === "ACTIVE"
      ? Math.min(100, Math.max(0, (remaining / total) * 100))
      : 0;

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="space-y-1">
      <div className="font-mono-tech flex items-center justify-between text-[11px]">
        <span className="text-[var(--text-muted)]">TTL REMAINING</span>
        <span
          className={
            status !== "ACTIVE" || remaining === 0
              ? "text-[var(--accent-red)]"
              : "font-semibold text-[var(--text-main)]"
          }
        >
          {status !== "ACTIVE"
            ? status
            : remaining === 0
              ? "00:00 (EXPIRED)"
              : `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-[var(--bg-muted)]">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor:
              pct > 30
                ? "var(--accent-green)"
                : pct > 0
                  ? "var(--accent-amber)"
                  : "var(--accent-red)",
          }}
        />
      </div>
    </div>
  );
}

export function NoticeBanner({
  message,
  tone = "info",
  onDismiss,
}: {
  message: string;
  tone?: "info" | "success" | "error" | "warning";
  onDismiss?: () => void;
}) {
  const palette: Record<string, string> = {
    info: "border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan-soft)] text-[var(--text-main)]",
    success:
      "border-[var(--accent-green)]/40 bg-[var(--accent-green-soft)] text-[var(--text-main)]",
    error:
      "border-[var(--accent-red)]/50 bg-[var(--accent-red-soft)] text-[var(--accent-red)]",
    warning:
      "border-[var(--accent-amber)]/50 bg-[var(--accent-amber-soft)] text-[var(--text-main)]",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center justify-between gap-3 border px-4 py-2.5 text-xs ${palette[tone]}`}
      role="status"
    >
      <span className="font-mono-tech">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="font-mono-tech text-[11px] uppercase opacity-75 hover:opacity-100"
        >
          [DISMISS]
        </button>
      )}
    </motion.div>
  );
}

function getServiceCliHint(service?: ServiceType, target?: string): string {
  switch (service) {
    case "dynamodb":
      return `aws dynamodb describe-table --table-name ${target || "AICGateSession"}`;
    case "cloudwatch_logs":
      return `aws logs describe-log-streams --log-group-name ${target || "/aic-gate/app"}`;
    case "ssm":
      return `aws ssm get-parameters-by-path --path ${target || "/aic-gate/config"}`;
    case "s3":
    default:
      return "aws s3 cp s3://cloudsec.proj.aicgate/logs/sample.log -";
  }
}

export function CredentialVault({
  credentials,
  service,
  target,
}: {
  credentials: TemporaryCredentials;
  service?: ServiceType;
  target?: string;
}) {
  const [reveal, setReveal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(label);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const psSnippet = [
    `$env:AWS_ACCESS_KEY_ID="${credentials.access_key_id}"`,
    `$env:AWS_SECRET_ACCESS_KEY="${credentials.secret_access_key}"`,
    `$env:AWS_SESSION_TOKEN="${credentials.session_token}"`,
    `$env:AWS_DEFAULT_REGION="ap-south-1"`,
  ].join("\n");

  const bashSnippet = [
    `export AWS_ACCESS_KEY_ID="${credentials.access_key_id}"`,
    `export AWS_SECRET_ACCESS_KEY="${credentials.secret_access_key}"`,
    `export AWS_SESSION_TOKEN="${credentials.session_token}"`,
    `export AWS_DEFAULT_REGION="ap-south-1"`,
  ].join("\n");

  return (
    <div className="mt-4 border border-[var(--accent-amber)]/50 bg-[var(--bg-elevated)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--accent-amber)]" />
          <span className="font-mono-tech text-xs font-bold tracking-wider uppercase">
            STS TEMPORARY CREDENTIALS (IN-MEMORY ONLY)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReveal((prev) => !prev)}
            className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2.5 py-1 text-[11px] hover:border-[var(--border-strong)]"
          >
            {reveal ? (
              <>
                <EyeOff className="h-3.5 w-3.5" /> HIDE SECRETS
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" /> REVEAL
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => copyText("ps", psSnippet)}
            className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2.5 py-1 text-[11px] hover:border-[var(--border-strong)]"
          >
            {copiedKey === "ps" ? (
              <Check className="h-3.5 w-3.5 text-[var(--accent-green)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            COPY POWERSHELL
          </button>
          <button
            type="button"
            onClick={() => copyText("bash", bashSnippet)}
            className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2.5 py-1 text-[11px] hover:border-[var(--border-strong)]"
          >
            {copiedKey === "bash" ? (
              <Check className="h-3.5 w-3.5 text-[var(--accent-green)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            COPY BASH
          </button>
        </div>
      </div>

      <div className="font-mono-tech grid gap-2 text-xs">
        <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-hair)] pb-1.5">
          <span className="text-[var(--text-muted)]">ACCESS_KEY_ID</span>
          <span className="break-all text-[var(--text-main)]">
            {credentials.access_key_id}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-hair)] pb-1.5">
          <span className="text-[var(--text-muted)]">SECRET_ACCESS_KEY</span>
          <span className="break-all text-[var(--text-main)]">
            {reveal
              ? credentials.secret_access_key
              : "••••••••••••••••••••••••••••••••"}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-hair)] pb-1.5">
          <span className="text-[var(--text-muted)]">SESSION_TOKEN</span>
          <span className="max-w-xl break-all text-[var(--text-main)]">
            {reveal
              ? credentials.session_token
              : "••••••••••••••••••••••••••••••••••••••••"}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--border-hair)] pb-1.5">
          <span className="text-[var(--text-muted)]">STS_EXPIRATION</span>
          <span className="text-[var(--accent-amber)]">
            {new Date(credentials.expires_at).toLocaleString()}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-[var(--text-muted)]">CLI TEST</span>
          <code className="text-[11px] text-[var(--accent-cyan)]">
            {getServiceCliHint(service, target)}
          </code>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-amber)]" />
        <span>
          Credentials are never saved to browser storage. Revoking the session in
          AIC-GATE blocks new minting/proxied reads, while already-issued STS
          credentials expire automatically at STS_EXPIRATION.
        </span>
      </div>
    </div>
  );
}

const ROLE_COLOR_CLASSES: Record<string, string> = {
  cyan: "border-[var(--accent-cyan)]/50 bg-[var(--accent-cyan-soft)] text-[var(--accent-cyan)]",
  amber:
    "border-[var(--accent-amber)]/50 bg-[var(--accent-amber-soft)] text-[var(--accent-amber)]",
  green:
    "border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] text-[var(--accent-green)]",
  volt: "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]",
  red: "border-[var(--accent-red)]/50 bg-[var(--accent-red-soft)] text-[var(--accent-red)]",
  slate:
    "border-[var(--border-strong)] bg-[var(--bg-panel)] text-[var(--text-muted)]",
};

export function RoleBadge({
  label,
  color = "cyan",
}: {
  label: string;
  color?: string;
}) {
  const cls = ROLE_COLOR_CLASSES[color] ?? ROLE_COLOR_CLASSES.cyan;
  return (
    <span
      className={`font-mono-tech inline-flex items-center border px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase ${cls}`}
    >
      {label}
    </span>
  );
}

export const AVATAR_PRESETS = [
  { id: "shield", label: "Shield" },
  { id: "terminal", label: "Terminal" },
  { id: "hex", label: "Hex Node" },
  { id: "cyber", label: "Volt Core" },
  { id: "radar", label: "Radar" },
  { id: "crown", label: "Command" },
  { id: "cpu", label: "Processor" },
  { id: "lock", label: "Vault" },
] as const;

export function UserAvatar({
  avatar,
  displayName,
  size = "md",
}: {
  avatar?: string;
  displayName: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass =
    size === "sm"
      ? "h-7 w-7 text-[10px]"
      : size === "lg"
        ? "h-12 w-12 text-sm"
        : "h-9 w-9 text-xs";
  const iconClass =
    size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-4 w-4";

  if (avatar && avatar.startsWith("data:image/")) {
    return (
      <img
        src={avatar}
        alt={displayName}
        className={`${sizeClass} endfield-chamfer-sm shrink-0 border border-[var(--border-strong)] object-cover`}
      />
    );
  }

  const preset = avatar?.startsWith("preset:")
    ? avatar.slice("preset:".length)
    : "";

  const renderPresetIcon = () => {
    switch (preset) {
      case "shield":
        return <Shield className={iconClass} />;
      case "terminal":
        return <Terminal className={iconClass} />;
      case "hex":
        return <Hexagon className={iconClass} />;
      case "cyber":
        return <Zap className={iconClass} />;
      case "radar":
        return <Radar className={iconClass} />;
      case "crown":
        return <Crown className={iconClass} />;
      case "cpu":
        return <Cpu className={iconClass} />;
      case "lock":
        return <Lock className={iconClass} />;
      default: {
        const initials = displayName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() || "")
          .join("");
        return <span>{initials || "AG"}</span>;
      }
    }
  };

  return (
    <div
      className={`${sizeClass} endfield-chamfer-sm font-mono-tech flex shrink-0 items-center justify-center border border-[var(--border-strong)] bg-[var(--bg-panel)] font-bold text-[var(--accent-cyan)]`}
    >
      {renderPresetIcon()}
    </div>
  );
}
