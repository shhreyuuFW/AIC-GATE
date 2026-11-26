import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Ban, FileCode2, Search } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  ServiceBadge,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type {
  AccessSessionItem,
  PolicyDocument,
  ServiceType,
} from "../../types/api";

const SERVICE_FILTERS: Array<"ALL" | ServiceType> = [
  "ALL",
  "s3",
  "dynamodb",
  "cloudwatch_logs",
  "ssm",
];

function serviceColor(service?: string): string {
  switch (service) {
    case "dynamodb":
      return "var(--accent-amber)";
    case "cloudwatch_logs":
      return "var(--accent-green)";
    case "ssm":
      return "var(--text-main)";
    case "s3":
    default:
      return "var(--accent-cyan)";
  }
}

export function AdminGraphPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [selected, setSelected] = useState<AccessSessionItem | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<"ALL" | ServiceType>("ALL");
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listSessions();
      const recent = res.sessions.slice(0, 14);
      setSessions(recent);
      setSelected((prev) =>
        prev
          ? recent.find((s) => s.session_id === prev.session_id) ||
            recent[0] ||
            null
          : recent[0] || null
      );
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Keyboard shortcuts: R = refresh, A = toggle active-only, Esc = clear selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        loadGraph();
      } else if (e.key === "a" || e.key === "A") {
        setActiveOnly((prev) => !prev);
      } else if (e.key === "Escape") {
        setSelected(null);
        setPolicy(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadGraph]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (activeOnly && s.status !== "ACTIVE") return false;
      if (serviceFilter !== "ALL" && (s.service || "s3") !== serviceFilter) {
        return false;
      }
      if (q) {
        const hay = `${s.session_id} ${s.requester_id || ""} ${s.bucket} ${s.prefix}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, activeOnly, serviceFilter, search]);

  const { identities, resources } = useMemo(() => {
    const idSet = Array.from(
      new Set(filteredSessions.map((s) => s.requester_id || "legacy-operator"))
    );
    const resSet = Array.from(
      new Set(filteredSessions.map((s) => `${s.service || "s3"}::${s.bucket}/${s.prefix}`))
    );
    return { identities: idSet, resources: resSet };
  }, [filteredSessions]);

  const handleQuickRevoke = async () => {
    if (!selected) return;
    try {
      await api.revokeSession(selected.session_id);
      setNotice({
        message: `SESSION ${selected.session_id.slice(0, 8)} REVOKED FROM TOPOLOGY VIEW`,
        tone: "info",
      });
      await loadGraph();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Revocation failed",
        tone: "error",
      });
    }
  };

  const handleQuickInspectPolicy = async () => {
    if (!selected) return;
    try {
      const res = await api.adminPreviewPolicy({
        bucket: selected.bucket,
        prefix: selected.prefix,
        actions: selected.actions,
        service: selected.service || "s3",
      });
      setPolicy(res.policy);
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Unable to inspect policy",
        tone: "error",
      });
    }
  };

  const rowHeight = 68;
  const maxRows = Math.max(
    identities.length,
    filteredSessions.length,
    resources.length,
    1
  );
  const svgHeight = Math.max(260, maxRows * rowHeight + 48);

  const getY = (index: number, count: number) => {
    const span = svgHeight - 60;
    if (count <= 1) return svgHeight / 2;
    return 30 + (index / (count - 1)) * span;
  };

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // INTERACTIVE TOPOLOGY"
      title="Live Entitlement Graph"
      description="Filter active grants, inspect STS policies, or revoke sessions directly. Shortcuts: [R] Sync · [A] Active Only · [Esc] Clear."
      onRefresh={loadGraph}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Tactical Filter Bar */}
      <div className="endfield-panel flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveOnly((prev) => !prev)}
            className={`font-mono-tech border px-2.5 py-1.5 text-[10px] font-bold uppercase ${
              activeOnly
                ? "border-[var(--accent-green)] bg-[var(--accent-green-soft)] text-[var(--accent-green)]"
                : "border-[var(--border-hair)] text-[var(--text-muted)]"
            }`}
          >
            {activeOnly ? "ACTIVE ONLY [ON]" : "ALL STATES"}
          </button>

          {SERVICE_FILTERS.map((svc) => (
            <button
              key={svc}
              type="button"
              onClick={() => setServiceFilter(svc)}
              className={`font-mono-tech border px-2.5 py-1.5 text-[10px] font-semibold uppercase ${
                serviceFilter === svc
                  ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                  : "border-[var(--border-hair)] text-[var(--text-muted)]"
              }`}
            >
              {svc}
            </button>
          ))}
        </div>

        <div className="relative min-w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter operator or prefix..."
            className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] py-1.5 pr-3 pl-8 text-xs outline-none focus:border-[var(--accent-cyan)]"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <ReticleCard
          className="lg:col-span-8"
          tag="TOPOLOGY // IDENTITY → SESSION → AWS RESOURCE"
          title={`Entitlement Edges (${filteredSessions.length})`}
        >
          {loading ? (
            <p className="font-mono-tech py-12 text-center text-xs text-[var(--text-muted)]">
              COMPILING ENTITLEMENT GRAPH...
            </p>
          ) : filteredSessions.length === 0 ? (
            <p className="font-mono-tech py-12 text-center text-xs text-[var(--text-muted)]">
              NO SESSIONS MATCH CURRENT FILTERS.
            </p>
          ) : (
            <div className="overflow-x-auto border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
              <svg
                viewBox={`0 0 820 ${svgHeight}`}
                className="h-auto w-full min-w-[640px]"
              >
                <text
                  x="90"
                  y="16"
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  IDENTITY
                </text>
                <text
                  x="410"
                  y="16"
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  STS SESSION
                </text>
                <text
                  x="720"
                  y="16"
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                >
                  AWS RESOURCE
                </text>

                {filteredSessions.map((session, sIdx) => {
                  const idIdx = identities.indexOf(
                    session.requester_id || "legacy-operator"
                  );
                  const resKey = `${session.service || "s3"}::${session.bucket}/${session.prefix}`;
                  const resIdx = resources.indexOf(resKey);
                  const y1 = getY(idIdx, identities.length);
                  const y2 = getY(sIdx, filteredSessions.length);
                  const y3 = getY(resIdx, resources.length);
                  const isActive = session.status === "ACTIVE";
                  const stroke = isActive
                    ? "var(--accent-green)"
                    : "var(--border-strong)";

                  return (
                    <g
                      key={`edge-${session.session_id}`}
                      opacity={isActive ? 1 : 0.35}
                    >
                      <motion.path
                        d={`M 170 ${y1} C 260 ${y1}, 260 ${y2}, 330 ${y2}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isActive ? 2.2 : 1.2}
                        strokeDasharray={isActive ? undefined : "5 5"}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4 }}
                      />
                      <motion.path
                        d={`M 490 ${y2} C 560 ${y2}, 560 ${y3}, 625 ${y3}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isActive ? 2.2 : 1.2}
                        strokeDasharray={isActive ? undefined : "5 5"}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                      />
                    </g>
                  );
                })}

                {identities.map((id, idx) => {
                  const y = getY(idx, identities.length);
                  return (
                    <g key={`id-${id}`} transform={`translate(15, ${y - 20})`}>
                      <rect
                        width="155"
                        height="40"
                        fill="var(--bg-panel)"
                        stroke="var(--accent-cyan)"
                        strokeWidth="1.5"
                      />
                      <text
                        x="77"
                        y="24"
                        textAnchor="middle"
                        fill="var(--text-main)"
                        fontSize="11"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {id}
                      </text>
                    </g>
                  );
                })}

                {filteredSessions.map((session, idx) => {
                  const y = getY(idx, filteredSessions.length);
                  const isSel = selected?.session_id === session.session_id;
                  const stroke =
                    session.status === "ACTIVE"
                      ? "var(--accent-green)"
                      : session.status === "EXPIRED"
                        ? "var(--accent-red)"
                        : "var(--border-strong)";
                  return (
                    <g
                      key={session.session_id}
                      transform={`translate(330, ${y - 20})`}
                      onClick={() => {
                        setSelected(session);
                        setPolicy(null);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        width="160"
                        height="40"
                        fill={isSel ? "var(--accent-volt)" : "var(--bg-panel)"}
                        stroke={stroke}
                        strokeWidth={isSel ? 2.2 : 1.5}
                      />
                      <text
                        x="80"
                        y="17"
                        textAnchor="middle"
                        fill={
                          isSel
                            ? "var(--accent-volt-ink)"
                            : "var(--text-main)"
                        }
                        fontSize="11"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {session.session_id.slice(0, 12)}…
                      </text>
                      <text
                        x="80"
                        y="31"
                        textAnchor="middle"
                        fill={
                          isSel
                            ? "var(--accent-volt-ink)"
                            : "var(--text-muted)"
                        }
                        fontSize="9"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {(session.service || "s3").toUpperCase()} ·{" "}
                        {session.status}
                      </text>
                    </g>
                  );
                })}

                {resources.map((resKey, idx) => {
                  const [svc, target] = resKey.split("::");
                  const y = getY(idx, resources.length);
                  return (
                    <g
                      key={`res-${resKey}`}
                      transform={`translate(625, ${y - 20})`}
                    >
                      <rect
                        width="180"
                        height="40"
                        fill="var(--bg-panel)"
                        stroke={serviceColor(svc)}
                        strokeWidth="1.5"
                      />
                      <text
                        x="90"
                        y="16"
                        textAnchor="middle"
                        fill={serviceColor(svc)}
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {svc.toUpperCase()}
                      </text>
                      <text
                        x="90"
                        y="30"
                        textAnchor="middle"
                        fill="var(--text-main)"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {target.length > 24
                          ? `${target.slice(0, 23)}…`
                          : target}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </ReticleCard>

        <ReticleCard
          className="lg:col-span-4"
          tag="NODE INSPECTOR // QUICK ACTIONS"
          title="Selected Grant"
          subtitle="Click any session node in the graph."
        >
          {!selected ? (
            <p className="font-mono-tech text-xs text-[var(--text-muted)]">
              NO SESSION SELECTED.
            </p>
          ) : (
            <div className="font-mono-tech space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <ServiceBadge service={selected.service} />
                <StatusBadge status={selected.status} />
              </div>
              <div>
                <div className="text-[var(--text-muted)]">SESSION ID</div>
                <div className="mt-0.5 break-all">{selected.session_id}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">OPERATOR</div>
                <div className="mt-0.5">
                  {selected.requester_id || "legacy-operator"}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">TARGET</div>
                <div className="mt-0.5 break-all">
                  {selected.bucket}/{selected.prefix}
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">EXPIRES AT</div>
                <div className="mt-0.5">
                  {new Date(selected.expires_at).toLocaleString()}
                </div>
              </div>

              <div className="grid gap-2 border-t border-[var(--border-hair)] pt-3">
                <button
                  type="button"
                  onClick={handleQuickInspectPolicy}
                  className="inline-flex items-center justify-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                >
                  <FileCode2 className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                  INSPECT COMPILED POLICY
                </button>
                <button
                  type="button"
                  disabled={selected.status !== "ACTIVE"}
                  onClick={handleQuickRevoke}
                  className="inline-flex items-center justify-center gap-1.5 border border-[var(--accent-red)]/50 px-3 py-2 text-[11px] font-semibold text-[var(--accent-red)] uppercase hover:bg-[var(--accent-red-soft)] disabled:opacity-35"
                >
                  <Ban className="h-3.5 w-3.5" />
                  REVOKE SESSION NOW
                </button>
                <Link
                  to="/admin/audit-log"
                  className="text-center text-[11px] text-[var(--accent-cyan)] underline"
                >
                  OPEN AUDIT STREAM →
                </Link>
              </div>

              {policy && (
                <pre className="max-h-48 overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-2.5 text-[10px] text-[#d7e6f5]">
                  {JSON.stringify(policy, null, 2)}
                </pre>
              )}
            </div>
          )}
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
