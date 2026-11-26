import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { Expand, Save, Shield, Upload, X } from "lucide-react";
import { AvatarCropper } from "../components/AvatarCropper";
import { EndfieldAccessCard } from "../components/EndfieldAccessCard";
import { MfaSettingsModal } from "../components/MfaSettingsModal";
import { PortalLayout } from "../components/PortalLayout";
import {
  AVATAR_PRESETS,
  NoticeBanner,
  ReticleCard,
  RoleBadge,
  UserAvatar,
} from "../components/TacticalUI";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

export function ProfilePage({
  portal,
}: {
  portal: "client" | "admin" | "master";
}) {
  const { user, applySessionToken, refreshUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatar, setAvatar] = useState(user?.avatar || "preset:terminal");
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [showShowcase, setShowShowcase] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    tone: "info" | "success" | "error";
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name);
    setBio(user.bio);
    setAvatar(user.avatar || "preset:terminal");
  }, [user?.user_id, user?.display_name, user?.bio, user?.avatar]);

  useEffect(() => {
    if (!showShowcase) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowShowcase(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [showShowcase]);

  if (!user) return null;

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice({
        message: "Only PNG, JPEG, or WEBP images are supported.",
        tone: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(String(reader.result || ""));
      setNotice(null);
    };
    reader.onerror = () => {
      setNotice({ message: "Unable to read selected image.", tone: "error" });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSaveProfile = async (e: FormEvent) => {
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
        message: "ACCESS KEY PROFILE SYNCHRONIZED",
        tone: "success",
      });
    } catch (err) {
      setNotice({
        message:
          err instanceof Error ? err.message : "Failed to save profile changes",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const showcaseOverlay =
    showShowcase && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => setShowShowcase(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9995 }}
            className="endfield-grid-bg flex flex-col justify-between bg-[var(--bg-canvas)]/95 p-6 backdrop-blur-sm sm:p-10"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="mx-auto flex w-full max-w-5xl items-center justify-between"
            >
              <div>
                <p className="font-mono-tech text-[10px] font-semibold tracking-[0.22em] text-[var(--accent-cyan)] uppercase">
                  ENDFIELD // FULLSCREEN ACCESS KEY INSPECTION
                </p>
                <p className="font-mono-tech text-[11px] text-[var(--text-muted)]">
                  MOVE CURSOR FOR PARALLAX DEPTH · PRESS [ESC] TO EXIT
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowShowcase(false)}
                className="font-mono-tech inline-flex items-center gap-2 border border-[var(--border-strong)] bg-[var(--bg-panel)] px-4 py-2 text-xs font-bold uppercase hover:border-[var(--accent-cyan)]"
              >
                <X className="h-4 w-4" />
                CLOSE (ESC)
              </button>
            </div>

            <div
              onClick={(e) => e.stopPropagation()}
              className="mx-auto flex w-full max-w-4xl flex-1 items-center justify-center py-6"
            >
              <EndfieldAccessCard
                size="showcase"
                userId={user.user_id}
                username={user.username}
                displayName={displayName || user.display_name}
                orgName={user.org_name || user.org_id}
                department={user.department}
                bio={bio}
                avatar={avatar}
                effectiveRole={user.effective_role}
                roleColor={user.custom_role_color}
                role={user.role}
                adminTier={user.admin_tier}
                mfaEnabled={user.mfa_enabled}
                lastLoginAt={user.last_login_at}
              />
            </div>

            <div className="font-mono-tech mx-auto flex w-full max-w-5xl items-center justify-between text-[10px] text-[var(--text-muted)]">
              <span>CLEARANCE NODE // {user.org_name}</span>
              <span>IDENTITY ID // {user.user_id}</span>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <PortalLayout
      portal={portal}
      eyebrow="IDENTITY // ENDFIELD ACCESS KEY CARD"
      title="Access Key Profile"
      description="Inspect your interactive Endfield access card, crop a 1:1 portrait, and manage profile details."
      onRefresh={() => void refreshUser()}
    >
      {showMfaModal && (
        <MfaSettingsModal onClose={() => setShowMfaModal(false)} />
      )}
      {showcaseOverlay}

      {notice && (
        <NoticeBanner
          message={notice.message}
          tone={notice.tone}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Live Parallax Access Key Card + Big Screen + Governance */}
        <div className="space-y-6 lg:col-span-7">
          <EndfieldAccessCard
            userId={user.user_id}
            username={user.username}
            displayName={displayName || user.display_name}
            orgName={user.org_name || user.org_id}
            department={user.department}
            bio={bio}
            avatar={avatar}
            effectiveRole={user.effective_role}
            roleColor={user.custom_role_color}
            role={user.role}
            adminTier={user.admin_tier}
            mfaEnabled={user.mfa_enabled}
            lastLoginAt={user.last_login_at}
            onExpand={() => setShowShowcase(true)}
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowShowcase(true)}
              className="endfield-chamfer-sm font-mono-tech inline-flex flex-1 items-center justify-center gap-2 bg-[var(--accent-volt)] px-4 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase hover:bg-[var(--accent-volt-hover)]"
            >
              <Expand className="h-4 w-4" />
              OPEN BIG-SCREEN ACCESS CARD
            </button>
            <button
              type="button"
              onClick={() => setShowMfaModal(true)}
              className="font-mono-tech inline-flex items-center justify-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-4 py-2.5 text-xs font-semibold uppercase hover:border-[var(--accent-cyan)]"
            >
              <Shield className="h-4 w-4 text-[var(--accent-cyan)]" />
              2FA SETTINGS ({user.mfa_enabled ? "ON" : "OPTIONAL"})
            </button>
          </div>

          <ReticleCard
            tag="GOVERNANCE ATTRIBUTES // READ-ONLY"
            title="Organization & Role Assignment"
            subtitle="Roles and tenant memberships are controlled strictly by Organization Administrators."
          >
            <div className="font-mono-tech grid gap-4 text-xs sm:grid-cols-2">
              <div className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
                <div className="text-[10px] text-[var(--text-muted)] uppercase">
                  ORGANIZATION
                </div>
                <div className="mt-1 font-bold text-[var(--text-main)]">
                  {user.org_name || user.org_id}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                  {user.department}
                </div>
              </div>
              <div className="border border-[var(--border-hair)] bg-[var(--bg-elevated)] p-3">
                <div className="text-[10px] text-[var(--text-muted)] uppercase">
                  ASSIGNED ROLE
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <RoleBadge
                    label={user.effective_role}
                    color={user.custom_role_color}
                  />
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Managed by Org Admin
                </div>
              </div>
            </div>
          </ReticleCard>
        </div>

        {/* Right: 1:1 Avatar Cropper & Profile Editor */}
        <ReticleCard
          className="lg:col-span-5"
          tag="PROFILE STUDIO // 1:1 PORTRAIT & BIO"
          title="Customize Identity"
          subtitle="Upload an image to crop cleanly at a locked 1:1 square ratio, or choose a tactical preset."
        >
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {cropSource ? (
              <AvatarCropper
                imageSrc={cropSource}
                onApply={(cropped) => {
                  setAvatar(cropped);
                  setCropSource(null);
                  setNotice({
                    message:
                      "1:1 AVATAR CROPPED — CLICK SAVE PROFILE TO PERSIST",
                    tone: "info",
                  });
                }}
                onCancel={() => setCropSource(null)}
              />
            ) : (
              <div>
                <label className="font-mono-tech mb-1.5 block text-[10px] font-semibold uppercase">
                  1:1 Portrait Preset or Custom Upload
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

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="font-mono-tech inline-flex items-center gap-1.5 border border-[var(--accent-cyan)]/50 bg-[var(--accent-cyan-soft)] px-2.5 py-1.5 text-[10px] font-bold text-[var(--accent-cyan)] uppercase hover:border-[var(--accent-cyan)]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    UPLOAD & CROP 1:1
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleFilePick}
                    className="hidden"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="profile-display-name"
                className="font-mono-tech mb-1 block text-[10px] font-semibold uppercase"
              >
                Display Name
              </label>
              <input
                id="profile-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                required
                className="font-mono-tech w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label
                  htmlFor="profile-bio"
                  className="font-mono-tech text-[10px] font-semibold uppercase"
                >
                  Bio / Operational Focus
                </label>
                <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                  {bio.length}/240
                </span>
              </div>
              <textarea
                id="profile-bio"
                rows={3}
                maxLength={240}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Cloud operations focus, on-call scope, or engineering notes..."
                className="w-full border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-3 py-2 text-xs outline-none focus:border-[var(--accent-cyan)]"
              />
            </div>

            <button
              type="submit"
              disabled={busy || Boolean(cropSource)}
              className="endfield-chamfer font-mono-tech inline-flex w-full items-center justify-center gap-2 bg-[var(--accent-volt)] px-5 py-2.5 text-xs font-bold text-[var(--accent-volt-ink)] uppercase disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />
              {busy ? "SAVING..." : "SAVE PROFILE"}
            </button>
          </form>
        </ReticleCard>
      </div>
    </PortalLayout>
  );
}
