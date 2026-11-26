import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard } from "../../components/TacticalUI";

const ADMIN_STEPS = [
  {
    code: "PROTOCOL 01",
    title: "Manage Org Members & Invite Codes",
    summary:
      "Share your organization invite code with approved employees, rotate it anytime, and review pending member signups.",
    details: [
      "New signups enter PENDING_APPROVAL and cannot log in until approved under Org & Members.",
      "Tenant isolation guarantees Commanders only see users, requests, and sessions belonging to their own organization.",
    ],
    link: { to: "/admin/team", label: "OPEN ORG & MEMBERS" },
  },
  {
    code: "PROTOCOL 02",
    title: "Inspect Policies, Risk & Provision STS",
    summary:
      "Review automated risk badges (LOW/MEDIUM/HIGH) and inspect the compiled STS policy JSON before approving or provisioning.",
    details: [
      "Compiled IAM policy JSON is restricted exclusively to Commanders (/admin/policy/preview) to avoid exposing raw AWS topology to Clients.",
      "Provisioning uses conditional DynamoDB claiming (APPROVED → CREATING_SESSION → SESSION_CREATED) with rollback on failure.",
    ],
    link: { to: "/admin", label: "OPEN APPROVAL QUEUE" },
  },
  {
    code: "PROTOCOL 03",
    title: "Interactive Entitlement Graph",
    summary:
      "Filter by service or active status, inspect STS policies inline, and revoke compromised sessions directly from the topology graph.",
    details: [
      "Keyboard shortcuts: press [R] to sync, [A] to toggle Active-Only grants, and [Esc] to clear node selection.",
      "Resource nodes are color-coded across S3, DynamoDB, CloudWatch Logs, and SSM.",
    ],
    link: { to: "/admin/graph", label: "VIEW ENTITLEMENT GRAPH" },
  },
  {
    code: "PROTOCOL 04",
    title: "Compliance Export & Security Proof",
    summary:
      "Run the 5-check Security Boundary Proof live during reviews and export secret-redacted audit logs as CSV or JSON.",
    details: [
      "Audit logs automatically strip secret keys, session tokens, and passwords.",
      "Revoking a session blocks future STS minting and proxied reads; already-issued STS credentials expire at AWS TTL.",
    ],
    link: { to: "/admin/audit-log", label: "OPEN AUDIT & PROOF" },
  },
];

export function AdminGuidePage() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER OPERATIONS MANUAL // ADMIN WORKFLOW"
      title="Admin Commander Guide"
      description="Governance, tenant onboarding, policy inspection, and compliance procedures for AIC-GATE administrators."
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
