import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Check,
  Copy,
  LifeBuoy,
  Pencil,
  RefreshCw,
  Send,
  Settings2,
  X,
} from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  RoleBadge,
  StatusBadge,
  UserAvatar,
} from "../../components/TacticalUI";
import { useAuth } from "../../context/AuthContext";
import { useAutoSync } from "../../hooks/useAutoSync";
import { api } from "../../lib/api";
import type {
  MemberAccount,
  OrganizationInfo,
  OrgRoleItem,
  SupportTicketItem,
  TicketCategory,
} from "../../types/api";

export function AdminOrgPage() {
  const { user, refreshUser } = useAuth();
  const isOwner = user?.admin_tier === "owner";

  const [org, setOrg] = useState<OrganizationInfo | null>(null);
  const [users, setUsers] = useState<MemberAccount[]>([]);
  const [roles, setRoles] = useState<OrgRoleItem[]>([]);
  const [tickets, setTickets] = useState<SupportTicketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Rename Org inline state
  const [editingOrg, setEditingOrg] = useState(false);
  const [orgNameDraft, setOrgNameDraft] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);

  // Manage Member Modal state
  const [managing, setManaging] = useState<MemberAccount | null>(null);
  const [deptDraft, setDeptDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [savingMember, setSavingMember] = useState(false);

  // Master Support Ticket drawer/form
  const [showSupport, setShowSupport] = useState(false);
  const [ticketCategory, setTicketCategory] =
    useState<TicketCategory>("ORG_RENAME");
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketDesc, setTicketDesc] = useState("");
  const [ticketRequestedValue, setTicketRequestedValue] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);

  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [orgRes, usersRes, rolesRes, ticketsRes] = await Promise.all([
        api.adminGetOrg(),
        api.adminListUsers(),
        api.adminListRoles(),
        api.adminListTickets(),
      ]);
      setOrg(orgRes);
      setOrgNameDraft((prev) => (editingOrg ? prev : orgRes.org_name));
      setUsers(usersRes.users);
      setRoles(rolesRes.roles);
      setTickets(ticketsRes.tickets);
    } catch (err) {
      if (!silent) {
        setNotice({
          message:
            err instanceof Error
              ? err.message
              : "Failed to load organization directory",
          tone: "error",
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [editingOrg]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useAutoSync(() => loadData(true), 9000);

  const handleCopyInvite = async () => {
    if (!org) return;
    try {
      await navigator.clipboard.writeText(org.invite_code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleRotateInvite = async () => {
    try {
      const updated = await api.adminRotateInvite();
      setOrg(updated);
      setNotice({
        message: `INVITE CODE ROTATED: ${updated.invite_code} (PREVIOUS CODE RETIRED PERMANENTLY)`,
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to rotate invite code",
        tone: "error",
      });
    }
  };

  const handleSaveOrgName = async (e: FormEvent) => {
    e.preventDefault();
    setSavingOrg(true);
    setNotice(null);
    try {
      const updated = await api.adminUpdateOrg({ org_name: orgNameDraft });
      setOrg(updated);
      setEditingOrg(false);
      await refreshUser();
      setNotice({
        message: `ORGANIZATION RENAMED TO "${updated.org_name}"`,
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to rename organization",
        tone: "error",
      });
    } finally {
      setSavingOrg(false);
    }
  };

  const handleReviewUser = async (
    username: string,
    decision: "ACTIVE" | "REJECTED"
  ) => {
    setBusyUser(username);
    setNotice(null);
    try {
      await api.adminReviewUser(username, decision);
      setNotice({
        message: `MEMBER ${username} MARKED ${decision}`,
        tone: decision === "ACTIVE" ? "success" : "info",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Review failed",
        tone: "error",
      });
    } finally {
      setBusyUser(null);
    }
  };

  const openManageModal = (member: MemberAccount) => {
    setManaging(member);
    setDeptDraft(member.department);
    setRoleDraft(member.custom_role_id || "");
  };

  const handleSaveMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!managing) return;
    setSavingMember(true);
    setNotice(null);
    try {
      const updated = await api.adminManageUser(managing.username, {
        department: deptDraft,
        custom_role_id: roleDraft || undefined,
        clear_custom_role: !roleDraft,
      });
      setManaging(updated);
      setNotice({
        message: `UPDATED MEMBER @${updated.username}`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Update failed",
        tone: "error",
      });
    } finally {
      setSavingMember(false);
    }
  };

  const handleMemberQuickAction = async (payload: {
    status?: "ACTIVE" | "SUSPENDED";
    admin_action?: "PROMOTE_DELEGATED" | "DEMOTE_REQUESTER";
  }) => {
    if (!managing) return;
    setSavingMember(true);
    setNotice(null);
    try {
      const updated = await api.adminManageUser(managing.username, payload);
      setManaging(updated);
      setNotice({
        message: `GOVERNANCE UPDATED FOR @${updated.username}`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Governance action denied",
        tone: "error",
      });
    } finally {
      setSavingMember(false);
    }
  };

  const handleSubmitTicket = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingTicket(true);
    setNotice(null);
    try {
      const created = await api.adminCreateTicket({
        category: ticketCategory,
        subject: ticketSubject,
        description: ticketDesc,
        requested_value: ticketRequestedValue,
      });
      setTicketSubject("");
      setTicketDesc("");
      setTicketRequestedValue("");
      setNotice({
        message: `TICKET ${created.ticket_id} SENT TO AIC-GATE MASTER ADMIN`,
        tone: "success",
      });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Ticket creation failed",
        tone: "error",
      });
    } finally {
      setSubmittingTicket(false);
    }
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // IDENTITY DIRECTORY"
      title="Organization & Members"
      description="Manage organization settings, unique invite codes, member governance tiers, and AIC-GATE platform support."
      onRefresh={() => void loadData(false)}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {org && (
        <ReticleCard
          tag={`TENANT // ${org.org_id} // ${org.status}`}
          title={org.org_name}
          subtitle={
            org.allowed_domain
              ? `Restricted email domain: @${org.allowed_domain}`
              : "Any valid email permitted with invite code"
          }
          action={
            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setOrgNameDraft(org.org_name);
                    setEditingOrg((prev) => !prev);
                  }}
                  className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  RENAME ORG
                </button>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={handleRotateInvite}
                  className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  ROTATE INVITE CODE
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSupport((prev) => !prev)}
                className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--accent-cyan)]/50 bg-[var(--accent-cyan-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-cyan)] uppercase"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                CONTACT AIC-GATE MASTER
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            {editingOrg && isOwner && (
              <form
                onSubmit={handleSaveOrgName}
                className="flex flex-wrap items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3"
              >
                <input
                  value={orgNameDraft}
                  onChange={(e) => setOrgNameDraft(e.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                  placeholder="New organization name"
                  className="font-mono-tech flex-1 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-1.5 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
                <button
                  type="submit"
                  disabled={savingOrg}
                  className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-4 py-1.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
                >
                  {savingOrg ? "SAVING..." : "SAVE NAME"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingOrg(false)}
                  className="font-mono-tech border border-[var(--border-hair)] px-3 py-1.5 text-xs uppercase"
                >
                  CANCEL
                </button>
              </form>
            )}

            {!isOwner && (
              <p className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                DELEGATED ADMIN TIER: You can approve signups, manage members, and assign roles. Only the Org Owner can rename the tenant, rotate invites, or promote delegated admins.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono-tech text-xs text-[var(--text-muted)]">
                ACTIVE INVITE CODE:
              </span>
              <code className="font-mono-tech border border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan-soft)] px-3 py-1 text-sm font-bold text-[var(--accent-cyan)]">
                {org.invite_code}
              </code>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="font-mono-tech inline-flex items-center gap-1 border border-[var(--border-hair)] px-2.5 py-1 text-[11px]"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[var(--accent-green)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "COPIED" : "COPY"}
              </button>
            </div>
          </div>
        </ReticleCard>
      )}

      {showSupport && (
        <ReticleCard
          tag="PLATFORM ESCALATION // MASTER ADMIN CHANNEL"
          title="AIC-GATE Support & Governance Tickets"
          subtitle="Request org renames, admin escalation/recovery, MFA break-glass reset, or catalog expansion."
        >
          <div className="grid gap-6 lg:grid-cols-12">
            <form onSubmit={handleSubmitTicket} className="space-y-3 lg:col-span-5">
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Category
                </label>
                <select
                  value={ticketCategory}
                  onChange={(e) =>
                    setTicketCategory(e.target.value as TicketCategory)
                  }
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                >
                  <option value="ORG_RENAME">ORG_RENAME</option>
                  <option value="ADMIN_ESCALATION">ADMIN_ESCALATION</option>
                  <option value="MFA_RECOVERY">MFA_RECOVERY</option>
                  <option value="SERVICE_CATALOG">SERVICE_CATALOG</option>
                  <option value="SECURITY_INCIDENT">SECURITY_INCIDENT</option>
                  <option value="GENERAL">GENERAL</option>
                </select>
              </div>
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Subject
                </label>
                <input
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  placeholder="Short summary..."
                  required
                  className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
              {ticketCategory === "ORG_RENAME" && (
                <div>
                  <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                    Requested New Organization Name
                  </label>
                  <input
                    value={ticketRequestedValue}
                    onChange={(e) => setTicketRequestedValue(e.target.value)}
                    placeholder="e.g. Acme Cloud Security"
                    className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                  />
                </div>
              )}
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Details
                </label>
                <textarea
                  rows={3}
                  value={ticketDesc}
                  onChange={(e) => setTicketDesc(e.target.value)}
                  placeholder="Explain the request for AIC-GATE Platform Master..."
                  required
                  className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
              <button
                type="submit"
                disabled={submittingTicket}
                className="endfield-chamfer-sm font-mono-tech inline-flex w-full items-center justify-center gap-1.5 bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
              >
                <Send className="h-3.5 w-3.5" />
                {submittingTicket ? "SENDING..." : "SUBMIT TO MASTER ADMIN"}
              </button>
            </form>

            <div className="space-y-2 lg:col-span-7">
              <div className="font-mono-tech text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                Submitted Org Tickets ({tickets.length})
              </div>
              {tickets.length === 0 ? (
                <p className="font-mono-tech border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-6 text-center text-xs text-[var(--text-muted)]">
                  NO TICKETS SUBMITTED YET.
                </p>
              ) : (
                tickets.map((t) => (
                  <div
                    key={t.ticket_id}
                    className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono-tech text-[11px] font-bold">
                        {t.subject}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono-tech border border-[var(--border-hair)] px-2 py-0.5 text-[10px]">
                          {t.category}
                        </span>
                        <StatusBadge status={t.status} />
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {t.description}
                    </p>
                    {t.resolution_note && (
                      <p className="font-mono-tech mt-2 border-t border-[var(--border-hair)] pt-1.5 text-[11px] text-[var(--accent-green)]">
                        MASTER RESPONSE: {t.resolution_note}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </ReticleCard>
      )}

      <ReticleCard
        tag="ORG-MANAGED ACCESS // MEMBER DIRECTORY"
        title="Team Members & Pending Signups"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Member</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Role & Tier</th>
                <th className="px-3 py-2.5">2FA</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    LOADING ORGANIZATION DIRECTORY...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="font-mono-tech px-3 py-6 text-center text-[var(--text-muted)]"
                  >
                    NO MEMBERS FOUND.
                  </td>
                </tr>
              ) : (
                users.map((member) => (
                  <tr
                    key={member.user_id}
                    className="border-b border-[var(--border-hair)]/60 hover:bg-[var(--bg-elevated)]"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          avatar={member.avatar}
                          displayName={member.display_name}
                          size="sm"
                        />
                        <div>
                          <div className="font-bold">{member.display_name}</div>
                          <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                            @{member.username}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono-tech px-3 py-3 text-[var(--text-muted)]">
                      {member.email}
                    </td>
                    <td className="px-3 py-3">{member.department}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge
                          label={member.effective_role}
                          color={member.custom_role_color}
                        />
                        {member.role === "admin" && (
                          <span className="font-mono-tech border border-[var(--accent-amber)]/40 px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent-amber)] uppercase">
                            {member.admin_tier === "owner" ? "OWNER" : "DELEGATED"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="font-mono-tech px-3 py-3">
                      {member.mfa_enabled ? (
                        <span className="text-[var(--accent-green)]">ON</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">OFF</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="px-3 py-3">
                      {member.status === "PENDING_APPROVAL" ? (
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            disabled={busyUser === member.username}
                            onClick={() =>
                              handleReviewUser(member.username, "ACTIVE")
                            }
                            className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-1 bg-[var(--accent-volt)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent-volt-ink)] uppercase"
                          >
                            <Check className="h-3 w-3" /> APPROVE
                          </button>
                          <button
                            type="button"
                            disabled={busyUser === member.username}
                            onClick={() =>
                              handleReviewUser(member.username, "REJECTED")
                            }
                            className="font-mono-tech inline-flex items-center gap-1 border border-[var(--accent-red)]/50 px-2.5 py-1 text-[10px] font-semibold text-[var(--accent-red)] uppercase"
                          >
                            <X className="h-3 w-3" /> REJECT
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openManageModal(member)}
                          className="font-mono-tech inline-flex items-center gap-1 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-2.5 py-1 text-[10px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                        >
                          <Settings2 className="h-3 w-3 text-[var(--accent-cyan)]" />
                          MANAGE
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ReticleCard>

      {/* Manage Member Modal */}
      {managing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="endfield-panel relative w-full max-w-md p-6">
            <button
              type="button"
              onClick={() => setManaging(null)}
              aria-label="Close"
              className="absolute top-4 right-4 border border-[var(--border-hair)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="font-mono-tech text-[10px] font-semibold tracking-[0.18em] text-[var(--accent-cyan)] uppercase">
              MEMBER GOVERNANCE // @{managing.username}
            </p>
            <h3 className="mt-1 text-lg font-bold">{managing.display_name}</h3>

            <form onSubmit={handleSaveMember} className="mt-4 space-y-4">
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Department
                </label>
                <input
                  value={deptDraft}
                  onChange={(e) => setDeptDraft(e.target.value)}
                  required
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>

              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Assigned Custom Role
                </label>
                <select
                  value={roleDraft}
                  onChange={(e) => setRoleDraft(e.target.value)}
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
                >
                  <option value="">Default ({managing.role === "admin" ? "Org Admin" : "Requester"})</option>
                  {roles.map((r) => (
                    <option key={r.role_id} value={r.role_id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  disabled={savingMember}
                  className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
                >
                  {savingMember ? "SAVING..." : "SAVE ATTRIBUTES"}
                </button>
              </div>
            </form>

            {managing.user_id !== user?.user_id && (
              <div className="mt-5 space-y-2 border-t border-[var(--border-hair)] pt-4">
                <div className="font-mono-tech text-[10px] font-semibold text-[var(--text-muted)] uppercase">
                  ADMIN & ACCOUNT CONTROLS
                </div>
                <div className="flex flex-wrap gap-2">
                  {isOwner && managing.role === "requester" && (
                    <button
                      type="button"
                      disabled={savingMember}
                      onClick={() =>
                        void handleMemberQuickAction({
                          admin_action: "PROMOTE_DELEGATED",
                        })
                      }
                      className="font-mono-tech border border-[var(--accent-cyan)]/50 bg-[var(--accent-cyan-soft)] px-3 py-1.5 text-[10px] font-bold text-[var(--accent-cyan)] uppercase"
                    >
                      PROMOTE TO DELEGATED ADMIN
                    </button>
                  )}
                  {isOwner &&
                    managing.role === "admin" &&
                    managing.admin_tier === "delegated" && (
                      <button
                        type="button"
                        disabled={savingMember}
                        onClick={() =>
                          void handleMemberQuickAction({
                            admin_action: "DEMOTE_REQUESTER",
                          })
                        }
                        className="font-mono-tech border border-[var(--accent-amber)]/50 px-3 py-1.5 text-[10px] font-semibold text-[var(--accent-amber)] uppercase"
                      >
                        DEMOTE TO REQUESTER
                      </button>
                    )}

                  {managing.admin_tier !== "owner" && (
                    <button
                      type="button"
                      disabled={savingMember}
                      onClick={() =>
                        void handleMemberQuickAction({
                          status:
                            managing.status === "SUSPENDED"
                              ? "ACTIVE"
                              : "SUSPENDED",
                        })
                      }
                      className={`font-mono-tech border px-3 py-1.5 text-[10px] font-bold uppercase ${
                        managing.status === "SUSPENDED"
                          ? "border-[var(--accent-green)]/50 text-[var(--accent-green)]"
                          : "border-[var(--accent-red)]/50 text-[var(--accent-red)]"
                      }`}
                    >
                      {managing.status === "SUSPENDED"
                        ? "REACTIVATE ACCOUNT"
                        : "SUSPEND ACCOUNT"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
