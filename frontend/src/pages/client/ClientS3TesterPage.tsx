import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Play, ShieldAlert, ShieldCheck } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import { NoticeBanner, ReticleCard } from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AccessSessionItem } from "../../types/api";

export function ClientS3TesterPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [key, setKey] = useState("logs/sample.log");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    title: string;
    body: string;
  } | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
      if (!selectedId && res.sessions.length > 0) {
        setSelectedId(res.sessions[0].session_id);
      }
    } catch {
      // Handled via empty list
    }
  }, [selectedId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const runRead = async (targetKey: string) => {
    if (!selectedId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.readSessionObject(selectedId, targetKey);
      setResult({
        ok: true,
        title: `200 OK // OBJECT READ AUTHORIZED (${res.key})`,
        body: res.content,
      });
    } catch (err) {
      setResult({
        ok: false,
        title: "ACCESS DENIED // BOUNDARY ENFORCED",
        body: err instanceof Error ? err.message : "Request rejected",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await runRead(key.trim());
  };

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR PORTAL // BOUNDARY VERIFICATION"
      title="S3 Scope Tester"
      description="Verify positive and negative authorization boundaries through an active session's proxied object path."
      onRefresh={loadSessions}
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <ReticleCard
          className="lg:col-span-6"
          tag="PROXIED S3 TESTBENCH"
          title="Execute Scoped Read"
          subtitle="Tests session active state, prefix bounds, and key traversal checks."
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="session-select"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Active Session
              </label>
              <select
                id="session-select"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              >
                <option value="">-- Select a session --</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>
                    {s.session_id.slice(0, 8)} · {s.prefix} · {s.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="object-key"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                S3 Object Key
              </label>
              <input
                id="object-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setKey("logs/sample.log")}
                className="font-mono-tech border border-[var(--accent-green)]/40 bg-[var(--accent-green-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-green)]"
              >
                PRESET: logs/sample.log (ALLOW)
              </button>
              <button
                type="button"
                onClick={() => setKey("restricted/secret.txt")}
                className="font-mono-tech border border-[var(--accent-red)]/40 bg-[var(--accent-red-soft)] px-2.5 py-1 text-[11px] text-[var(--accent-red)]"
              >
                PRESET: restricted/secret.txt (DENY)
              </button>
            </div>

            <button
              type="submit"
              disabled={busy || !selectedId}
              className="endfield-chamfer font-mono-tech flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
              {busy ? "QUERYING S3..." : "RUN OBJECT READ"}
            </button>
          </form>
        </ReticleCard>

        <ReticleCard
          className="lg:col-span-6"
          tag="RESPONSE TELEMETRY"
          title="Authorization Output"
          subtitle="Observe allowed content vs enforced 403 boundary."
        >
          {!result ? (
            <NoticeBanner
              message="Select a session and run a read test to inspect enforcement behavior."
              tone="info"
            />
          ) : (
            <div className="space-y-3">
              <div
                className={`flex items-center gap-2 border px-3 py-2 font-mono-tech text-xs font-bold ${
                  result.ok
                    ? "border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] text-[var(--accent-green)]"
                    : "border-[var(--accent-red)]/50 bg-[var(--accent-red-soft)] text-[var(--accent-red)]"
                }`}
              >
                {result.ok ? (
                  <ShieldCheck className="h-4 w-4" />
                ) : (
                  <ShieldAlert className="h-4 w-4" />
                )}
                {result.title}
              </div>
              <pre className="font-mono-tech max-h-72 overflow-auto border border-[var(--border-hair)] bg-[#0b0f16] p-4 text-xs leading-relaxed text-[#d7e6f5]">
                {result.body}
              </pre>
            </div>
          )}
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
