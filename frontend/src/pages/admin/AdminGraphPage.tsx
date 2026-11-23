import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PortalLayout } from "../../components/PortalLayout";
import { ReticleCard, StatusBadge } from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AccessSessionItem } from "../../types/api";

export function AdminGraphPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [selected, setSelected] = useState<AccessSessionItem | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listSessions();
      const recent = res.sessions.slice(0, 10);
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

  const { identities, resources } = useMemo(() => {
    const idSet = Array.from(
      new Set(sessions.map((s) => s.requester_id || "legacy-operator"))
    );
    const resSet = Array.from(
      new Set(sessions.map((s) => `${s.bucket}/${s.prefix}`))
    );
    return { identities: idSet, resources: resSet };
  }, [sessions]);

  const rowHeight = 68;
  const maxRows = Math.max(
    identities.length,
    sessions.length,
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
      eyebrow="COMMANDER CONSOLE // ENTITLEMENT TOPOLOGY"
      title="Live Entitlement Graph"
      description="Real-time topology mapping Identities → STS Sessions → Scoped S3 Prefixes. Informational view of authoritative DynamoDB state."
      onRefresh={loadGraph}
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <ReticleCard
          className="lg:col-span-8"
          tag="TOPOLOGY // IDENTITY → SESSION → RESOURCE"
          title="Active & Recent Entitlement Edges (Top 10)"
          subtitle="Pulsing cyan/green edges denote ACTIVE grants; dashed edges indicate EXPIRED or REVOKED grants."
        >
          {loading ? (
            <p className="font-mono-tech py-12 text-center text-xs text-[var(--text-muted)]">
              COMPILING ENTITLEMENT GRAPH...
            </p>
          ) : sessions.length === 0 ? (
            <p className="font-mono-tech py-12 text-center text-xs text-[var(--text-muted)]">
              NO SESSIONS AVAILABLE TO RENDER.
            </p>
          ) : (
            <div className="overflow-x-auto border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
              <svg
                viewBox={`0 0 820 ${svgHeight}`}
                className="h-auto w-full min-w-[640px]"
              >
                {/* Column Headers */}
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
                  S3 RESOURCE SCOPE
                </text>

                {/* Edges */}
                {sessions.map((session, sIdx) => {
                  const idIdx = identities.indexOf(
                    session.requester_id || "legacy-operator"
                  );
                  const resIdx = resources.indexOf(
                    `${session.bucket}/${session.prefix}`
                  );
                  const y1 = getY(idIdx, identities.length);
                  const y2 = getY(sIdx, sessions.length);
                  const y3 = getY(resIdx, resources.length);
                  const isActive = session.status === "ACTIVE";
                  const stroke = isActive
                    ? "var(--accent-green)"
                    : "var(--border-strong)";

                  return (
                    <g key={`edge-${session.session_id}`} opacity={isActive ? 1 : 0.4}>
                      <motion.path
                        d={`M 170 ${y1} C 260 ${y1}, 260 ${y2}, 330 ${y2}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isActive ? 2.2 : 1.2}
                        strokeDasharray={isActive ? undefined : "5 5"}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.45 }}
                      />
                      <motion.path
                        d={`M 490 ${y2} C 560 ${y2}, 560 ${y3}, 625 ${y3}`}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isActive ? 2.2 : 1.2}
                        strokeDasharray={isActive ? undefined : "5 5"}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.45, delay: 0.1 }}
                      />
                    </g>
                  );
                })}

                {/* Identity Nodes */}
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

                {/* Session Nodes */}
                {sessions.map((session, idx) => {
                  const y = getY(idx, sessions.length);
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
                      onClick={() => setSelected(session)}
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
                        {session.status}
                      </text>
                    </g>
                  );
                })}

                {/* Resource Nodes */}
                {resources.map((res, idx) => {
                  const y = getY(idx, resources.length);
                  return (
                    <g key={`res-${res}`} transform={`translate(625, ${y - 20})`}>
                      <rect
                        width="180"
                        height="40"
                        fill="var(--bg-panel)"
                        stroke="var(--accent-amber)"
                        strokeWidth="1.5"
                      />
                      <text
                        x="90"
                        y="24"
                        textAnchor="middle"
                        fill="var(--text-main)"
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {res.length > 25 ? `${res.slice(0, 24)}…` : res}
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
          tag="NODE INSPECTOR"
          title="Selected Grant"
          subtitle="Click any session node in the graph."
        >
          {!selected ? (
            <p className="font-mono-tech text-xs text-[var(--text-muted)]">
              NO SESSION SELECTED.
            </p>
          ) : (
            <div className="font-mono-tech space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">STATUS</span>
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
                <div className="text-[var(--text-muted)]">RESOURCE SCOPE</div>
                <div className="mt-0.5 break-all">
                  s3://{selected.bucket}/{selected.prefix}*
                </div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">ACTIONS</div>
                <div className="mt-0.5">{selected.actions.join(", ")}</div>
              </div>
              <div>
                <div className="text-[var(--text-muted)]">EXPIRES AT</div>
                <div className="mt-0.5">
                  {new Date(selected.expires_at).toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
