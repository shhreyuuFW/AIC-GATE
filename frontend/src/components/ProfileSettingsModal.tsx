import { useState, type ChangeEvent, type FormEvent } from "react";
import { Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  AVATAR_PRESETS,
  NoticeBanner,
  RoleBadge,
  UserAvatar,
} from "./TacticalUI";

async function resizeImageToDataUri(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Invalid image file"));
    image.src = dataUrl;
  });

  const maxSide = 128;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png", 0.9);
}

export function ProfileSettingsModal({ onClose }: { onClose: () => void }) {
  const { user, applySessionToken } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatar, setAvatar] = useState(user?.avatar || "preset:terminal");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);

  if (!user) return null;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice({
        message: "Only PNG, JPEG, or WEBP images are supported.",
        tone: "error",
      });
      return;
    }
    try {
      const resized = await resizeImageToDataUri(file);
      setAvatar(resized);
      setNotice(null);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to process image",
        tone: "error",
      });
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.updateProfile({
        display_name: displayName,
        bio,
        avatar,
      });
      applySessionToken(res.access_token, res.user);
      setNotice({
        message: "PROFILE SYNCHRONIZED",
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to update profile",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
      <div className="endfield-panel relative w-full max-w-lg p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 border border-[var(--border-hair)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="font-mono-tech text-[10px] font-semibold tracking-[0.18em] text-[var(--accent-cyan)] uppercase">
          IDENTITY // PROFILE CONFIGURATION
        </p>
        <h3 className="mt-1 text-lg font-bold">Account Profile</h3>

        {notice && (
          <div className="mt-3">
            <NoticeBanner
              message={notice.message}
              tone={notice.tone}
              onDismiss={() => setNotice(null)}
            />
          </div>
        )}

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="flex items-center gap-4 border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
            <UserAvatar
              avatar={avatar}
              displayName={displayName || user.display_name}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">
                {displayName || user.display_name}
              </div>
              <div className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                @{user.username} · {user.org_name}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <RoleBadge
                  label={user.effective_role}
                  color={user.custom_role_color}
                />
                <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                  Role managed by Organization Admin
                </span>
              </div>
            </div>
          </div>

          <div>
            <label className="font-mono-tech mb-1.5 block text-[10px] font-semibold uppercase">
              Avatar Preset or Custom Image
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {AVATAR_PRESETS.map((p) => {
                const token = `preset:${p.id}`;
                const active = avatar === token;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAvatar(token)}
                    title={p.label}
                    className={`border p-1 transition ${
                      active
                        ? "border-[var(--accent-cyan)] bg-[var(--accent-cyan-soft)]"
                        : "border-[var(--border-hair)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <UserAvatar
                      avatar={token}
                      displayName={displayName}
                      size="sm"
                    />
                  </button>
                );
              })}

              <label className="font-mono-tech inline-flex cursor-pointer items-center gap-1.5 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[10px] font-semibold uppercase hover:border-[var(--accent-cyan)]">
                <Upload className="h-3.5 w-3.5" />
                UPLOAD
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div>
            <label className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase">
              Display Name
            </label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              required
              className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="font-mono-tech text-[10px] font-semibold uppercase">
                Bio / Operational Focus
              </label>
              <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                {bio.length}/240
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={240}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Cloud engineering focus, on-call scope, or team notes..."
              className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="font-mono-tech border border-[var(--border-hair)] px-4 py-2 text-xs uppercase"
            >
              CLOSE
            </button>
            <button
              type="submit"
              disabled={busy}
              className="endfield-chamfer-sm font-mono-tech bg-[var(--accent-volt)] px-5 py-2 text-xs font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
            >
              {busy ? "SAVING..." : "SAVE PROFILE"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
