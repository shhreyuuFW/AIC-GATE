import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  FileText,
  KeyRound,
  LifeBuoy,
  ShieldAlert,
} from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  RoleBadge,
  StatusBadge,
} from "../../components/TacticalUI";
import { useAutoSync } from "../../hooks/useAutoSync";
import { api } from "../../lib/api";
import type {
  AuditEventItem,
  MasterOrgSummary,
  MemberAccount,
  SupportTicketItem,
  TicketStatus,
} from "../../types/api";

type MasterTab = "orgs" | "tickets" | "audit";

export function MasterPortalPage() {
  const [tab, setTab] = useState<MasterTab>("orgs");
  const [orgs, setOrgs] = useState<MasterOrgSummary[]>([]);
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>([]);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [orgMembers, setOrgMembers] = useState<Record<string, MemberAccount[]>>(
    {}
  );
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [ticketNotes, setTicketNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [orgsRes, ticketsRes, auditRes] = await Promise.all([
        api.masterListOrgs(),
        api.masterListTickets(),
        api.masterAudit(100),
      ]);
      setOrgs(orgsRes.organizations);
      setTickets(ticketsRes.tickets);
      setAuditEvents(auditRes.events);
    } catch (err) {
      if (!silent) {
        setNotice({
          message:
            err instanceof Error
              ? err.message
              : "Failed to load Master Control Plane",
          tone: "error",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useAutoSync(() => loadData(true), 9000);

  const loadMembersForOrg = async (orgId: string) => {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
      return;
    }
    try {
      const res = await api.masterListOrgUsers(orgId);
      setOrgMembers((prev) => ({ ...prev, [orgId]: res.users }));
      setExpandedOrgId(orgId);
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Unable to load org members",
        tone: "error",
      });
    }
  };

  const handleRenameOrg = async (org: MasterOrgSummary) => {
    const nextName = (renameDrafts[org.org_id] ?? org.org_name).trim();
    if (!nextName) return;
    try {
      await api.masterUpdateOrg(org.org_id, { org_name: nextName });
      setNotice({
        message: `RENAMED TENANT ${org.org_id} TO "${nextName}"`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Rename failed",
        tone: "error",
      });
    }
  };

  const handleToggleOrgStatus = async (org: MasterOrgSummary) => {
    const nextStatus = org.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    try {
      await api.masterUpdateOrg(org.org_id, { status: nextStatus });
      setNotice({
        message: `TENANT ${org.org_name} MARKED ${nextStatus}`,
        tone: nextStatus === "ACTIVE" ? "success" : "info",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Status update failed",
        tone: "error",
      });
    }
  };

  const handleSetAdminTier = async (
    orgId: string,
    username: string,
    tier: "delegated" | "owner" | "none"
  ) => {
    try {
      await api.masterSetOrgAdmin(orgId, username, tier);
      const res = await api.masterListOrgUsers(orgId);
      setOrgMembers((prev) => ({ ...prev, [orgId]: res.users }));
      setNotice({
        message: `UPDATED @${username} TIER TO ${tier.toUpperCase()}`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Admin tier change failed",
        tone: "error",
      });
    }
  };

  const handleResetMfa = async (orgId: string, username: string) => {
    try {
      await api.masterResetUserMfa(username);
      const res = await api.masterListOrgUsers(orgId);
      setOrgMembers((prev) => ({ ...prev, [orgId]: res.users }));
      setNotice({
        message: `BREAK-GLASS MFA RESET COMPLETE FOR @${username}`,
        tone: "info",
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "MFA reset failed",
        tone: "error",
      });
    }
  };

  const handleTicketAction = async (
    ticket: SupportTicketItem,
    status: TicketStatus,
    applyOrgRename = false
  ) => {
    try {
      await api.masterUpdateTicket(ticket.ticket_id, {
        status,
        resolution_note: ticketNotes[ticket.ticket_id] || "",
        apply_org_rename: applyOrgRename,
      });
      setNotice({
        message: `TICKET ${ticket.ticket_id} UPDATED TO ${status}${applyOrgRename ? " (ORG RENAMED)" : ""}`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Ticket update failed",
        tone: "error",
      });
    }
  };

  const openTicketCount = tickets.filter(
    (t) => t.status === "OPEN" || t.status === "IN_REVIEW"
  ).length;

  return (
    <PortalLayout
      portal="master"
      eyebrow="AIC-GATE PLATFORM // NON-ORGANIZATIONAL AUTHORITY"
      title="Master Control Plane"
      description="Govern tenant organizations, respond to Org Admin escalations, and execute break-glass recovery without touching tenant AWS STS credentials."
      onRefresh={() => void loadData(false)}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="flex items-start gap-2.5 border border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan-soft)] px-4 py-3 text-xs">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
        <span>
          <strong>Zero-Trust Tenant Boundary:</strong> Platform Master manages
          tenant governance, org names, break-glass admin recovery, and support
          tickets, and is server-blocked from tenant STS credential minting.
        </span>
      </div>

      {/* Navigation Tabs */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            id: "orgs",
            label: `ORGANIZATIONS (${orgs.length})`,
            icon: <Building2 className="h-3.5 w-3.5" />,
          },
          {
            id: "tickets",
            label: `SUPPORT TICKETS (${openTicketCount} OPEN)`,
            icon: <LifeBuoy className="h-3.5 w-3.5" />,
          },
          {
            id: "audit",
            label: `PLATFORM AUDIT (${auditEvents.length})`,
            icon: <FileText className="h-3.5 w-3.5" />,
          },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as MasterTab)}
            className={`font-mono-tech flex items-center justify-center gap-2 border px-3 py-2.5 text-xs font-bold uppercase transition ${
              tab === item.id
                ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                : "border-[var(--border-hair)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {tab === "orgs" && (
        <ReticleCard
          tag="TENANT REGISTRY"
          title="Registered Organizations"
        >
          <div className="space-y-4">
            {loading ? (
              <p className="font-mono-tech py-8 text-center text-xs text-[var(--text-muted)]">
                LOADING TENANT REGISTRY...
              </p>
            ) : (
              orgs.map((org) => {
                const expanded = expandedOrgId === org.org_id;
                const members = orgMembers[org.org_id] || [];
                return (
                  <div
                    key={org.org_id}
                    className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-4"
                  >
                    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={org.status} />
                          <span className="text-sm font-bold">
                            {org.org_name}
                          </span>
                          <span className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                            {org.org_id} · OWNER: @{org.owner_username || "—"}
                          </span>
                        </div>
                        <p className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                          MEMBERS: {org.member_count} · ADMINS: {org.admin_count}{" "}
                          · DOMAIN: @{org.allowed_domain || "ANY"} · INVITE:{" "}
                          {org.invite_code}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={renameDrafts[org.org_id] ?? org.org_name}
                          onChange={(e) =>
                            setRenameDrafts((prev) => ({
                              ...prev,
                              [org.org_id]: e.target.value,
                            }))
                          }
                          className="font-mono-tech border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--accent-cyan)]"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRenameOrg(org)}
                          className="font-mono-tech border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-1.5 text-[10px] font-bold uppercase hover:border-[var(--accent-cyan)]"
                        >
                          RENAME
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleOrgStatus(org)}
                          className={`font-mono-tech border px-3 py-1.5 text-[10px] font-bold uppercase ${
                            org.status === "SUSPENDED"
                              ? "border-[var(--accent-green)]/50 text-[var(--accent-green)]"
                              : "border-[var(--accent-red)]/50 text-[var(--accent-red)]"
                          }`}
                        >
                          {org.status === "SUSPENDED" ? "ACTIVATE" : "SUSPEND"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadMembersForOrg(org.org_id)}
                          className="font-mono-tech inline-flex items-center gap-1 border border-[var(--border-hair)] px-3 py-1.5 text-[10px] font-bold uppercase"
                        >
                          MEMBERS
                          {expanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="mt-4 space-y-2 border-t border-[var(--border-hair)] pt-3">
                        {members.map((m) => (
                          <div
                            key={m.user_id}
                            className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold">{m.display_name}</span>
                              <span className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                                @{m.username}
                              </span>
                              <RoleBadge
                                label={m.effective_role}
                                color={m.custom_role_color}
                              />
                              <StatusBadge status={m.status} />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {m.admin_tier !== "owner" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSetAdminTier(
                                      org.org_id,
                                      m.username,
                                      "owner"
                                    )
                                  }
                                  className="font-mono-tech border border-[var(--accent-amber)]/50 px-2 py-1 text-[10px] font-bold text-[var(--accent-amber)] uppercase"
                                >
                                  MAKE OWNER
                                </button>
                              )}
                              {m.admin_tier !== "delegated" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSetAdminTier(
                                      org.org_id,
                                      m.username,
                                      "delegated"
                                    )
                                  }
                                  className="font-mono-tech border border-[var(--accent-cyan)]/50 px-2 py-1 text-[10px] font-bold text-[var(--accent-cyan)] uppercase"
                                >
                                  DELEGATED ADMIN
                                </button>
                              )}
                              {m.role === "admin" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleSetAdminTier(
                                      org.org_id,
                                      m.username,
                                      "none"
                                    )
                                  }
                                  className="font-mono-tech border border-[var(--border-hair)] px-2 py-1 text-[10px] uppercase"
                                >
                                  DEMOTE
                                </button>
                              )}
                              {m.mfa_enabled && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleResetMfa(org.org_id, m.username)
                                  }
                                  className="font-mono-tech inline-flex items-center gap-1 border border-[var(--accent-red)]/50 px-2 py-1 text-[10px] font-bold text-[var(--accent-red)] uppercase"
                                >
                                  <KeyRound className="h-3 w-3" />
                                  RESET MFA
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ReticleCard>
      )}

      {tab === "tickets" && (
        <ReticleCard
          tag="ESCALATION QUEUE"
          title="Organization Support Tickets"
        >
          <div className="space-y-3">
            {tickets.length === 0 ? (
              <p className="font-mono-tech py-8 text-center text-xs text-[var(--text-muted)]">
                NO SUPPORT TICKETS IN QUEUE.
              </p>
            ) : (
              tickets.map((t) => (
                <div
                  key={t.ticket_id}
                  className="space-y-3 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={t.status} />
                        <span className="font-mono-tech border border-[var(--border-hair)] px-2 py-0.5 text-[10px] font-bold">
                          {t.category}
                        </span>
                        <span className="text-sm font-bold">{t.subject}</span>
                      </div>
                      <p className="font-mono-tech mt-1 text-[11px] text-[var(--text-muted)]">
                        ORG: {t.org_name} ({t.org_id}) · BY: @
                        {t.created_by_username} ·{" "}
                        {new Date(t.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-[var(--text-main)]">
                    {t.description}
                  </p>
                  {t.requested_value && (
                    <p className="font-mono-tech text-xs text-[var(--accent-cyan)]">
                      REQUESTED VALUE: {t.requested_value}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-hair)] pt-3">
                    <input
                      value={ticketNotes[t.ticket_id] ?? t.resolution_note}
                      onChange={(e) =>
                        setTicketNotes((prev) => ({
                          ...prev,
                          [t.ticket_id]: e.target.value,
                        }))
                      }
                      placeholder="Master Admin resolution note..."
                      className="min-w-52 flex-1 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs outline-none focus:border-[var(--accent-cyan)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleTicketAction(t, "IN_REVIEW")}
                      className="font-mono-tech border border-[var(--accent-cyan)]/50 px-3 py-1.5 text-[10px] font-bold text-[var(--accent-cyan)] uppercase"
                    >
                      IN REVIEW
                    </button>
                    {t.category === "ORG_RENAME" && t.requested_value ? (
                      <button
                        type="button"
                        onClick={() =>
                          void handleTicketAction(t, "RESOLVED", true)
                        }
                        className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-3 py-1.5 text-[10px] font-bold text-[var(--accent-volt-ink)] uppercase"
                      >
                        RESOLVE & APPLY RENAME
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleTicketAction(t, "RESOLVED")}
                        className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-3 py-1.5 text-[10px] font-bold text-[var(--accent-volt-ink)] uppercase"
                      >
                        RESOLVE
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleTicketAction(t, "CLOSED")}
                      className="font-mono-tech border border-[var(--border-hair)] px-3 py-1.5 text-[10px] uppercase"
                    >
                      CLOSE
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ReticleCard>
      )}

      {tab === "audit" && (
        <ReticleCard
          tag="PLATFORM TELEMETRY"
          title="Recent Platform Audit Events"
        >
          <div className="space-y-2">
            {auditEvents.map((ev) => (
              <div
                key={ev.event_id}
                className="flex flex-wrap items-center justify-between gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={ev.outcome} />
                  <span className="font-mono-tech font-bold">{ev.action}</span>
                  <span className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                    ACTOR: {ev.actor_id} ({ev.actor_role})
                  </span>
                </div>
                <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                  {new Date(ev.timestamp).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </ReticleCard>
      )}
    </PortalLayout>
  );
}
