import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Award, CheckSquare, Plus, Square, Trash2, Users } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  RoleBadge,
  StatusBadge,
} from "../../components/TacticalUI";
import { useAutoSync } from "../../hooks/useAutoSync";
import { api } from "../../lib/api";
import type { MemberAccount, OrgRoleItem } from "../../types/api";

const COLOR_META: Record<
  string,
  { label: string; swatch: string; activeBorder: string }
> = {
  cyan: {
    label: "CYAN",
    swatch: "var(--accent-cyan)",
    activeBorder: "border-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)] text-[var(--text-main)]",
  },
  amber: {
    label: "AMBER",
    swatch: "var(--accent-amber)",
    activeBorder: "border-[var(--accent-amber)] bg-[var(--accent-amber-soft)] text-[var(--text-main)]",
  },
  green: {
    label: "GREEN",
    swatch: "var(--accent-green)",
    activeBorder: "border-[var(--accent-green)] bg-[var(--accent-green-soft)] text-[var(--text-main)]",
  },
  volt: {
    label: "VOLT",
    swatch: "var(--accent-volt)",
    activeBorder: "border-[var(--text-main)] bg-[var(--accent-volt)]/25 text-[var(--text-main)]",
  },
  red: {
    label: "RED",
    swatch: "var(--accent-red)",
    activeBorder: "border-[var(--accent-red)] bg-[var(--accent-red-soft)] text-[var(--text-main)]",
  },
  slate: {
    label: "SLATE",
    swatch: "var(--text-muted)",
    activeBorder: "border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-main)]",
  },
};

const COLOR_OPTIONS = ["cyan", "amber", "green", "volt", "red", "slate"] as const;

export function AdminRolesPage() {
  const [roles, setRoles] = useState<OrgRoleItem[]>([]);
  const [users, setUsers] = useState<MemberAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / Edit role state
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>("cyan");
  const [savingRole, setSavingRole] = useState(false);

  // Mass assignment state
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const [targetRoleId, setTargetRoleId] = useState<string>("");
  const [assignBusy, setAssignBusy] = useState(false);

  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [rolesRes, usersRes] = await Promise.all([
        api.adminListRoles(),
        api.adminListUsers(),
      ]);
      setRoles(rolesRes.roles);
      setUsers(usersRes.users.filter((u) => u.status === "ACTIVE"));
      setTargetRoleId((prev) =>
        prev || (rolesRes.roles[0]?.role_id ?? "")
      );
    } catch (err) {
      if (!silent) {
        setNotice({
          message:
            err instanceof Error ? err.message : "Failed to load org roles",
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

  useAutoSync(() => loadData(true), 10000);

  const resetRoleForm = () => {
    setEditingRoleId(null);
    setName("");
    setDescription("");
    setColor("cyan");
  };

  const handleSaveRole = async (e: FormEvent) => {
    e.preventDefault();
    setSavingRole(true);
    setNotice(null);
    try {
      if (editingRoleId) {
        await api.adminUpdateRole(editingRoleId, { name, description, color });
        setNotice({ message: `ROLE "${name}" UPDATED`, tone: "success" });
      } else {
        await api.adminCreateRole({ name, description, color });
        setNotice({ message: `ROLE "${name}" CREATED`, tone: "success" });
      }
      resetRoleForm();
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Role save failed",
        tone: "error",
      });
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: OrgRoleItem) => {
    if (
      !window.confirm(
        `Delete role "${role.name}"? Assigned members will fall back to their default role.`
      )
    ) {
      return;
    }
    try {
      await api.adminDeleteRole(role.role_id);
      setNotice({ message: `ROLE "${role.name}" DELETED`, tone: "info" });
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Delete failed",
        tone: "error",
      });
    }
  };

  const toggleUsername = (uname: string) => {
    setSelectedUsernames((prev) =>
      prev.includes(uname) ? prev.filter((x) => x !== uname) : [...prev, uname]
    );
  };

  const handleMassAssign = async () => {
    if (!targetRoleId || selectedUsernames.length === 0) return;
    setAssignBusy(true);
    setNotice(null);
    try {
      const res = await api.adminAssignRole(targetRoleId, selectedUsernames);
      setNotice({
        message: `ASSIGNED ROLE TO ${res.updated.length} MEMBER(S)`,
        tone: "success",
      });
      setSelectedUsernames([]);
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Assignment failed",
        tone: "error",
      });
    } finally {
      setAssignBusy(false);
    }
  };

  const handleMassUnassign = async () => {
    if (selectedUsernames.length === 0) return;
    setAssignBusy(true);
    setNotice(null);
    try {
      const res = await api.adminUnassignRoles(selectedUsernames);
      setNotice({
        message: `RESET ROLE TO DEFAULT FOR ${res.updated.length} MEMBER(S)`,
        tone: "info",
      });
      setSelectedUsernames([]);
      await loadData(false);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Unassign failed",
        tone: "error",
      });
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // CUSTOM RBAC LABELS"
      title="Role Management"
      description="Create organization roles and single-assign or bulk-assign them across active team members."
      onRefresh={() => void loadData(false)}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Create/Edit + List Roles */}
        <div className="space-y-6 lg:col-span-5">
          <ReticleCard
            tag={editingRoleId ? "EDIT ROLE" : "NEW ROLE"}
            title={editingRoleId ? "Update Custom Role" : "Create Organization Role"}
            action={<Award className="h-4 w-4 text-[var(--accent-cyan)]" />}
          >
            <form onSubmit={handleSaveRole} className="space-y-3">
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Role Title
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Incident Responder"
                  minLength={2}
                  maxLength={40}
                  required
                  className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
              <div>
                <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
                  Description
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Scope & team responsibilities"
                  maxLength={160}
                  className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
                />
              </div>
              <div>
                <label className="font-mono-tech mb-1.5 block text-[10px] font-semibold uppercase">
                  Badge Accent
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLOR_OPTIONS.map((c) => {
                    const meta = COLOR_META[c] ?? COLOR_META.cyan;
                    const isSelected = color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`font-mono-tech flex items-center gap-2 border px-2.5 py-1.5 text-[10px] font-bold uppercase transition ${
                          isSelected
                            ? `${meta.activeBorder} ring-1 ring-current`
                            : "border-[var(--border-hair)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 border border-black/30"
                          style={{ backgroundColor: meta.swatch }}
                        />
                        <span>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
                <div className="font-mono-tech mb-2 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
                  LIVE BADGE PREVIEW
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <RoleBadge
                    label={name.trim() || "Supervisor"}
                    color={color}
                  />
                  <span className="truncate text-[11px] text-[var(--text-muted)]">
                    {description.trim() ||
                      "Role badge appearance across sidebar & directory."}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingRole}
                  className="endfield-chamfer-sm font-mono-tech inline-flex flex-1 items-center justify-center gap-1.5 bg-[var(--accent-volt)] px-4 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {savingRole
                    ? "SAVING..."
                    : editingRoleId
                      ? "UPDATE ROLE"
                      : "CREATE ROLE"}
                </button>
                {editingRoleId && (
                  <button
                    type="button"
                    onClick={resetRoleForm}
                    className="font-mono-tech border border-[var(--border-hair)] px-3 py-2 text-xs uppercase"
                  >
                    CANCEL
                  </button>
                )}
              </div>
            </form>
          </ReticleCard>

          <ReticleCard
            tag="DEFINED ROLES"
            title={`Organization Roles (${roles.length})`}
          >
            <div className="space-y-2.5">
              {loading ? (
                <p className="font-mono-tech py-4 text-center text-xs text-[var(--text-muted)]">
                  LOADING ROLES...
                </p>
              ) : roles.length === 0 ? (
                <p className="font-mono-tech py-4 text-center text-xs text-[var(--text-muted)]">
                  NO CUSTOM ROLES CREATED YET.
                </p>
              ) : (
                roles.map((r) => (
                  <div
                    key={r.role_id}
                    className="flex items-start justify-between gap-3 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <RoleBadge label={r.name} color={r.color} />
                        <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                          {r.member_count ?? 0} member(s)
                        </span>
                      </div>
                      {r.description && (
                        <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                          {r.description}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRoleId(r.role_id);
                          setName(r.name);
                          setDescription(r.description);
                          setColor(r.color);
                        }}
                        className="font-mono-tech border border-[var(--border-hair)] px-2 py-1 text-[10px] uppercase hover:border-[var(--accent-cyan)]"
                      >
                        EDIT
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRole(r)}
                        aria-label={`Delete ${r.name}`}
                        className="border border-[var(--accent-red)]/40 p-1 text-[var(--accent-red)] hover:bg-[var(--accent-red-soft)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ReticleCard>
        </div>

        {/* Right: Single & Mass Role Assignment */}
        <ReticleCard
          className="lg:col-span-7"
          tag="BULK ASSIGNMENT // ORG MEMBERS"
          title="Assign or Remove Member Roles"
          subtitle="Select one or multiple active members to assign a custom role or restore their default role."
          action={<Users className="h-4 w-4 text-[var(--accent-cyan)]" />}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
              <select
                value={targetRoleId}
                onChange={(e) => setTargetRoleId(e.target.value)}
                className="font-mono-tech min-w-44 flex-1 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-xs"
              >
                <option value="">-- Choose Role --</option>
                {roles.map((r) => (
                  <option key={r.role_id} value={r.role_id}>
                    {r.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={
                  assignBusy || !targetRoleId || selectedUsernames.length === 0
                }
                onClick={() => void handleMassAssign()}
                className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-3.5 py-2 text-[11px] font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
              >
                ASSIGN ({selectedUsernames.length})
              </button>

              <button
                type="button"
                disabled={assignBusy || selectedUsernames.length === 0}
                onClick={() => void handleMassUnassign()}
                className="font-mono-tech border border-[var(--accent-red)]/50 px-3 py-2 text-[11px] font-semibold text-[var(--accent-red)] uppercase disabled:opacity-40"
              >
                CLEAR ROLE
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono-tech text-[var(--text-muted)]">
                ACTIVE MEMBERS ({users.length})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedUsernames(users.map((u) => u.username))
                  }
                  className="font-mono-tech text-[var(--accent-cyan)] hover:underline"
                >
                  SELECT ALL
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedUsernames([])}
                  className="font-mono-tech text-[var(--text-muted)] hover:underline"
                >
                  CLEAR
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {users.map((m) => {
                const checked = selectedUsernames.includes(m.username);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => toggleUsername(m.username)}
                    className={`flex w-full items-center justify-between gap-3 border p-3 text-left transition ${
                      checked
                        ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]"
                        : "border-[var(--border-hair)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {checked ? (
                        <CheckSquare className="h-4 w-4 shrink-0 text-[var(--accent-cyan)]" />
                      ) : (
                        <Square className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                      )}
                      <div>
                        <div className="text-xs font-bold">
                          {m.display_name}{" "}
                          <span className="font-mono-tech font-normal text-[var(--text-muted)]">
                            @{m.username}
                          </span>
                        </div>
                        <div className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                          {m.department}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <RoleBadge
                        label={m.effective_role}
                        color={m.custom_role_color}
                      />
                      <StatusBadge status={m.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
