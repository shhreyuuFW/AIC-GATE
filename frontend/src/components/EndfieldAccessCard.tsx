import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { Expand, Shield, ShieldCheck } from "lucide-react";
import type { AdminTier, UserRole } from "../types/api";
import { RoleBadge, UserAvatar } from "./TacticalUI";

export interface EndfieldAccessCardProps {
  userId: string;
  username: string;
  displayName: string;
  orgName: string;
  department: string;
  bio: string;
  avatar: string;
  effectiveRole: string;
  roleColor: string;
  role: UserRole;
  adminTier: AdminTier;
  mfaEnabled: boolean;
  lastLoginAt?: string | null;
  size?: "card" | "showcase";
  onExpand?: () => void;
}

function clearanceBadge(role: UserRole, tier: AdminTier): string {
  if (role === "platform_admin" || tier === "master") return "LVL-05 // MASTER";
  if (role === "admin" && tier === "owner") return "LVL-04 // ORG OWNER";
  if (role === "admin") return "LVL-03 // DELEGATED ADMIN";
  return "LVL-01 // OPERATOR";
}

function deterministicBarcodeWidths(seed: string): number[] {
  const widths: number[] = [];
  let acc = 17;
  for (let i = 0; i < seed.length; i += 1) {
    acc = (acc * 31 + seed.charCodeAt(i)) % 997;
  }
  for (let i = 0; i < 28; i += 1) {
    acc = (acc * 73 + i * 19 + 7) % 101;
    widths.push((acc % 3) + 1);
  }
  return widths;
}

export function EndfieldAccessCard({
  userId,
  username,
  displayName,
  orgName,
  department,
  bio,
  avatar,
  effectiveRole,
  roleColor,
  role,
  adminTier,
  mfaEnabled,
  lastLoginAt,
  size = "card",
  onExpand,
}: EndfieldAccessCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prefersReduced = useReducedMotion();

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const springCfg = { stiffness: 170, damping: 22, mass: 0.6 };
  const smoothX = useSpring(rawX, springCfg);
  const smoothY = useSpring(rawY, springCfg);

  const rotateX = useTransform(
    smoothY,
    [-1, 1],
    prefersReduced ? [0, 0] : [8, -8]
  );
  const rotateY = useTransform(
    smoothX,
    [-1, 1],
    prefersReduced ? [0, 0] : [-10, 10]
  );

  // Opposite-direction parallax background layer & subtle forward foreground shift
  const bgX = useTransform(
    smoothX,
    [-1, 1],
    prefersReduced ? [0, 0] : [14, -14]
  );
  const bgY = useTransform(
    smoothY,
    [-1, 1],
    prefersReduced ? [0, 0] : [10, -10]
  );
  const fgX = useTransform(
    smoothX,
    [-1, 1],
    prefersReduced ? [0, 0] : [-6, 6]
  );
  const fgY = useTransform(
    smoothY,
    [-1, 1],
    prefersReduced ? [0, 0] : [-5, 5]
  );

  const glareX = useTransform(smoothX, [-1, 1], [15, 85]);
  const glareY = useTransform(smoothY, [-1, 1], [15, 85]);
  const glareBackground = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgba(229, 255, 0, 0.14), rgba(0, 212, 255, 0.08) 38%, transparent 72%)`;

  useEffect(() => {
    if (size !== "showcase") return;
    const onWinMove = (e: globalThis.MouseEvent) => {
      const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
      rawX.set(Math.max(-1, Math.min(1, nx)));
      rawY.set(Math.max(-1, Math.min(1, ny)));
    };
    window.addEventListener("mousemove", onWinMove);
    return () => window.removeEventListener("mousemove", onWinMove);
  }, [size, rawX, rawY]);

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (size === "showcase" || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
    rawX.set(Math.max(-1, Math.min(1, nx)));
    rawY.set(Math.max(-1, Math.min(1, ny)));
  };

  const handleMouseLeave = () => {
    if (size === "showcase") return;
    rawX.set(0);
    rawY.set(0);
  };

  const barcode = useMemo(() => deterministicBarcodeWidths(userId), [userId]);
  const isShowcase = size === "showcase";

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ perspective: "1200px" }}
      className={isShowcase ? "w-full max-w-3xl" : "w-full"}
    >
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        className={`endfield-chamfer relative overflow-hidden border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl ${
          isShowcase ? "p-8 sm:p-10" : "p-5 sm:p-6"
        }`}
      >
        {/* Parallax background grid + watermark layer */}
        <motion.div
          style={{ x: bgX, y: bgY }}
          className="pointer-events-none absolute -inset-6 opacity-40"
        >
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "radial-gradient(var(--grid-dot) 1px, transparent 1px), linear-gradient(to right, rgba(0, 212, 255, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 212, 255, 0.05) 1px, transparent 1px)",
              backgroundSize: "20px 20px, 80px 80px, 80px 80px",
            }}
          />
          <div className="font-mono-tech absolute right-6 bottom-6 text-5xl font-bold tracking-[0.2em] text-[var(--text-main)]/5 select-none">
            AIC-GATE
          </div>
        </motion.div>

        {/* Cursor holographic specular highlight */}
        <motion.div
          style={{ background: glareBackground }}
          className="pointer-events-none absolute inset-0"
        />

        {/* Chamfered corner reticles */}
        <span className="pointer-events-none absolute top-2 left-2 h-3 w-3 border-t-2 border-l-2 border-[var(--accent-volt)]" />
        <span className="pointer-events-none absolute top-2 right-2 h-3 w-3 border-t-2 border-r-2 border-[var(--accent-cyan)]" />
        <span className="pointer-events-none absolute bottom-2 left-2 h-3 w-3 border-b-2 border-l-2 border-[var(--accent-cyan)]" />
        <span className="pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r-2 border-b-2 border-[var(--accent-volt)]" />

        {/* Top Clearance Stripe */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-hair)] pb-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-block h-2.5 w-2.5 bg-[var(--accent-volt)]" />
            <span className="font-mono-tech text-[10px] font-bold tracking-[0.22em] text-[var(--accent-cyan)] uppercase">
              AIC-GATE // ENDFIELD ACCESS KEY CARD
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono-tech border border-[var(--accent-volt)]/60 bg-[var(--accent-volt)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-volt-ink)] uppercase">
              {clearanceBadge(role, adminTier)}
            </span>
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                title="Open Big-Screen Access Key Showcase"
                className="font-mono-tech inline-flex items-center gap-1 border border-[var(--border-hair)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
              >
                <Expand className="h-3 w-3 text-[var(--accent-cyan)]" />
                BIG SCREEN
              </button>
            )}
          </div>
        </div>

        {/* Main Identity Body (Foreground Parallax Layer) */}
        <motion.div
          style={{ x: fgX, y: fgY }}
          className={`relative z-10 mt-5 flex flex-col gap-5 sm:flex-row sm:items-center ${
            isShowcase ? "gap-8" : ""
          }`}
        >
          {/* 1:1 Ratio Portrait Frame */}
          <div
            className={`relative shrink-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--bg-elevated)] ${
              isShowcase ? "h-36 w-36" : "h-24 w-24"
            }`}
          >
            {avatar && avatar.startsWith("data:image/") ? (
              <img
                src={avatar}
                alt={displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <UserAvatar
                  avatar={avatar}
                  displayName={displayName}
                  size="lg"
                />
              </div>
            )}
            <span className="font-mono-tech absolute right-1 bottom-1 bg-black/75 px-1 text-[8px] font-bold text-[var(--accent-volt)]">
              1:1
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <h2
                className={`truncate font-bold tracking-tight ${
                  isShowcase ? "text-3xl" : "text-xl"
                }`}
              >
                {displayName}
              </h2>
              <p className="font-mono-tech text-xs text-[var(--text-muted)]">
                @{username} · {userId}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge label={effectiveRole} color={roleColor} />
              <span
                className={`font-mono-tech inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  mfaEnabled
                    ? "border-[var(--accent-green)]/50 bg-[var(--accent-green-soft)] text-[var(--accent-green)]"
                    : "border-[var(--border-hair)] bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                }`}
              >
                {mfaEnabled ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : (
                  <Shield className="h-3 w-3" />
                )}
                {mfaEnabled ? "TOTP 2FA VERIFIED" : "2FA OPTIONAL"}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {bio.trim() ||
                "No operational bio set yet. Add a short focus statement in your profile editor."}
            </p>
          </div>
        </motion.div>

        {/* Bottom Telemetry & Tactical Barcode Strip */}
        <div className="relative z-10 mt-6 grid gap-3 border-t border-[var(--border-hair)] pt-4 sm:grid-cols-12 sm:items-end">
          <div className="font-mono-tech space-y-1 text-[11px] sm:col-span-4">
            <div className="text-[9px] tracking-widest text-[var(--text-muted)] uppercase">
              ORGANIZATION
            </div>
            <div className="truncate font-bold text-[var(--text-main)]">
              {orgName}
            </div>
          </div>

          <div className="font-mono-tech space-y-1 text-[11px] sm:col-span-4">
            <div className="text-[9px] tracking-widest text-[var(--text-muted)] uppercase">
              DIVISION // LAST SYNC
            </div>
            <div className="truncate text-[var(--text-main)]">
              {department}
              {lastLoginAt &&
                ` · ${new Date(lastLoginAt).toLocaleDateString()}`}
            </div>
          </div>

          <div className="flex items-end justify-end gap-0.5 sm:col-span-4">
            <svg
              width="126"
              height="24"
              viewBox="0 0 126 24"
              aria-hidden="true"
              className="opacity-80"
            >
              {barcode.map((w, idx) => {
                const x = idx * 4.5;
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={idx % 5 === 0 ? 0 : 3}
                    width={w}
                    height={idx % 5 === 0 ? 24 : 18}
                    fill={idx % 7 === 0 ? "var(--accent-cyan)" : "var(--text-main)"}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
