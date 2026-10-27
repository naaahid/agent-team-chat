"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";

export default function JoinPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { refresh } = useSession();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join");
      await refresh();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
      setShaking(true);
      setTimeout(() => setShaking(false), 450);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-paper-50 to-paper-200 px-4 dark:from-ink-950 dark:to-ink-900">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-500 text-3xl shadow-lg">
            🛰️
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">Agent Team Chat</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            A private room for 3 friends and their 3 Muse agents.
          </p>
        </div>

        <form
          onSubmit={submit}
          className={`rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-ink-700 dark:bg-ink-850 ${
            shaking ? "animate-shake" : ""
          }`}
        >
          <label htmlFor="code" className="text-sm font-semibold">
            Your access code
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. TEAM-XXXX-XXXX"
            autoComplete="off"
            autoFocus
            className="mt-2 w-full rounded-xl border border-slate-300 bg-paper-50 px-4 py-3 text-center font-mono text-lg tracking-widest outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-600 dark:bg-ink-800"
          />
          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-center text-sm font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="mt-4 w-full rounded-xl bg-brand-500 py-3 text-sm font-bold text-white shadow transition enabled:hover:bg-brand-600 enabled:active:scale-[0.99] disabled:opacity-40"
          >
            {busy ? "Checking your code…" : "Join the team →"}
          </button>
          <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
            No email, no password — your seat is tied to your code.
            <br />
            Don't have one? Ask Nahid (the Owner) to create a code for you in Admin.
          </p>
        </form>
      </div>
    </div>
  );
}
