import { useCallback, useEffect, useState } from "react";
import { Check, FileCode2, KeyRound, X } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  CredentialVault,
  NoticeBanner,
  ReticleCard,
  ServiceBadge,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type {
  AccessRequestItem,
  CreatedSessionWithCredentials,
  PolicyDocument,
} from "../../types/api";

const STATUS_FILTERS = [
  "ALL",
  "PENDING",
  "APPROVED",
  "SESSION_CREATED",
  "REJECTED",
] as const;

export function AdminQueuePage() {
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [requests, setRequests] = useState<AccessRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [provisioned, setProvisioned] =
    useState<CreatedSessionWithCredentials | null>(null);
  const [inspectedPolicy, setInspectedPolicy] = useState<{
    requestId: string;
    policy: PolicyDocument;
  } | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminListRequests(
        filter === "ALL" ? undefined : filter
      );
      setRequests(res.requests);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to load queue",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleInspectPolicy = async (req: AccessRequestItem) => {
    if (inspectedPolicy?.requestId === req.request_id) {
      setInspectedPolicy(null);
      return;
    }
    try {
      const res = await api.adminPreviewPolicy({
        bucket: req.bucket,
        prefix: req.prefix,
        actions: req.actions,
        service: req.service || "s3",
      });
      setInspectedPolicy({ requestId: req.request_id, policy: res.policy });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Unable to compile policy",
        tone: "error",
      });
    }
  };

  const handleReview = async (
    requestId: string,
    decision: "APPROVED" | "REJECTED"
  ) => {
    setBusyId(requestId);
    setNotice(null);
    try {
      await api.adminReviewRequest(requestId, decision);
      setNotice({
        message: `REQUEST ${requestId.slice(0, 8)} ${decision}`,
        tone: decision === "APPROVED" ? "success" : "info",
      });
      await loadQueue();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Review failed",
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleProvision = async (requestId: string) => {
    setBusyId(requestId);
    setNotice(null);
    try {
      const created = await api.adminCreateSession(requestId);
      setProvisioned(created);
      setNotice({
        message: `STS SESSION ${created.session_id.slice(0, 8)} PROVISIONED`,
        tone: "success",
      });
      await loadQueue();
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Session provisioning failed",
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // GOVERNANCE"
      title="Access Approval Queue"
      description="Inspect risk levels and compiled STS policies before approving and atomically provisioning AWS sessions."
      onRefresh={loadQueue}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {provisioned && (
        <ReticleCard
          tag="PROVISIONING COMPLETE // ATOMIC CLAIM VERIFIED"
          title={`Session ${provisioned.session_id.slice(0, 8)}… (${provisioned.service.toUpperCase()})`}
          action={
            <button
              type="button"
              onClick={() => setProvisioned(null)}
              className="font-mono-tech border border-[var(--border-hair)] px-2.5 py-1 text-[11px] hover:border-[var(--border-strong)]"
            >
              DISMISS
            </button>
          }
        >
          <CredentialVault
            credentials={provisioned.credentials}
            service={provisioned.service}
            target={provisioned.bucket}
          />
        </ReticleCard>
      )}

      <ReticleCard
        tag="ORG-SCOPED QUEUE // AUTOMATED RISK SCORING"
        title="Pending & Historical Requests"
        subtitle="Compiled IAM policies are visible exclusively to Commanders."
        action={
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`font-mono-tech border px-2.5 py-1 text-[10px] font-semibold uppercase ${
                  filter === item
                    ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                    : "border-[var(--border-hair)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        }
      >
        <div className="space-y-3">
          {loading ? (
            <p className="font-mono-tech py-6 text-center text-xs text-[var(--text-muted)]">
              QUERYING ACCESS REQUESTS...
            </p>
          ) : requests.length === 0 ? (
            <p className="font-mono-tech py-6 text-center text-xs text-[var(--text-muted)]">
              NO REQUESTS MATCHING FILTER [{filter}].
            </p>
          ) : (
            requests.map((req) => (
              <div
                key={req.request_id}
                className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-4"
              >
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={req.status} />
                      <ServiceBadge service={req.service} />
                      <StatusBadge status={req.risk_level || "LOW"} />
                      <span className="font-mono-tech text-xs font-bold">
                        {req.bucket}/{req.prefix}
                      </span>
                      <span className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                        REQ:{req.request_id.slice(0, 8)} · BY:{req.requester_id}{" "}
                        · {req.duration_minutes}m
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-main)]">
                      {req.reason}
                    </p>
                    <p className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                      ACTIONS: {req.actions.join(", ")} · CREATED:{" "}
                      {new Date(req.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleInspectPolicy(req)}
                      className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                    >
                      <FileCode2 className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                      {inspectedPolicy?.requestId === req.request_id
                        ? "HIDE POLICY"
                        : "INSPECT POLICY"}
                    </button>

                    {req.status === "PENDING" && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === req.request_id}
                          onClick={() =>
                            handleReview(req.request_id, "APPROVED")
                          }
                          className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-1.5 bg-[var(--accent-volt)] px-3.5 py-2 text-[11px] font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
                        >
                          <Check className="h-3.5 w-3.5" />
                          APPROVE
                        </button>
                        <button
                          type="button"
                          disabled={busyId === req.request_id}
                          onClick={() =>
                            handleReview(req.request_id, "REJECTED")
                          }
                          className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--accent-red)]/50 px-3.5 py-2 text-[11px] font-semibold text-[var(--accent-red)] uppercase hover:bg-[var(--accent-red-soft)] disabled:opacity-40"
                        >
                          <X className="h-3.5 w-3.5" />
                          REJECT
                        </button>
                      </>
                    )}
                    {req.status === "APPROVED" && (
                      <button
                        type="button"
                        disabled={busyId === req.request_id}
                        onClick={() => handleProvision(req.request_id)}
                        className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-1.5 bg-[var(--accent-cyan)] px-3.5 py-2 text-[11px] font-bold text-white uppercase disabled:opacity-40"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        PROVISION STS SESSION
                      </button>
                    )}
                  </div>
                </div>

                {inspectedPolicy?.requestId === req.request_id && (
                  <pre className="font-mono-tech mt-3 max-h-64 overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-3 text-[11px] text-[#d7e6f5]">
                    {JSON.stringify(inspectedPolicy.policy, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </ReticleCard>
    </PortalLayout>
  );
}
