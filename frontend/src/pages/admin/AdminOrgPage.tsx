import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { MemberAccount, OrganizationInfo } from "../../types/api";

export function AdminOrgPage() {
  const [org, setOrg] = useState<OrganizationInfo | null>(null);
  const [users, setUsers] = useState<MemberAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [orgRes, usersRes] = await Promise.all([
        api.adminGetOrg(),
        api.adminListUsers(),
      ]);
      setOrg(orgRes);
      setUsers(usersRes.users);
    } catch (err) {
      setNotice({
        message:
          err instanceof Error
            ? err.message
            : "Failed to load organization directory",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        message: `INVITE CODE ROTATED: ${updated.invite_code}`,
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
      await loadData();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Review failed",
        tone: "error",
      });
    } finally {
      setBusyUser(null);
    }
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // IDENTITY DIRECTORY"
      title="Organization & Members"
      description="Manage your organization invite code and approve or reject employee signup requests."
      onRefresh={loadData}
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
          tag={`TENANT // ${org.org_id}`}
          title={org.org_name}
          subtitle={
            org.allowed_domain
              ? `Restricted email domain: @${org.allowed_domain}`
              : "Any valid email permitted with invite code"
          }
          action={
            <button
              type="button"
              onClick={handleRotateInvite}
              className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              ROTATE INVITE CODE
            </button>
          }
        >
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
        </ReticleCard>
      )}

      <ReticleCard
        tag="ORG-MANAGED ACCESS // MEMBER APPROVAL"
        title="Team Members & Pending Signups"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="font-mono-tech border-b border-[var(--border-hair)] text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                <th className="px-3 py-2.5">Username</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Role</th>
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
                    <td className="font-mono-tech px-3 py-3 font-bold">
                      {member.username}
                    </td>
                    <td className="font-mono-tech px-3 py-3 text-[var(--text-muted)]">
                      {member.email}
                    </td>
                    <td className="px-3 py-3">{member.department}</td>
                    <td className="font-mono-tech px-3 py-3 uppercase">
                      {member.role}
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
                        <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                          —
                        </span>
                      )}
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
