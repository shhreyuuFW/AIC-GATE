import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Terminal } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard } from "../../components/TacticalUI";

const CLIENT_STEPS = [
  {
    code: "STEP 01",
    title: "Org Onboarding & Optional 2FA",
    summary:
      "Join your organization with an invite code and wait for Commander approval. Optionally enroll an authenticator app via 2FA SECURITY.",
    details: [
      "New member signups enter PENDING_APPROVAL until an Organization Admin approves the account.",
      "TOTP 2FA (Google Authenticator / Authy) is optional and can be toggled anytime from the sidebar.",
    ],
    link: { to: "/client", label: "OPEN RESOURCE CATALOG" },
  },
  {
    code: "STEP 02",
    title: "Pick From Approved Resource Catalog",
    summary:
      "Select from S3, DynamoDB, CloudWatch Logs, or SSM Parameter Store without needing to know raw ARNs or bucket names.",
    details: [
      "Related service chips let you pivot smoothly across correlated resources (e.g., S3 Logs → CloudWatch API Logs).",
      "Requests start in PENDING status until reviewed and provisioned by your Organization Commander.",
    ],
    link: { to: "/client", label: "CREATE REQUEST" },
  },
  {
    code: "STEP 03",
    title: "Mint & Export Temporary STS Keys",
    summary:
      "Once provisioned, open My Sessions & Keys to mint short-lived AWS STS credentials tailored to your approved service.",
    details: [
      "Copy ready-to-run PowerShell or Bash exports plus service-specific AWS CLI test commands.",
      "Secrets remain strictly in memory and are never persisted to browser storage.",
    ],
    link: { to: "/client/sessions", label: "OPEN MY SESSIONS" },
  },
  {
    code: "STEP 04",
    title: "Verify Least-Privilege Boundaries",
    summary:
      "Confirm positive reads (logs/sample.log) and denied reads (restricted/secret.txt) via the S3 Scope Tester or AWS CLI.",
    details: [
      "Click REVOKE when finished early to stop future credential minting and proxied reads.",
      "Already-minted STS credentials expire automatically at STS_EXPIRATION.",
    ],
    link: { to: "/client/s3-tester", label: "LAUNCH S3 TESTER" },
  },
];

export function ClientGuidePage() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR FIELD MANUAL // CLIENT WORKFLOW"
      title="Client Operator Guide"
      description="Step-by-step protocol for org onboarding, 2FA, and requesting Just-in-Time multi-service AWS access."
    >
      <div className="grid gap-4 md:grid-cols-4">
        {CLIENT_STEPS.map((step, index) => (
          <button
            key={step.code}
            type="button"
            onClick={() => setActiveIndex(index)}
            className={`endfield-panel p-4 text-left transition ${
              activeIndex === index
                ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]"
                : "hover:border-[var(--border-strong)]"
            }`}
          >
            <div className="font-mono-tech text-[10px] font-bold tracking-widest text-[var(--accent-cyan)]">
              {step.code}
            </div>
            <div className="mt-1 text-sm font-bold">{step.title}</div>
          </button>
        ))}
      </div>

      <ReticleCard
        tag={`OPERATOR PROTOCOL // ${CLIENT_STEPS[activeIndex].code}`}
        title={CLIENT_STEPS[activeIndex].title}
        subtitle={CLIENT_STEPS[activeIndex].summary}
        action={<Terminal className="h-5 w-5 text-[var(--accent-cyan)]" />}
      >
        <ul className="space-y-3">
          {CLIENT_STEPS[activeIndex].details.map((line) => (
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
            ROLE: REQUESTER // STANDING ACCESS: NONE
          </span>
          <Link
            to={CLIENT_STEPS[activeIndex].link.to}
            className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-2 bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
          >
            {CLIENT_STEPS[activeIndex].link.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </ReticleCard>
    </PortalLayout>
  );
}
