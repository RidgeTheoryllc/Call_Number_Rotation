"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { isSameLocalCalendarDay, localDateKey } from "@/lib/callback-schedule";
import type { LeadRecord } from "@/types";

const POLL_MS = 120_000;
const STORAGE_NOTIF_DATE = "rt_callback_browser_notif_date";
const STORAGE_BANNER_DISMISS = "rt_callback_banner_dismiss_date";

export function CallbackReminderBar() {
  const [userId, setUserId] = useState<string | null>(null);
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const key = localDateKey();
    if (typeof window !== "undefined" && sessionStorage.getItem(STORAGE_BANNER_DISMISS) === key) {
      queueMicrotask(() => setBannerDismissed(true));
    }
  }, []);

  const fetchDueToday = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const uid = user?.id ?? null;
    setUserId(uid);
    if (!uid) {
      setDueTodayCount(0);
      return;
    }

    const res = await fetch(`/api/leads?user_id=${encodeURIComponent(uid)}`, { cache: "no-store" });
    if (!res.ok) return;
    const rows = (await res.json()) as LeadRecord[];
    const due = rows.filter((l) => l.callback_at && isSameLocalCalendarDay(l.callback_at));
    setDueTodayCount(due.length);

    const todayKey = localDateKey();
    const alreadyNotified = typeof window !== "undefined" && localStorage.getItem(STORAGE_NOTIF_DATE) === todayKey;

    if (due.length > 0 && typeof window !== "undefined" && "Notification" in window && !alreadyNotified) {
      if (Notification.permission === "granted") {
        const body =
          due.length === 1
            ? "1 lead has a callback scheduled today. Open Callbacks to dial when ready."
            : `${due.length} leads have callbacks scheduled today. Open Callbacks to dial when ready.`;
        try {
          new Notification("Callbacks scheduled today", { body, tag: "rt-callbacks-today" });
        } catch {
          /* ignore */
        }
        localStorage.setItem(STORAGE_NOTIF_DATE, todayKey);
      }
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchDueToday();
    });
    const id = window.setInterval(() => {
      queueMicrotask(() => {
        void fetchDueToday();
      });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        queueMicrotask(() => {
          void fetchDueToday();
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchDueToday]);

  const dismissBanner = () => {
    const key = localDateKey();
    sessionStorage.setItem(STORAGE_BANNER_DISMISS, key);
    setBannerDismissed(true);
  };

  if (!userId || dueTodayCount === 0 || bannerDismissed) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-950 md:text-left">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 sm:flex-row sm:items-center">
        <p className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            <svg className="h-4 w-4 shrink-0 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            You have{" "}
            <strong>
              {dueTodayCount} callback{dueTodayCount !== 1 ? "s" : ""}
            </strong>{" "}
            scheduled <strong>today</strong>. Open the Callbacks page to find them quickly.
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/callbacks"
            className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800"
          >
            View callbacks
          </Link>
          <button
            type="button"
            onClick={dismissBanner}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
          >
            Dismiss
          </button>
          {typeof Notification !== "undefined" && Notification.permission === "default" ? (
            <button
              type="button"
              onClick={async () => {
                const p = await Notification.requestPermission();
                if (p === "granted") {
                  localStorage.removeItem(STORAGE_NOTIF_DATE);
                  void fetchDueToday();
                }
              }}
              className="rounded-md border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-200"
            >
              Enable desktop alerts
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
