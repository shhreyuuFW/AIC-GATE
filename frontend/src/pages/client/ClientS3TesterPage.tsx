import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Play, ShieldAlert, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  NoticeBanner,
  ReticleCard,
  ServiceBadge,
} from "../../components/TacticalUI";
import { useAutoSync } from "../../hooks/useAutoSync";
import { api } from "../../lib/api";
import type {
  AccessSessionItem,
  ScopeTesterPresets,
  ScopeTestResult,
  ServiceType,
} from "../../types/api";

const SERVICE_TABS: Array<{ id: ServiceType; label: string }> = [
  { id: "s3", label: "S3 Storage" },
  { id: "dynamodb", label: "DynamoDB" },
  { id: "cloudwatch_logs", label: "CloudWatch Logs" },
  { id: "ssm", label: "SSM Parameter Store" },
];

export function ClientS3TesterPage() {
  const [activeService, setActiveService] = useState<ServiceType>("s3");
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [presets, setPresets] = useState<ScopeTesterPresets | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("logs/sample.log");
  const [useLabSample, setUseLabSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    title: string;
    payload?: ScopeTestResult;
    error?: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [sessRes, presetRes] = await Promise.all([
        api.listSessions(),
        presets ? Promise.resolve({ presets }) : api.getScopeTesterPresets(),
      ]);
      setSessions(sessRes.sessions);
      setPresets(presetRes.presets);
      setSelectedId((prev) => {
        if (prev && sessRes.sessions.some((s) => s.session_id === prev)) {
          return prev;
        }
        const match = sessRes.sessions.find(
          (s) => s.status === "ACTIVE" && (s.service || "s3") === activeService
        );
        return match?.session_id || sessRes.sessions[0]?.session_id || "";
      });
    } catch {
      // Handled via empty state
    }
  }, [activeService, presets]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useAutoSync(loadData, 10000);

  const handleTabChange = (svc: ServiceType) => {
    setActiveService(svc);
    setResult(null);
    const presetMeta = presets?.[svc];
    if (presetMeta) {
      setQuery(presetMeta.placeholder);
    }
    const matchingSession = sessions.find(
      (s) => s.status === "ACTIVE" && (s.service || "s3") === svc
    );
    if (matchingSession) {
      setSelectedId(matchingSession.session_id);
    }
  };

  const servicePresets = presets?.[activeService];
  const orderedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aMatch =
        a.status === "ACTIVE" && (a.service || "s3") === activeService ? 0 : 1;
      const bMatch =
        b.status === "ACTIVE" && (b.service || "s3") === activeService ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [sessions, activeService]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.runSessionScopeTest(selectedId, {
        service: activeService,
        query: query.trim(),
        use_lab_sample: activeService === "s3" ? useLabSample : true,
      });
      setResult({
        ok: true,
        title: res.summary,
        payload: res,
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "ACCESS DENIED // BOUNDARY ENFORCED",
        error: err instanceof Error ? err.message : "Request rejected",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR PORTAL // MULTI-SERVICE BOUNDARY LAB"
      title="Multi-Service Scope Tester"
      description="Test positive (ALLOW) and negative (DENY) session boundaries across S3, DynamoDB, CloudWatch Logs, and SSM Parameter Store."
      onRefresh={() => void loadData()}
    >
      {/* Service Tabs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERVICE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={`font-mono-tech flex items-center justify-center gap-2 border px-3 py-2.5 text-xs font-bold uppercase transition ${
              activeService === tab.id
                ? "border-[var(--text-main)] bg-[var(--accent-volt)] text-[var(--accent-volt-ink)]"
                : "border-[var(--border-hair)] bg-[var(--bg-panel)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-main)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <ReticleCard
          className="lg:col-span-6"
          tag={`TESTBENCH // ${activeService.toUpperCase()}`}
          title={`Verify ${servicePresets?.label || activeService} Scope`}
          subtitle={
            activeService === "s3"
              ? "Supports live AWS S3 reads or safe Lab Sample previews."
              : "LAB SANDBOX responder enforcing real backend session service & scope checks."
          }
          action={<ServiceBadge service={activeService} />}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="session-select"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Session Under Test
              </label>
              <select
                id="session-select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              >
                <option value="">-- Select a session --</option>
                {orderedSessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {(s.service || "s3").toUpperCase()} · {s.session_id.slice(0, 8)} ·{" "}
                    {s.prefix} · {s.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="scope-query"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Target Scope / Resource Path
              </label>
              <input
                id="scope-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={servicePresets?.placeholder || ""}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            {activeService === "s3" && (
              <label className="flex cursor-pointer items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={useLabSample}
                  onChange={(e) => setUseLabSample(e.target.checked)}
                  className="accent-[var(--accent-cyan)]"
                />
                <span className="font-mono-tech text-[11px]">
                  USE LAB SANDBOX SAMPLE (SKIP LIVE AWS S3 CALL)
                </span>
              </label>
            )}

            {servicePresets && (
              <div className="space-y-2">
                <div className="font-mono-tech text-[10px] font-semibold text-[var(--text-muted)] uppercase">
                  ONE-CLICK BOUNDARY PRESETS
                </div>
                <div className="flex flex-wrap gap-2">
                  {servicePresets.allow_presets.map((p) => (
                    <button
                      key={p.query}
                      type="button"
                      onClick={() => setQuery(p.query)}
                      className="font-mono-tech border border-[var(--accent-green)]/40 bg-[var(--accent-green-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-green)]"
                    >
                      {p.label}
                    </button>
                  ))}
                  {servicePresets.deny_presets.map((p) => (
                    <button
                      key={p.query}
                      type="button"
                      onClick={() => setQuery(p.query)}
                      className="font-mono-tech border border-[var(--accent-red)]/40 bg-[var(--accent-red-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-red)]"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !selectedId}
              className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
              {busy ? "EXECUTING TEST..." : `RUN ${activeService.toUpperCase()} TEST`}
            </button>
          </form>
        </ReticleCard>

        <ReticleCard
          className="lg:col-span-6"
          tag="RESPONSE TELEMETRY"
          title="Authorization Output"
          subtitle="Compare authorized payloads vs enforced 403 boundaries."
          action={
            result?.payload?.simulated ? (
              <span className="font-mono-tech border border-[var(--accent-amber)]/50 bg-[var(--accent-amber-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-amber)] uppercase">
                LAB SANDBOX DATA
              </span>
            ) : result?.ok ? (
              <span className="font-mono-tech border border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-green)] uppercase">
                LIVE AWS RESPONSE
              </span>
            ) : undefined
          }
        >
          {!result ? (
            <NoticeBanner
              message="Pick a service tab, choose a session, and execute a scope test."
              tone="info"
            />
          ) : !result.ok ? (
            <div className="space-y-3">
              <div className="font-mono-tech flex items-center gap-2 border border-[var(--accent-red)]/50 bg-[var(--accent-red-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-red)]">
                <ShieldAlert className="h-4 w-4" />
                {result.title}
              </div>
              <pre className="font-mono-tech overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-4 text-xs text-[#fca5a5]">
                {result.error}
              </pre>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="font-mono-tech flex items-center gap-2 border border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] px-3 py-2 text-xs font-bold text-[var(--accent-green)]">
                <ShieldCheck className="h-4 w-4" />
                {result.title}
              </div>

              {result.payload?.content && (
                <pre className="font-mono-tech max-h-72 overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-4 text-xs leading-relaxed text-[#d7e6f5]">
                  {result.payload.content}
                </pre>
              )}

              {result.payload?.rows && (
                <div className="overflow-x-auto border border-[var(--border-hair)]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="font-mono-tech border-b border-[var(--border-hair)] bg-[var(--bg-elevated)] text-[10px] uppercase">
                        <th className="px-2.5 py-2">Session ID</th>
                        <th className="px-2.5 py-2">Service</th>
                        <th className="px-2.5 py-2">Scope</th>
                        <th className="px-2.5 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.payload.rows.map((row, idx) => (
                        <tr
                          key={idx}
                          className="font-mono-tech border-b border-[var(--border-hair)]/60 text-[11px]"
                        >
                          <td className="px-2.5 py-2 text-[var(--accent-cyan)]">
                            {String(row.session_id || "").slice(0, 12)}
                          </td>
                          <td className="px-2.5 py-2">{String(row.service || "")}</td>
                          <td className="px-2.5 py-2">{String(row.prefix || "")}</td>
                          <td className="px-2.5 py-2">{String(row.status || "")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.payload?.events && (
                <div className="space-y-2 border border-[var(--border-hair)] bg-[#0b0f16] p-3">
                  {result.payload.events.map((ev, idx) => (
                    <div
                      key={idx}
                      className="font-mono-tech border-b border-white/10 pb-1.5 text-[11px] text-[#d7e6f5] last:border-b-0"
                    >
                      <span className="text-[var(--accent-cyan)]">
                        [{ev.level}] {ev.stream}
                      </span>{" "}
                      — {ev.message}
                    </div>
                  ))}
                </div>
              )}

              {result.payload?.parameters && (
                <div className="overflow-x-auto border border-[var(--border-hair)]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="font-mono-tech border-b border-[var(--border-hair)] bg-[var(--bg-elevated)] text-[10px] uppercase">
                        <th className="px-2.5 py-2">Parameter</th>
                        <th className="px-2.5 py-2">Type</th>
                        <th className="px-2.5 py-2">Value</th>
                        <th className="px-2.5 py-2">Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.payload.parameters.map((param) => (
                        <tr
                          key={param.name}
                          className="font-mono-tech border-b border-[var(--border-hair)]/60 text-[11px]"
                        >
                          <td className="px-2.5 py-2 text-[var(--accent-cyan)]">
                            {param.name}
                          </td>
                          <td className="px-2.5 py-2">{param.type}</td>
                          <td className="px-2.5 py-2">{param.value}</td>
                          <td className="px-2.5 py-2">v{param.version}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
