"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { NotepadDrawer } from "@/components/notepad-drawer";

type NavGlyphId = "dashboard" | "didPool" | "leads" | "messages" | "callLogs";

function NavGlyph({ id }: { id: NavGlyphId }) {
  const cls = "h-5 w-5 shrink-0";
  switch (id) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "didPool":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <path d="M12 18h.01" />
          <path d="M9 6h6" />
        </svg>
      );
    case "leads":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "messages":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
        </svg>
      );
    case "callLogs":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cls} aria-hidden>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="16" y2="17" />
        </svg>
      );
    default:
      return null;
  }
}

const navItems: { href: string; label: string; glyph: NavGlyphId }[] = [
  { href: "/", label: "Dashboard", glyph: "dashboard" },
  { href: "/did-pool", label: "DID Pool", glyph: "didPool" },
  { href: "/leads", label: "Leads", glyph: "leads" },
  { href: "/messages", label: "Messages", glyph: "messages" },
  { href: "/call-logs", label: "Call Logs", glyph: "callLogs" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const loadSessionUser = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setIsUserLoading(false);
        return;
      }

      setUserEmail(data.session?.user?.email ?? null);
      setIsUserLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setIsUserLoading(false);
    });

    void loadSessionUser();

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleLogout = async () => {
    setIsSigningOut(true);
    const { error } = await supabase.auth.signOut();

    setIsSigningOut(false);

    if (error) {
      return;
    }

    setUserEmail(null);
    setIsUserLoading(false);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-50 md:grid md:grid-cols-[280px_1fr]">
      <aside className="flex flex-col border-b border-slate-200 bg-white/95 p-4 backdrop-blur md:sticky md:top-0 md:h-screen md:overflow-hidden md:border-b-0 md:border-r md:p-5">
        <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <span className="inline-flex rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Ridge Theory
          </span>
          <p className="mt-3 text-lg font-semibold leading-tight text-slate-900">Campaign & messaging hub</p>
          <p className="mt-1 text-sm text-slate-500">Outbound calls, SMS, leads, DID pool, and call history</p>
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition md:w-full ${
                pathname === item.href
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <NavGlyph id={item.glyph} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Signed in as</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900">
              {isUserLoading ? "Loading user..." : (userEmail ?? "No active user")}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isSigningOut}
              className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
      <NotepadDrawer />
    </div>
  );
}
