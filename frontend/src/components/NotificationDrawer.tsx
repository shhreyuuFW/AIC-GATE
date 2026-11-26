import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Clock, Radio, X } from "lucide-react";
import { api } from "../lib/api";
import { useAutoSync } from "../hooks/useAutoSync";
import type {
  NotificationAwaySummary,
  NotificationItem,
} from "../types/api";

export function NotificationBellAndDrawer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [awaySummary, setAwaySummary] =
    useState<NotificationAwaySummary | null>(null);
  const [liveToast, setLiveToast] = useState<NotificationItem | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadedRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setItems(res.notifications);
      setUnreadCount(res.unread_count);
      setAwaySummary(res.away_summary);

      const unread = res.notifications.filter((n) => !n.read);
      if (initialLoadedRef.current) {
        const brandNew = unread.find(
          (n) => !seenIdsRef.current.has(n.notification_id)
        );
        if (brandNew) {
          setLiveToast(brandNew);
          window.setTimeout(() => {
            setLiveToast((curr) =>
              curr?.notification_id === brandNew.notification_id ? null : curr
            );
          }, 5500);
        }
      }
      initialLoadedRef.current = true;
      for (const n of res.notifications) {
        seenIdsRef.current.add(n.notification_id);
      }
    } catch {
      // Silent background notification sync
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useAutoSync(loadNotifications, 8000);

  // Synchronize React `open` state with native browser Top-Layer <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleMarkAll = async () => {
    try {
      await api.markNotificationsRead({ mark_all: true });
      await loadNotifications();
    } catch {
      // Ignore
    }
  };

  const handleOpenItem = async (notif: NotificationItem) => {
    try {
      if (!notif.read) {
        await api.markNotificationsRead({
          notification_id: notif.notification_id,
        });
        await loadNotifications();
      }
    } catch {
      // Ignore
    }
    setOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  const portalLayers =
    typeof document !== "undefined"
      ? createPortal(
          <>
            {/* Live non-intrusive toast while online */}
            <AnimatePresence>
              {liveToast && !open && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  style={{
                    position: "fixed",
                    right: 20,
                    bottom: 20,
                    zIndex: 2147483640,
                    backgroundColor: "var(--bg-panel)",
                  }}
                  className="endfield-panel w-80 border-[var(--accent-cyan)] p-3.5 shadow-xl"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-tech flex items-center gap-1.5 text-[10px] font-bold text-[var(--accent-cyan)] uppercase">
                        <Radio className="h-3 w-3 animate-pulse" />
                        LIVE ALERT // {liveToast.title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-main)]">
                        {liveToast.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLiveToast(null)}
                      className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2.5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLiveToast(null);
                        void handleOpenItem(liveToast);
                      }}
                      className="font-mono-tech bg-[var(--accent-volt)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent-volt-ink)] uppercase"
                    >
                      INSPECT
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Native Top-Layer <dialog> Alert Drawer — cannot be overlapped */}
            <dialog
              ref={dialogRef}
              onClose={() => setOpen(false)}
              onCancel={(e) => {
                e.preventDefault();
                setOpen(false);
              }}
              onClick={(e) => {
                if (e.target === dialogRef.current) {
                  setOpen(false);
                }
              }}
              aria-label="Workspace Alerts"
              className="aic-alert-dialog"
            >
              {/* Grid Row 1: Header */}
              <div className="flex items-center justify-between border-b border-[var(--border-hair)] px-5 py-4">
                <div>
                  <p className="font-mono-tech text-[10px] font-semibold tracking-[0.18em] text-[var(--accent-cyan)] uppercase">
                    TELEMETRY // WORKSPACE ALERTS
                  </p>
                  <h3 className="mt-0.5 text-base font-bold">
                    Notifications ({unreadCount} unread)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAll}
                      className="font-mono-tech inline-flex items-center gap-1 border border-[var(--border-hair)] px-2.5 py-1 text-[10px] font-semibold uppercase hover:border-[var(--accent-cyan)]"
                    >
                      <CheckCheck className="h-3 w-3" />
                      MARK ALL READ
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close drawer"
                    className="border border-[var(--border-hair)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Grid Row 2: Away / Live Summary Banner */}
              {awaySummary ? (
                <div
                  className={`border-b border-[var(--border-hair)] px-5 py-3 text-xs ${
                    awaySummary.variant === "away"
                      ? "bg-[var(--accent-amber-soft)]"
                      : "bg-[var(--accent-cyan-soft)]"
                  }`}
                >
                  <div className="font-mono-tech flex items-center gap-1.5 text-[11px] font-bold uppercase">
                    {awaySummary.variant === "away" ? (
                      <Clock className="h-3.5 w-3.5 text-[var(--accent-amber)]" />
                    ) : (
                      <Radio className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
                    )}
                    {awaySummary.headline}
                  </div>
                  <p className="mt-1 text-[var(--text-main)]">
                    {awaySummary.detail}
                  </p>
                </div>
              ) : (
                <div />
              )}

              {/* Grid Row 3: Scrollable Notifications List */}
              <div className="min-h-0 space-y-2 overflow-y-auto p-4">
                {items.length === 0 ? (
                  <p className="font-mono-tech py-10 text-center text-xs text-[var(--text-muted)]">
                    NO WORKSPACE NOTIFICATIONS YET.
                  </p>
                ) : (
                  items.map((notif) => (
                    <button
                      key={notif.notification_id}
                      type="button"
                      onClick={() => void handleOpenItem(notif)}
                      className={`w-full border p-3 text-left transition ${
                        notif.read
                          ? "border-[var(--border-hair)] bg-[var(--bg-elevated)]/60 opacity-70 hover:opacity-100"
                          : "border-[var(--accent-cyan)]/60 bg-[var(--bg-elevated)] hover:border-[var(--accent-cyan)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-tech text-[10px] font-bold text-[var(--accent-cyan)] uppercase">
                          {notif.title}
                        </span>
                        <span className="font-mono-tech text-[10px] text-[var(--text-muted)]">
                          {new Date(notif.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-main)]">
                        {notif.message}
                      </p>
                      {!notif.read && (
                        <span className="font-mono-tech mt-1.5 inline-block text-[9px] font-bold text-[var(--accent-amber)] uppercase">
                          ● UNREAD
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </dialog>
          </>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open notifications"
        className="font-mono-tech relative inline-flex items-center gap-2 border border-[var(--border-hair)] bg-[var(--bg-panel)] px-3 py-2 text-xs font-semibold hover:border-[var(--border-strong)]"
      >
        <Bell className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
        <span className="hidden sm:inline">ALERTS</span>
        {unreadCount > 0 && (
          <span className="bg-[var(--accent-amber)] px-1.5 py-0.5 text-[10px] font-bold text-black">
            {unreadCount}
          </span>
        )}
      </button>
      {portalLayers}
    </>
  );
}
