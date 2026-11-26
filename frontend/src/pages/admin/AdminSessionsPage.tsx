import { useCallback, useEffect, useState } from "react";
import { Ban, ShieldAlert } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  CountdownBar,
  NoticeBanner,
  ReticleCard,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import { useAutoSync } from "../../hooks/useAutoSync";
import type { AccessSessionItem } from "../../types/api";

export function AdminSessionsPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadSessions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
    } catch (err) {
      if (!silent) {
        setNotice({
          message:
            err instanceof Error ? err.message : "Failed to load sessions",
          tone: "error",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions(false);
  }, [loadSessions]);

  useAutoSync(() => loadSessions(true), 8000);

  const handleRevoke = async (sessionId: string) => {
    if (
      !window.confirm(
        "Revoke this session? New credential minting and proxied reads will be blocked, while already-issued STS credentials remain active until their AWS TTL."
      )
    ) {
      return;
    }

    setBusyId(sessionId);
    setNotice(null);
    try {
      await api.revokeSession(sessionId);
      setNotice({
        message: `SESSION ${sessionId.slice(0, 8)} REVOKED IN DYNAMODB`,
        tone: "info",
      });
      await loadSessions();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Revocation failed",
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const counts = {
    total: sessions.length,
    active: sessions.filter((s) => s.status === "ACTIVE").length,
    expired: sessions.filter((s) => s.status === "EXPIRED").length,
    revoked: sessions.filter((s) => s.status === "REVOKED").length,
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // SESSION TELEMETRY"
      title="Global Sessions Monitor"
      description="Observe all STS sessions across operators, reconcile TTLs, and execute application-level revocations."
      onRefresh={loadSessions}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "TOTAL SESSIONS", value: counts.total, accent: "var(--text-main)" },
          { label: "ACTIVE GRANTS", value: counts.active, accent: "var(--accent-green)" },
          { label: "EXPIRED", value: counts.expired, accent: "var(--accent-red)" },
          { label: "REVOKED", value: counts.revoked, accent: "var(--text-muted)" },
        ].map((kpi) => (
          <div key={kpi.label} className="endfield-panel p-4">
            <div className="font-mono-tech text-[10px] tracking-widest text-[var(--text-muted)]">
              {kpi.label}
            </div>
            <div
              className="font-mono-tech mt-2 text-3xl font-bold"
              style={{ color: kpi.accent }}
            >
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2.5 border border-[var(--accent-amber)]/40 bg-[var(--accent-amber-soft)] px-4 py-3 text-xs">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-amber)]" />
        <span>
          <strong>Revocation Boundary:</strong> Revoking a session updates
          DynamoDB (<code className="font-mono-tech">AICGateSession</code>) and
          immediately blocks new STS minting and proxied S3 reads. Already-issued
          STS credentials continue working against S3 directly until their AWS
          expiration timestamp.
        </span>
      </div>

      <ReticleCard
        tag="DYNAMODB // AICGateSession"
        title="All Provisioned Sessions"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Session</th>
                <th className="px-3 py-2.5">Operator</th>
                <th className="px-3 py-2.5">Target Scope</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 min-w-44">Countdown</th>
                <th className="px-3 py-2.5">Control</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    SCANNING AICGateSession...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    NO SESSIONS RECORDED.
                  </td>
                </tr>
              ) : (
                sessions.map((session) => (
                  <tr
                    key={session.session_id}
                    className="border-b border-[var(--border-hair)]/60 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="font-mono-tech px-3 py-3 text-[var(--accent-cyan)]">
                      {session.session_id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold">
                        {session.requester_display_name ||
                          session.requester_username ||
                          session.requester_id ||
                          "legacy-unattributed"}
                      </div>
                      {session.requester_username && (
                        <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                          @{session.requester_username}
                        </div>
                      )}
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {session.bucket}/{session.prefix}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={session.status} />
                    </td>
                    <td className="px-3 py-3">
                      <CountdownBar
                        createdAt={session.created_at}
                        expiresAt={session.expires_at}
                        status={session.status}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={
                          session.status !== "ACTIVE" ||
                          busyId === session.session_id
                        }
                        onClick={() => handleRevoke(session.session_id)}
                        className="font-mono-tech inline-flex items-center gap-1 border border-[var(--accent-red)]/50 px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-red)] uppercase hover:bg-[var(--accent-red-soft)] disabled:opacity-35"
                      >
                        <Ban className="h-3 w-3" />
                        REVOKE
                      </button>
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
