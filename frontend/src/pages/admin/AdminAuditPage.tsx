import { useCallback, useEffect, useState } from "react";
import { Download, Play, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AuditEventItem, SecurityProofResponse } from "../../types/api";

export function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [proof, setProof] = useState<SecurityProofResponse | null>(null);
  const [runningProof, setRunningProof] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.adminAudit(100);
      setEvents(res.events);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const handleRunProof = async () => {
    setRunningProof(true);
    setNotice(null);
    try {
      const res = await api.adminRunSecurityProof();
      setProof(res);
      setNotice({
        message: `SECURITY BOUNDARY PROOF COMPLETE: ${res.passed}/${res.total} PASSED`,
        tone: res.passed === res.total ? "success" : "error",
      });
      await loadAudit();
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to run security proof",
        tone: "error",
      });
    } finally {
      setRunningProof(false);
    }
  };

  const handleExport = async (format: "csv" | "json") => {
    try {
      await api.adminDownloadAudit(format);
      setNotice({
        message: `EXPORTED AUDIT LOG AS ${format.toUpperCase()}`,
        tone: "success",
      });
      await loadAudit();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Export failed",
        tone: "error",
      });
    }
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // AUDIT & VERIFICATION"
      title="Security Audit & Boundary Proof"
      description="Export compliance-ready audit evidence (CSV/JSON) and execute live security boundary verification checks."
      onRefresh={loadAudit}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* One-Click Security Boundary Proof Panel */}
      <ReticleCard
        tag="LIVE VERIFICATION // PRESENTATION PROOF"
        title="Security Boundary Proof Suite"
        subtitle="Executes live server-side checks for policy compilation, traversal blocking, wildcard blocking, RBAC, and session expiry."
        action={
          <button
            type="button"
            disabled={runningProof}
            onClick={handleRunProof}
            className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-2 bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            {runningProof ? "RUNNING PROOF..." : "RUN SECURITY PROOF"}
          </button>
        }
      >
        {!proof ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span>
              Click <strong>RUN SECURITY PROOF</strong> to verify all 5 security
              boundaries live during a demo.
            </span>
          </div>
        ) : (
          <div className="grid gap-2.5 md:grid-cols-2">
            {proof.checks.map((chk) => (
              <div
                key={chk.id}
                className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-tech text-xs font-bold">
                    {chk.id} · {chk.control}
                  </span>
                  <StatusBadge status={chk.passed ? "SUCCESS" : "FAILED"} />
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {chk.detail}
                </p>
              </div>
            ))}
          </div>
        )}
      </ReticleCard>

      {/* Audit Stream + Compliance Export */}
      <ReticleCard
        tag="STRUCTURED TELEMETRY // SECRETS REDACTED"
        title="Security Audit Log"
        subtitle="Secret access keys, session tokens, and passwords are automatically stripped from audit metadata."
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleExport("csv")}
              className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
            >
              <Download className="h-3.5 w-3.5" /> EXPORT CSV
            </button>
            <button
              type="button"
              onClick={() => handleExport("json")}
              className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
            >
              <Download className="h-3.5 w-3.5" /> EXPORT JSON
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Timestamp</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-3 py-2.5">Outcome</th>
                <th className="px-3 py-2.5">Actor</th>
                <th className="px-3 py-2.5">Resource</th>
                <th className="px-3 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    LOADING AUDIT BUFFER...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    NO AUDIT EVENTS RECORDED IN CURRENT PROCESS.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr
                    key={ev.event_id}
                    className="border-b border-[var(--border-hair)]/60 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="font-mono-tech px-3 py-2.5 text-[var(--text-muted)]">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="font-mono-tech px-3 py-2.5 font-semibold">
                      {ev.action}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={ev.outcome} />
                    </td>
                    <td className="font-mono-tech px-3 py-2.5">
                      {ev.actor_id} ({ev.actor_role})
                    </td>
                    <td className="font-mono-tech px-3 py-2.5 text-[var(--accent-cyan)]">
                      {ev.resource_id ? `${ev.resource_id.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="font-mono-tech px-3 py-2.5 text-[11px] text-[var(--text-muted)]">
                      {Object.keys(ev.details).length > 0
                        ? JSON.stringify(ev.details)
                        : "—"}
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
