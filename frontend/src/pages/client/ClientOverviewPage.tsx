import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileCode2, Send, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AccessRequestItem, PolicyDocument } from "../../types/api";

export function ClientOverviewPage() {
  const [bucket, setBucket] = useState("cloudsec.proj.aicgate");
  const [prefix, setPrefix] = useState("logs/");
  const [actions, setActions] = useState<string[]>([
    "s3:GetObject",
    "s3:ListBucket",
  ]);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [reason, setReason] = useState("");

  const [policy, setPolicy] = useState<PolicyDocument | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    try {
      const res = await api.listMyRequests();
      setRequests(res.requests);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to load requests",
        tone: "error",
      });
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!actions.length) {
        setPolicy(null);
        setPolicyError("Select at least one S3 action.");
        return;
      }
      try {
        const res = await api.previewPolicy({ bucket, prefix, actions });
        setPolicy(res.policy);
        setPolicyError(null);
      } catch (err) {
        setPolicy(null);
        setPolicyError(
          err instanceof Error ? err.message : "Invalid policy scope"
        );
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [bucket, prefix, actions]);

  const toggleAction = (action: string) => {
    setActions((prev) =>
      prev.includes(action)
        ? prev.filter((item) => item !== action)
        : [...prev, action]
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await api.submitRequest({
        bucket: bucket.trim(),
        prefix: prefix.trim(),
        actions,
        duration_minutes: durationMinutes,
        reason: reason.trim(),
      });
      setReason("");
      setNotice({
        message: `REQUEST ${created.request_id.slice(0, 8)} SUBMITTED // STATUS: PENDING COMMANDER REVIEW`,
        tone: "success",
      });
      await loadRequests();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Request rejected",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR PORTAL // ACCESS REQUESTS"
      title="Request Scoped S3 Access"
      description="Submit a time-bounded, prefix-restricted request. Credentials are minted only after Commander approval."
      onRefresh={loadRequests}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Request Form */}
        <ReticleCard
          className="lg:col-span-6"
          tag="STEP 01 // SCOPE DEFINITION"
          title="New Access Request"
          subtitle="Requests enter PENDING state and require Admin approval."
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="bucket"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Allowlisted S3 Bucket
              </label>
              <input
                id="bucket"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <div>
              <label
                htmlFor="prefix"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Target Prefix (No wildcards or traversal)
              </label>
              <input
                id="prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="logs/"
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <div>
              <span className="font-mono-tech mb-1.5 block text-[11px] font-semibold uppercase">
                Permitted Actions
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                {["s3:GetObject", "s3:ListBucket"].map((action) => (
                  <label
                    key={action}
                    className="flex cursor-pointer items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={actions.includes(action)}
                      onChange={() => toggleAction(action)}
                      className="accent-[var(--accent-cyan)]"
                    />
                    <span className="font-mono-tech">{action}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="duration"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Session Duration (STS Bounds: 15–60 Min)
              </label>
              <select
                id="duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              >
                <option value={15}>15 MINUTES (900s)</option>
                <option value={30}>30 MINUTES (1800s)</option>
                <option value={45}>45 MINUTES (2700s)</option>
                <option value={60}>60 MINUTES (3600s)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="reason"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Operational Justification
              </label>
              <textarea
                id="reason"
                rows={3}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Inspect application error logs under logs/ for incident #402"
                required
                className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || Boolean(policyError)}
              className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold tracking-wider text-[var(--accent-volt-ink)] uppercase transition hover:bg-[var(--accent-volt-hover)] disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? "TRANSMITTING..." : "SUBMIT FOR APPROVAL"}
            </button>
          </form>
        </ReticleCard>

        {/* Live Policy Preview */}
        <ReticleCard
          className="lg:col-span-6"
          tag="LIVE TELEMETRY // STS POLICY COMPILER"
          title="Session Policy Preview"
          subtitle="Exact inline IAM policy passed to AWS STS AssumeRole."
          action={<FileCode2 className="h-4 w-4 text-[var(--accent-cyan)]" />}
        >
          {policyError ? (
            <div className="border border-[var(--accent-red)]/50 bg-[var(--accent-red-soft)] p-4">
              <div className="font-mono-tech text-xs font-bold text-[var(--accent-red)]">
                VALIDATION BLOCKED
              </div>
              <p className="font-mono-tech mt-1 text-xs text-[var(--accent-red)]">
                {policyError}
              </p>
            </div>
          ) : policy ? (
            <pre className="font-mono-tech max-h-88 overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-4 text-[11px] leading-relaxed text-[#d7e6f5]">
              {JSON.stringify(policy, null, 2)}
            </pre>
          ) : (
            <p className="font-mono-tech text-xs text-[var(--text-muted)]">
              Compiling policy...
            </p>
          )}

          <div className="mt-4 flex items-start gap-2.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-green)]" />
            <span>
              AWS evaluates the intersection of{" "}
              <code className="font-mono-tech text-[var(--text-main)]">
                AICGateJITRole
              </code>{" "}
              and this session policy on every S3 API call.
            </span>
          </div>
        </ReticleCard>
      </div>

      {/* My Requests Table */}
      <ReticleCard
        tag="OPERATOR LOG // SUBMITTED REQUESTS"
        title="My Access Requests"
        subtitle="Track approval decisions and linked session IDs."
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Request ID</th>
                <th className="px-3 py-2.5">Target</th>
                <th className="px-3 py-2.5">Actions</th>
                <th className="px-3 py-2.5">TTL</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {loadingRequests ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    LOADING REQUEST STREAM...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    NO ACCESS REQUESTS SUBMITTED YET.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr
                    key={req.request_id}
                    className="border-b border-[var(--border-hair)]/60 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="font-mono-tech px-3 py-3 text-[var(--accent-cyan)]">
                      {req.request_id.slice(0, 8)}…
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {req.bucket}/{req.prefix}
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {req.actions.join(", ")}
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {req.duration_minutes}m
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={req.status} />
                    </td>
                    <td className="font-mono-tech px-3 py-3 text-[var(--text-muted)]">
                      {new Date(req.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ReticleCard>
    </PortalLayout>
  );
}
