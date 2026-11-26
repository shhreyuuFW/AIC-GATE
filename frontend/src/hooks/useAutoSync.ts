import { useEffect, useRef } from "react";

/**
 * Visibility-aware background synchronization hook.
 * Polls while the browser tab is visible, refreshes immediately on tab focus,
 * and skips overlapping invocations.
 */
export function useAutoSync(
  callback: () => Promise<void> | void,
  intervalMs = 10000,
  enabled = true
): void {
  const savedCallback = useRef(callback);
  const runningRef = useRef(false);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    const runSync = async () => {
      if (document.visibilityState !== "visible" || runningRef.current) {
        return;
      }
      runningRef.current = true;
      try {
        await savedCallback.current();
      } catch {
        // Silent background refresh
      } finally {
        runningRef.current = false;
      }
    };

    const timerId = window.setInterval(() => {
      void runSync();
    }, intervalMs);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timerId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intervalMs, enabled]);
}
