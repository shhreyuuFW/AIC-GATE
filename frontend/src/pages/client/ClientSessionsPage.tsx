import { useCallback, useEffect, useState } from "react";
import { Ban, KeyRound } from "lucide-react";
import { PortalLayout } from "../../components/PortalLayout";
import {
  CountdownBar,
  CredentialVault,
  NoticeBanner,
  ReticleCard,
  StatusBadge,
} from "../../components/TacticalUI";
import { api } from "../../lib/api";
import type { AccessSessionItem, TemporaryCredentials } from "../../types/api";

export function ClientSessionsPage() {
  const [sessions, setSessions] = useState<AccessSessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeCreds, setActiveCreds] = useState<{
    sessionId: string;
    creds: TemporaryCredentials;
  } | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listSessions();
      setSessions(res.sessions);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Unable to load sessions",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleMintCredentials = async (sessionId: string) => {
    setBusyId(sessionId);
    setNotice(null);
    try {
      const creds = await api.issueCredentials(sessionId);
      setActiveCreds({ sessionId, creds });
      setNotice({
        message: `STS CREDENTIALS ISSUED FOR SESSION ${sessionId.slice(0, 8)}`,
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to issue credentials",
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (sessionId: string) => {
    if (
      !window.confirm(
        "Revoke this session in AIC-GATE? New credential minting and proxied reads will stop immediately, while already-issued STS credentials expire at their AWS TTL."
      )
    ) {
      return;
    }

    setBusyId(sessionId);
    setNotice(null);
    try {
      await api.revokeSession(sessionId);
      setNotice({
        message: `SESSION ${sessionId.slice(0, 8)} MARKED REVOKED`,
        tone: "info",
      });
      await loadSessions();
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Revocation failed",
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PortalLayout
      portal="client"
      eyebrow="OPERATOR PORTAL // ACTIVE GRANTS"
      title="My Sessions & Temporary Keys"
      description="Inspect provisioned STS sessions, mint credentials within the remaining window, or revoke active sessions."
      onRefresh={loadSessions}
    >
      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      {activeCreds && (
        <ReticleCard
          tag="EPHEMERAL VAULT // DO NOT SHARE"
          title={`Credentials for Session ${activeCreds.sessionId.slice(0, 8)}…`}
          action={
            <button
              type="button"
              onClick={() => setActiveCreds(null)}
              className="font-mono-tech border border-[var(--border-hair)] px-2.5 py-1 text-[11px] hover:border-[var(--border-strong)]"
            >
              CLEAR FROM VIEW
            </button>
          }
        >
          <CredentialVault credentials={activeCreds.creds} />
        </ReticleCard>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {loading ? (
          <ReticleCard>
            <p className="font-mono-tech text-xs text-[var(--text-muted)]">
              SYNCING SESSIONS FROM DYNAMODB...
            </p>
          </ReticleCard>
        ) : sessions.length === 0 ? (
          <ReticleCard className="md:col-span-2">
            <p className="font-mono-tech text-xs text-[var(--text-muted)]">
              NO SESSIONS PROVISIONED YET. SUBMIT A REQUEST AND WAIT FOR
              COMMANDER APPROVAL.
            </p>
          </ReticleCard>
        ) : (
          sessions.map((session) => (
            <ReticleCard
              key={session.session_id}
              tag={`SESSION // ${session.session_id.slice(0, 8)}`}
              title={`${session.bucket}/${session.prefix}`}
              action={<StatusBadge status={session.status} />}
            >
              <div className="space-y-4">
                <div className="font-mono-tech grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[var(--text-muted)]">ACTIONS: </span>
                    <span>{session.actions.join(", ")}</span>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">EXPIRES: </span>
                    <span>
                      {new Date(session.expires_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                <CountdownBar
                  createdAt={session.created_at}
                  expiresAt={session.expires_at}
                  status={session.status}
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={
                      session.status !== "ACTIVE" || busyId === session.session_id
                    }
                    onClick={() => handleMintCredentials(session.session_id)}
                    className="endfield-chamfer-sm font-mono-tech inline-flex flex-1 items-center justify-center gap-1.5 bg-[var(--accent-volt)] px-3 py-2 text-[11px] font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    MINT STS KEYS
                  </button>
                  <button
                    type="button"
                    disabled={
                      session.status !== "ACTIVE" || busyId === session.session_id
                    }
                    onClick={() => handleRevoke(session.session_id)}
                    className="font-mono-tech inline-flex items-center justify-center gap-1.5 border border-[var(--accent-red)]/50 px-3 py-2 text-[11px] font-semibold text-[var(--accent-red)] uppercase hover:bg-[var(--accent-red-soft)] disabled:opacity-40"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    REVOKE
                  </button>
                </div>
              </div>
            </ReticleCard>
          ))
        )}
      </div>
    </PortalLayout>
  );
}
