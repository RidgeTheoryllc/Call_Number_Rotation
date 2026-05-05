"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  const syncUserRecord = async () => {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id || !userData.user.email) {
      throw new Error(userError?.message ?? "Could not load current user session.");
    }

    const syncResponse = await fetch("/api/auth/sync-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: userData.user.id,
        email: userData.user.email,
      }),
    });

    if (!syncResponse.ok) {
      const payload = (await syncResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error ?? "Could not sync user profile.");
    }
  };

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace("/");
      }
    };

    void checkSession();
  }, [router, supabase]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    if (isSignUpMode) {
      const signUpResponse = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!signUpResponse.ok) {
        const payload = (await signUpResponse.json().catch(() => null)) as { error?: string } | null;
        setIsSubmitting(false);
        setError(payload?.error ?? "Could not create account.");
        return;
      }

      const { error: signInErrorAfterSignUp } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInErrorAfterSignUp) {
        setIsSubmitting(false);
        setError(signInErrorAfterSignUp.message);
        return;
      }

      try {
        await syncUserRecord();
      } catch (syncError) {
        setIsSubmitting(false);
        setError(syncError instanceof Error ? syncError.message : "Could not sync user profile.");
        return;
      }

      setIsSubmitting(false);
      router.replace("/");
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    try {
      await syncUserRecord();
    } catch (syncError) {
      setIsSubmitting(false);
      setError(syncError instanceof Error ? syncError.message : "Could not sync user profile.");
      return;
    }

    router.replace("/");
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Ridge Theory</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">{isSignUpMode ? "Sign up" : "Sign in"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isSignUpMode ? "Create your account for the Outbound Dialer Intelligence System." : "Access the Outbound Dialer Intelligence System."}
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              placeholder="••••••••"
            />
          </label>

          {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (isSignUpMode ? "Signing up..." : "Signing in...") : (isSignUpMode ? "Sign up" : "Sign in")}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setError("");
            setIsSignUpMode((prev) => !prev);
          }}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          {isSignUpMode ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          Need access? Contact your administrator.
          {" "}
          <Link href="/" className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-900">
            Back to dashboard
          </Link>
        </p>
      </div>
    </main>
  );
}
