import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, Terminal } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard } from "../../components/TacticalUI";

const CLIENT_STEPS = [
  {
    code: "STEP 01",
    title: "Define Minimal S3 Scope",
    summary:
      "Specify only the exact bucket, folder prefix (e.g. logs/), actions, and duration (15–60 min) needed for your task.",
    details: [
      "Wildcards (*, ?) and path traversal (../) are blocked automatically at both the API validator and STS policy compiler.",
      "Inspect the Live Policy Preview panel on the Access Requests page to confirm the exact IAM statements before submitting.",
    ],
    link: { to: "/client", label: "OPEN REQUEST BUILDER" },
  },
  {
    code: "STEP 02",
    title: "Await Commander Approval",
    summary:
      "Submitted requests enter PENDING state in DynamoDB. No AWS credentials exist until an Administrator approves and provisions the session.",
    details: [
      "Your requests table updates status from PENDING → APPROVED → SESSION_CREATED.",
      "Requesters cannot self-approve or access other operators' requests (enforced server-side via JWT identity checks).",
    ],
    link: { to: "/client", label: "CHECK MY REQUESTS" },
  },
  {
    code: "STEP 03",
    title: "Mint & Export Temporary STS Keys",
    summary:
      "Once your session is ACTIVE, open My Sessions & Keys to mint short-lived AWS credentials bound to your remaining TTL.",
    details: [
      "Use COPY POWERSHELL or COPY BASH inside the Credential Vault to export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN into your terminal.",
      "Test directly with AWS CLI: aws s3 cp s3://cloudsec.proj.aicgate/logs/sample.log -",
    ],
    link: { to: "/client/sessions", label: "OPEN MY SESSIONS" },
  },
  {
    code: "STEP 04",
    title: "Verify Least-Privilege Boundaries",
    summary:
      "Confirm both positive access (logs/sample.log) and negative denial (restricted/secret.txt) using the S3 Scope Tester or AWS CLI.",
    details: [
      "AWS evaluates the intersection of AICGateJITRole and your session policy on every S3 request.",
      "When finished early, click REVOKE to block future credential minting and proxied reads (already-minted STS keys expire at STS_EXPIRATION).",
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
      description="Step-by-step protocol for requesting, receiving, and verifying Just-in-Time AWS S3 access."
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
