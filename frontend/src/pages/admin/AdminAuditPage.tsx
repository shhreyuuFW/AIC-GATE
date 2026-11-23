import { useCallback, useEffect, useState } from "react";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard, StatusBadge } from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AuditEventItem } from "../../types/api";

export function AdminAuditPage() {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // AUDIT STREAM"
      title="Security Audit Log"
      description="Structured, secret-redacted security events recorded by the AIC-GATE backend."
      onRefresh={loadAudit}
    >
      <ReticleCard
        tag="STRUCTURED TELEMETRY // SECRETS REDACTED"
        title="Recent Security Events"
        subtitle="Secret access keys, session tokens, and passwords are automatically stripped from audit metadata."
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
