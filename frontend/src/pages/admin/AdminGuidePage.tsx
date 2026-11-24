import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard } from "../../components/TacticalUI";

const ADMIN_STEPS = [
  {
    code: "PROTOCOL 01",
    title: "Triage & Verify Incoming Requests",
    summary:
      "Inspect operator justification, bucket, prefix, and requested actions in the Approval Queue before granting access.",
    details: [
      "Requests start in PENDING state. Approving or rejecting uses a conditional DynamoDB UpdateItem (#status = PENDING) to prevent race conditions across admins.",
      "Only users with server-side JWT role === 'admin' can access /admin/* routes.",
    ],
    link: { to: "/admin", label: "OPEN APPROVAL QUEUE" },
  },
  {
    code: "PROTOCOL 02",
    title: "Atomic STS Session Provisioning",
    summary:
      "Provisioning claims an APPROVED request atomically (APPROVED → CREATING_SESSION → SESSION_CREATED) so duplicate sessions cannot be minted.",
    details: [
      "If STS AssumeRole or DynamoDB session persistence fails, the claim automatically rolls back to APPROVED so the request never gets stuck.",
      "STS assumes AICGateJITRole with an inline session policy restricting both GetObject and ListBucket to the approved prefix.",
    ],
    link: { to: "/admin", label: "PROVISION SESSIONS" },
  },
  {
    code: "PROTOCOL 03",
    title: "Monitor Entitlements & Telemetry",
    summary:
      "Use Session Telemetry and the Live Entitlement Graph to observe who currently holds active access to which S3 prefixes.",
    details: [
      "Expired sessions are reconciled lazily on read and never transition back to ACTIVE.",
      "The Entitlement Graph is strictly informational — AWS IAM & STS enforce the real authorization boundary on S3.",
    ],
    link: { to: "/admin/graph", label: "VIEW ENTITLEMENT GRAPH" },
  },
  {
    code: "PROTOCOL 04",
    title: "Revocation & Audit Investigation",
    summary:
      "Review secret-redacted events in the Security Audit Log and revoke compromised sessions immediately.",
    details: [
      "Revoking a session marks DynamoDB REVOKED, blocking new STS key minting and proxied S3 reads immediately.",
      "Already-issued STS credentials remain valid until their AWS Expiration; keep session durations tight (15–60 min) to limit exposure.",
    ],
    link: { to: "/admin/audit-log", label: "OPEN AUDIT LOG" },
  },
];

export function AdminGuidePage() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER OPERATIONS MANUAL // ADMIN WORKFLOW"
      title="Admin Commander Guide"
      description="Governance, atomic provisioning, and incident-response procedures for AIC-GATE administrators."
    >
      <div className="grid gap-4 md:grid-cols-4">
        {ADMIN_STEPS.map((step, index) => (
          <button
            key={step.code}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={`endfield-panel p-4 text-left transition ${
              activeIndex === index
                ? "border-[var(--accent-amber)] bg-[var(--accent-amber-soft)]"
                : "hover:border-[var(--border-strong)]"
            }`}
          >
            <div className="font-mono-tech text-[10px] font-bold tracking-widest text-[var(--accent-amber)]">
              {step.code}
            </div>
            <div className="mt-1 text-sm font-bold">{step.title}</div>
          </button>
        ))}
      </div>

      <ReticleCard
        tag={`COMMANDER PROTOCOL // ${ADMIN_STEPS[activeIndex].code}`}
        title={ADMIN_STEPS[activeIndex].title}
        subtitle={ADMIN_STEPS[activeIndex].summary}
        action={<ShieldCheck className="h-5 w-5 text-[var(--accent-amber)]" />}
      >
        <ul className="space-y-3">
          {ADMIN_STEPS[activeIndex].details.map((line) => (
            <li
              key={line}
              className="flex items-start gap-2.5 text-sm text-[var(--text-main)]"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-green)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center justify-between border-t border-[var(--border-hair)] pt-4">
          <span className="font-mono-tech text-xs text-[var(--text-muted)]">
            ROLE: ADMIN // ENFORCEMENT: SERVER-SIDE RBAC + AWS STS
          </span>
          <Link
            to={ADMIN_STEPS[activeIndex].link.to}
            className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-2 bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
          >
            {ADMIN_STEPS[activeIndex].link.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </ReticleCard>
    </PortalLayout>
  );
}
