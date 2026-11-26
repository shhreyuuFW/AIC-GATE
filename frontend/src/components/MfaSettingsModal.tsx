import { useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, ShieldOff, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { NoticeBanner } from "./TacticalUI";

export function MfaSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, applySessionToken } = useAuth();
  const [setupData, setSetupData] = useState<{
    secret: string;
    otpauth_uri: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  if (!user) return null;

  const handleStartSetup = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.setupMfa();
      setSetupData(res);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to start MFA setup",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.enableMfa(otpCode.trim());
      applySessionToken(res.access_token, res.user);
      setSetupData(null);
      setOtpCode("");
      setNotice({
        message: "TOTP 2FA ENABLED FOR YOUR ACCOUNT",
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Invalid authenticator code",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.disableMfa(password);
      applySessionToken(res.access_token, res.user);
      setPassword("");
      setNotice({
        message: "OPTIONAL 2FA DISABLED",
        tone: "info",
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to disable MFA",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
      <div className="endfield-panel relative w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border-hair)] pb-3">
          <div>
            <p className="font-mono-tech text-[10px] font-semibold tracking-widest text-[var(--accent-cyan)] uppercase">
              ACCOUNT SECURITY // RFC 6238 TOTP
            </p>
            <h2 className="text-lg font-bold">Optional Two-Factor Auth</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-[var(--border-hair)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {notice && (
          <div className="mb-4">
            <NoticeBanner
              message={notice.message}
              tone={notice.tone}
              onDismiss={() => setNotice(null)}
            />
          </div>
        )}

        {user.mfa_enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 border border-[var(--accent-green)]/40 bg-[var(--accent-green-soft)] p-3 text-xs">
              <ShieldCheck className="h-4 w-4 text-[var(--accent-green)]" />
              <span>
                TOTP MFA is currently <strong>ACTIVE</strong> on{" "}
                <code className="font-mono-tech">{user.username}</code>.
              </span>
            </div>

            <form onSubmit={handleDisable} className="space-y-3">
              <label
                htmlFor="disable-mfa-pw"
                className="font-mono-tech block text-[11px] font-semibold uppercase"
              >
                Confirm Password to Disable 2FA
              </label>
              <input
                id="disable-mfa-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
              <button
                type="submit"
                disabled={busy}
                className="font-mono-tech inline-flex w-full items-center justify-center gap-2 border border-[var(--accent-red)]/50 px-4 py-2 text-xs font-semibold text-[var(--accent-red)] uppercase hover:bg-[var(--accent-red-soft)]"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {busy ? "UPDATING..." : "DISABLE 2FA"}
              </button>
            </form>
          </div>
        ) : !setupData ? (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              Add an extra layer of protection with Google Authenticator, Authy,
              or Microsoft Authenticator. MFA is optional for both Operators and
              Commanders.
            </p>
            <button
              type="button"
              onClick={handleStartSetup}
              disabled={busy}
              className="endfield-chamfer-sm font-mono-tech w-full bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
            >
              {busy ? "GENERATING SECRET..." : "ENROLL AUTHENTICATOR APP"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleEnable} className="space-y-4">
            <div className="flex flex-col items-center gap-3 border border-[var(--border-hair)] bg-white p-4">
              <QRCodeSVG value={setupData.otpauth_uri} size={156} />
              <div className="font-mono-tech text-center text-[10px] text-[#0f1217]">
                MANUAL KEY: <strong>{setupData.secret}</strong>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-otp"
                className="font-mono-tech mb-1 block text-[11px] font-semibold uppercase"
              >
                Enter 6-Digit Code to Activate
              </label>
              <input
                id="confirm-otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-center text-sm tracking-[0.35em] outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="endfield-chamfer-sm font-mono-tech w-full bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase"
            >
              {busy ? "VERIFYING..." : "CONFIRM & ENABLE 2FA"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
