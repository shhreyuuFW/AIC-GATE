import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Ban,
  FileCode2,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  RoleBadge,
  ServiceBadge,
  StatusBadge,
  UserAvatar,
} from "../../components/TacticalUI";
import { useAutoSync } from "../../hooks/useAutoSync";
import { api } from "../../lib/api";
import type {
  AccessSessionItem,
  MemberAccount,
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

function formatResourceTarget(session: AccessSessionItem): string {
  const bucket = (session.bucket || "").trim();
  const prefix = (session.prefix || "").trim();
  if (!bucket) return prefix;
  if (!prefix || bucket === prefix || prefix.startsWith(bucket)) {
    return prefix || bucket;
  }
  return `${bucket}/${prefix}`;
}

export function AdminGraphPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [members, setMembers] = useState<MemberAccount[]>([]);
  const [selected, setSelected] = useState<AccessSessionItem | null>(null);
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<"ALL" | ServiceType>("ALL");
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showInspectorInMax, setShowInspectorInMax] = useState(true);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  // GPS-style Pan & Zoom state
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const dragMovedRef = useRef(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const loadGraph = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [sessRes, userRes] = await Promise.all([
        api.listSessions(),
        api.adminListUsers(),
      ]);
      const recent = sessRes.sessions.slice(0, 16);
      setSessions(recent);
      setMembers(userRes.users);
      setSelected((prev) =>
        prev
          ? recent.find((s) => s.session_id === prev.session_id) ||
            recent[0] ||
            null
          : recent[0] || null
      );
    } catch {
      if (!silent) setSessions([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph(false);
  }, [loadGraph]);

  useAutoSync(() => loadGraph(true), 9000);

  const resetViewport = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const clampZoom = (next: number) =>
    Math.min(2.4, Math.max(0.45, Number(next.toFixed(2))));

  // Keyboard shortcuts: R = sync, A = active only, F = fit/reset view, Esc = minimize or clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        void loadGraph(false);
      } else if (e.key === "a" || e.key === "A") {
        setActiveOnly((prev) => !prev);
      } else if (e.key === "f" || e.key === "F") {
        resetViewport();
      } else if (e.key === "Escape") {
        if (isMaximized) {
          setIsMaximized(false);
        } else {
          setSelected(null);
          setPolicy(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadGraph, resetViewport, isMaximized]);

  const membersById = useMemo(() => {
    const map = new Map<string, MemberAccount>();
    for (const m of members) {
      map.set(m.user_id, m);
    }
    return map;
  }, [members]);

  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (activeOnly && s.status !== "ACTIVE") return false;
      if (serviceFilter !== "ALL" && (s.service || "s3") !== serviceFilter) {
        return false;
      }
      if (q) {
        const hay =
          `${s.session_id} ${s.requester_id || ""} ${s.requester_username || ""} ${s.requester_display_name || ""} ${s.bucket} ${s.prefix}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, activeOnly, serviceFilter, search]);

  // Non-passive wheel zoom bound to active viewport container
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      setZoom((prevZoom) => {
        const nextZoom = clampZoom(prevZoom + delta);
        if (nextZoom === prevZoom) return prevZoom;

        const rect = el.getBoundingClientRect();
        const cursorX = ((e.clientX - rect.left) / rect.width) * 860;
        const cursorY = ((e.clientY - rect.top) / rect.height) * 380;
        const ratio = nextZoom / prevZoom;
        setPan((prevPan) => ({
          x: cursorX - (cursorX - prevPan.x) * ratio,
          y: cursorY - (cursorY - prevPan.y) * ratio,
        }));
        return nextZoom;
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [isMaximized, loading, filteredSessions.length]);

  const { identities, resources } = useMemo(() => {
    const idSet = Array.from(
      new Set(filteredSessions.map((s) => s.requester_id || "legacy-operator"))
    );
    const resSet = Array.from(
      new Set(
        filteredSessions.map(
          (s) => `${s.service || "s3"}::${formatResourceTarget(s)}`
        )
      )
    );
    return { identities: idSet, resources: resSet };
  }, [filteredSessions]);

  const hoveredSession = useMemo(
    () =>
      hoveredSessionId
        ? filteredSessions.find((s) => s.session_id === hoveredSessionId) || null
        : null,
    [hoveredSessionId, filteredSessions]
  );

  const hoveredSessionResKey = hoveredSession
    ? `${hoveredSession.service || "s3"}::${formatResourceTarget(hoveredSession)}`
    : null;

  const handleQuickRevoke = async () => {
    if (!selected) return;
    try {
      await api.revokeSession(selected.session_id);
      setNotice({
        message: `SESSION ${selected.session_id.slice(0, 8)} REVOKED FROM TOPOLOGY VIEW`,
        tone: "info",
      });
      await loadGraph(false);
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

  const rowHeight = 76;
  const maxRows = Math.max(
    identities.length,
    filteredSessions.length,
    resources.length,
    1
  );
  const svgHeight = Math.max(320, maxRows * rowHeight + 68);

  const getY = (index: number, count: number) => {
    const span = svgHeight - 90;
    if (count <= 1) return svgHeight / 2;
    return 52 + (index / (count - 1)) * span;
  };

  const hoveredUserInfo = useMemo(() => {
    if (!hoveredUserId) return null;
    const member = membersById.get(hoveredUserId);
    const userSessions = sessions.filter(
      (s) => (s.requester_id || "legacy-operator") === hoveredUserId
    );
    const activeCount = userSessions.filter((s) => s.status === "ACTIVE").length;
    const fallbackSess = userSessions[0];
    return {
      displayName:
        member?.display_name ||
        fallbackSess?.requester_display_name ||
        hoveredUserId,
      username:
        member?.username || fallbackSess?.requester_username || hoveredUserId,
      roleLabel:
        member?.effective_role ||
        fallbackSess?.requester_role_label ||
        "Requester",
      roleColor: member?.custom_role_color || "cyan",
      avatar: member?.avatar || "",
      activeCount,
      totalCount: userSessions.length,
    };
  }, [hoveredUserId, membersById, sessions]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragMovedRef.current = false;
    setIsPanning(true);
    panOriginRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panOriginRef.current || !viewportRef.current) return;
    const dxPx = e.clientX - panOriginRef.current.clientX;
    const dyPx = e.clientY - panOriginRef.current.clientY;
    if (Math.abs(dxPx) > 4 || Math.abs(dyPx) > 4) {
      dragMovedRef.current = true;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    const scaleX = 860 / Math.max(1, rect.width);
    const scaleY = svgHeight / Math.max(1, rect.height);
    setPan({
      x: panOriginRef.current.panX + dxPx * scaleX,
      y: panOriginRef.current.panY + dyPx * scaleY,
    });
  };

  const endPan = () => {
    setIsPanning(false);
    panOriginRef.current = null;
  };

  const filterBar = (
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
  );

  const renderGraphCanvas = (fullHeight: boolean) => {
    if (loading) {
      return (
        <p className="font-mono-tech py-16 text-center text-xs text-[var(--text-muted)]">
          COMPILING ENTITLEMENT GRAPH...
        </p>
      );
    }
    if (filteredSessions.length === 0) {
      return (
        <p className="font-mono-tech py-16 text-center text-xs text-[var(--text-muted)]">
          NO SESSIONS MATCH CURRENT FILTERS.
        </p>
      );
    }

    return (
      <div
        ref={viewportRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
        className={`relative overflow-hidden border border-[var(--border-hair)] bg-[var(--bg-elevated)] select-none ${
          fullHeight ? "h-full min-h-[420px] flex-1" : "h-[460px]"
        } ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--border-strong) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Top-left canvas telemetry hint */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="font-mono-tech pointer-events-none absolute top-3 left-3 z-10 border border-[var(--border-hair)] bg-[var(--bg-panel)]/90 px-2.5 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur-xs"
        >
          DRAG TO PAN · SCROLL TO ZOOM · HOVER NODES
        </div>

        {/* Floating User Hover Detail Dock */}
        {hoveredUserInfo && (
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="endfield-panel pointer-events-none absolute bottom-3 left-3 z-20 w-64 border-[var(--accent-cyan)] bg-[var(--bg-panel)]/95 p-3 shadow-xl backdrop-blur-xs"
          >
            <div className="flex items-center gap-2.5">
              <UserAvatar
                avatar={hoveredUserInfo.avatar}
                displayName={hoveredUserInfo.displayName}
                size="sm"
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-bold">
                  {hoveredUserInfo.displayName}
                </div>
                <div className="font-mono-tech truncate text-[10px] text-[var(--text-muted)]">
                  @{hoveredUserInfo.username}
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-hair)] pt-2">
              <RoleBadge
                label={hoveredUserInfo.roleLabel}
                color={hoveredUserInfo.roleColor}
              />
              <span className="font-mono-tech text-[10px] font-semibold text-[var(--accent-green)]">
                {hoveredUserInfo.activeCount} ACTIVE /{" "}
                {hoveredUserInfo.totalCount} TOTAL
              </span>
            </div>
          </div>
        )}

        {/* Map-style Pan/Zoom/Maximize HUD */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-3 bottom-3 z-20 flex items-center gap-1 border border-[var(--border-strong)] bg-[var(--bg-panel)]/95 p-1 shadow-lg backdrop-blur-xs"
        >
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z - 0.2))}
            title="Zoom out"
            className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="font-mono-tech min-w-11 text-center text-[10px] font-bold">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => clampZoom(z + 0.2))}
            title="Zoom in"
            className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={resetViewport}
            title="Reset view [F]"
            className="border-l border-[var(--border-hair)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-main)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsMaximized((prev) => !prev)}
            title={isMaximized ? "Minimize [Esc]" : "Maximize Graph Screen"}
            className="border-l border-[var(--border-hair)] p-1.5 text-[var(--accent-cyan)] hover:bg-[var(--bg-elevated)]"
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <svg
          viewBox={`0 0 860 ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          <defs>
            <filter
              id="downstream-glow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feDropShadow
                dx="0"
                dy="0"
                stdDeviation="4"
                floodColor="#22d3ee"
                floodOpacity="0.65"
              />
            </filter>
          </defs>

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            <text
              x="105"
              y="22"
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              IDENTITY
            </text>
            <text
              x="430"
              y="22"
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              STS SESSION
            </text>
            <text
              x="745"
              y="22"
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
            >
              AWS RESOURCE
            </text>

            {/* Edges */}
            {filteredSessions.map((session, sIdx) => {
              const idIdx = identities.indexOf(
                session.requester_id || "legacy-operator"
              );
              const resKey = `${session.service || "s3"}::${formatResourceTarget(session)}`;
              const resIdx = resources.indexOf(resKey);
              const y1 = getY(idIdx, identities.length);
              const y2 = getY(sIdx, filteredSessions.length);
              const y3 = getY(resIdx, resources.length);
              const isActive = session.status === "ACTIVE";
              const isExpired = session.status === "EXPIRED";
              const isHoveredSess = hoveredSessionId === session.session_id;

              // Highlight ONLY downstream (session -> resource), NEVER upstream (identity -> session)
              const upstreamOpacity = hoveredSessionId
                ? 0.18
                : isActive
                  ? 1
                  : 0.38;
              const downstreamOpacity = hoveredSessionId
                ? isHoveredSess
                  ? 1
                  : 0.14
                : isActive
                  ? 1
                  : 0.45;

              const stroke = isActive
                ? "var(--accent-green)"
                : isExpired
                  ? "var(--accent-red)"
                  : "var(--border-strong)";

              const midX = (515 + 645) / 2;
              const midY = (y2 + y3) / 2;

              return (
                <g key={`edge-${session.session_id}`}>
                  <motion.path
                    d={`M 190 ${y1} C 265 ${y1}, 265 ${y2}, 345 ${y2}`}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isActive ? 2.2 : 1.2}
                    strokeDasharray={isActive ? undefined : "5 5"}
                    opacity={upstreamOpacity}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.35 }}
                  />
                  <motion.path
                    d={`M 515 ${y2} C 580 ${y2}, 580 ${y3}, 645 ${y3}`}
                    fill="none"
                    stroke={isHoveredSess ? "var(--accent-cyan)" : stroke}
                    strokeWidth={isHoveredSess ? 3.5 : isActive ? 2.2 : 1.3}
                    strokeDasharray={isActive ? undefined : "5 5"}
                    opacity={downstreamOpacity}
                    filter={isHoveredSess ? "url(#downstream-glow)" : undefined}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.35, delay: 0.08 }}
                  />
                  {isExpired && (
                    <g
                      transform={`translate(${midX}, ${midY})`}
                      opacity={downstreamOpacity}
                    >
                      <circle
                        r="8"
                        fill="var(--bg-panel)"
                        stroke="#ef4444"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                        stroke="#ef4444"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                </g>
              );
            })}

            {/* Identity Nodes */}
            {identities.map((id, idx) => {
              const y = getY(idx, identities.length);
              const member = membersById.get(id);
              const sessMatch = filteredSessions.find(
                (s) => (s.requester_id || "legacy-operator") === id
              );
              const label =
                member?.display_name ||
                sessMatch?.requester_display_name ||
                member?.username ||
                id;
              const sub =
                member?.username || sessMatch?.requester_username || id;
              const isHoveredUser = hoveredUserId === id;
              const dimForSessionHover = Boolean(hoveredSessionId);

              return (
                <g
                  key={`id-${id}`}
                  transform={`translate(20, ${y - 22})`}
                  opacity={dimForSessionHover ? 0.3 : 1}
                  style={{ cursor: "pointer", transition: "opacity 150ms ease" }}
                  onMouseEnter={() => setHoveredUserId(id)}
                  onMouseLeave={() => setHoveredUserId(null)}
                >
                  <g
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      transform: isHoveredUser ? "scale(1.05)" : "scale(1)",
                      transition: "transform 160ms ease",
                    }}
                  >
                    <rect
                      width="170"
                      height="44"
                      fill="var(--bg-panel)"
                      stroke="var(--accent-cyan)"
                      strokeWidth={isHoveredUser ? 2.4 : 1.5}
                    />
                    <text
                      x="85"
                      y="18"
                      textAnchor="middle"
                      fill="var(--text-main)"
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {label.length > 18 ? `${label.slice(0, 17)}…` : label}
                    </text>
                    <text
                      x="85"
                      y="33"
                      textAnchor="middle"
                      fill="var(--text-muted)"
                      fontSize="9.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      @{sub.length > 18 ? `${sub.slice(0, 17)}…` : sub}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Session Nodes */}
            {filteredSessions.map((session, idx) => {
              const y = getY(idx, filteredSessions.length);
              const isSel = selected?.session_id === session.session_id;
              const isHovered = hoveredSessionId === session.session_id;
              const dimmed = Boolean(hoveredSessionId && !isHovered);
              const stroke = isHovered
                ? "var(--accent-cyan)"
                : session.status === "ACTIVE"
                  ? "var(--accent-green)"
                  : session.status === "EXPIRED"
                    ? "var(--accent-red)"
                    : "var(--border-strong)";

              return (
                <g
                  key={session.session_id}
                  transform={`translate(345, ${y - 22})`}
                  opacity={dimmed ? 0.3 : 1}
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    setSelected(session);
                    setPolicy(null);
                  }}
                  onMouseEnter={() => setHoveredSessionId(session.session_id)}
                  onMouseLeave={() => setHoveredSessionId(null)}
                  style={{ cursor: "pointer", transition: "opacity 160ms ease" }}
                >
                  <g
                    filter={isHovered ? "url(#downstream-glow)" : undefined}
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      transform: isHovered ? "scale(1.07)" : "scale(1)",
                      transition: "transform 160ms ease",
                    }}
                  >
                    <rect
                      width="170"
                      height="44"
                      fill={isSel ? "var(--accent-volt)" : "var(--bg-panel)"}
                      stroke={stroke}
                      strokeWidth={isHovered || isSel ? 2.4 : 1.5}
                    />
                    <text
                      x="85"
                      y="18"
                      textAnchor="middle"
                      fill={
                        isSel ? "var(--accent-volt-ink)" : "var(--text-main)"
                      }
                      fontSize="11"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {session.session_id.slice(0, 12)}…
                    </text>
                    <text
                      x="85"
                      y="33"
                      textAnchor="middle"
                      fill={
                        isSel ? "var(--accent-volt-ink)" : "var(--text-muted)"
                      }
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {(session.service || "s3").toUpperCase()} ·{" "}
                      {session.status}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* AWS Resource Nodes */}
            {resources.map((resKey, idx) => {
              const [svc, target] = resKey.split("::");
              const y = getY(idx, resources.length);
              const isDownstreamMatch =
                hoveredSessionResKey !== null &&
                hoveredSessionResKey === resKey;
              const dimmed =
                hoveredSessionResKey !== null && !isDownstreamMatch;

              return (
                <g
                  key={`res-${resKey}`}
                  transform={`translate(645, ${y - 22})`}
                  opacity={dimmed ? 0.25 : 1}
                  style={{ transition: "opacity 160ms ease" }}
                >
                  <g
                    filter={
                      isDownstreamMatch ? "url(#downstream-glow)" : undefined
                    }
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      transform: isDownstreamMatch ? "scale(1.07)" : "scale(1)",
                      transition: "transform 160ms ease",
                    }}
                  >
                    <rect
                      width="195"
                      height="44"
                      fill="var(--bg-panel)"
                      stroke={
                        isDownstreamMatch
                          ? "var(--accent-cyan)"
                          : serviceColor(svc)
                      }
                      strokeWidth={isDownstreamMatch ? 2.6 : 1.5}
                    />
                    <text
                      x="97"
                      y="17"
                      textAnchor="middle"
                      fill={serviceColor(svc)}
                      fontSize="9"
                      fontWeight="bold"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {svc.toUpperCase()}
                    </text>
                    <text
                      x="97"
                      y="33"
                      textAnchor="middle"
                      fill="var(--text-main)"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {target.length > 26
                        ? `${target.slice(0, 25)}…`
                        : target}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    );
  };

  const inspectorBody = !selected ? (
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
          {selected.requester_display_name ||
            selected.requester_username ||
            selected.requester_id ||
            "legacy-operator"}
          {selected.requester_username && ` (@${selected.requester_username})`}
        </div>
      </div>
      <div>
        <div className="text-[var(--text-muted)]">TARGET</div>
        <div className="mt-0.5 break-all">{formatResourceTarget(selected)}</div>
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
  );

  const maximizedModal =
    isMaximized && typeof document !== "undefined"
      ? createPortal(
          <div className="endfield-grid-bg fixed inset-0 z-[95] flex flex-col bg-[var(--bg-canvas)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hair)] bg-[var(--bg-panel)] px-5 py-3">
              <div>
                <p className="font-mono-tech text-[10px] font-semibold tracking-[0.18em] text-[var(--accent-cyan)] uppercase">
                  FULLSCREEN TOPOLOGY // ENTITLEMENT CANVAS
                </p>
                <h2 className="text-base font-bold">
                  Live Entitlement Graph ({filteredSessions.length} edges)
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInspectorInMax((prev) => !prev)}
                  className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                >
                  {showInspectorInMax ? (
                    <>
                      <PanelRightClose className="h-3.5 w-3.5" />
                      HIDE INSPECTOR
                    </>
                  ) : (
                    <>
                      <PanelRightOpen className="h-3.5 w-3.5" />
                      SHOW INSPECTOR
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsMaximized(false)}
                  className="endfield-chamfer-sm font-mono-tech inline-flex items-center gap-1.5 bg-[var(--accent-volt)] px-3.5 py-1.5 text-[11px] font-bold text-[var(--accent-volt-ink)] uppercase"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  MINIMIZE (ESC)
                </button>
              </div>
            </div>

            <div className="px-5 pt-3">{filterBar}</div>

            <div className="flex min-h-0 flex-1 gap-4 p-5 pt-3">
              <div className="flex min-w-0 flex-1 flex-col">
                {renderGraphCanvas(true)}
              </div>

              {showInspectorInMax && (
                <div className="endfield-panel w-80 shrink-0 overflow-y-auto p-4">
                  <p className="font-mono-tech mb-1 text-[10px] font-semibold tracking-[0.16em] text-[var(--accent-cyan)] uppercase">
                    NODE INSPECTOR // QUICK ACTIONS
                  </p>
                  <h3 className="mb-4 border-b border-[var(--border-hair)] pb-2 text-sm font-bold">
                    Selected Grant
                  </h3>
                  {inspectorBody}
                </div>
              )}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <PortalLayout
      portal="admin"
      eyebrow="COMMANDER CONSOLE // INTERACTIVE TOPOLOGY"
      title="Live Entitlement Graph"
      description="Drag canvas to pan, scroll to zoom, hover nodes to inspect subtrees, or maximize fullscreen. Shortcuts: [R] Sync · [A] Active · [F] Fit · [Esc] Exit."
      onRefresh={() => void loadGraph(false)}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {filterBar}

      {!isMaximized && (
        <div className="grid gap-6 lg:grid-cols-12">
          <ReticleCard
            className="lg:col-span-8"
            tag="TOPOLOGY // IDENTITY → SESSION → AWS RESOURCE"
            title={`Entitlement Edges (${filteredSessions.length})`}
            action={
              <button
                type="button"
                onClick={() => setIsMaximized(true)}
                className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--accent-cyan)]/50 bg-[var(--accent-cyan-soft)] px-3 py-1.5 text-[11px] font-bold text-[var(--accent-cyan)] uppercase hover:border-[var(--accent-cyan)]"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                MAXIMIZE
              </button>
            }
          >
            {renderGraphCanvas(false)}
          </ReticleCard>

          <ReticleCard
            className="lg:col-span-4"
            tag="NODE INSPECTOR // QUICK ACTIONS"
            title="Selected Grant"
            subtitle="Click any session node in the graph."
          >
            {inspectorBody}
          </ReticleCard>
        </div>
      )}

      {maximizedModal}
    </PortalLayout>
  );
}
