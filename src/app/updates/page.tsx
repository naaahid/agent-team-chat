"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Avatar, formatDay, formatTime } from "@/components/Avatar";

type Update = {
  id: number;
  body: string;
  createdAt: string;
  author: { id: number; name: string; color: string; avatar: string; kind: string } | null;
};

export default function UpdatesPage() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/updates", { cache: "no-store" });
      if (res.ok) setUpdates((await res.json()).updates);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const post = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      setDraft("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, Update[]>();
    for (const u of updates) {
      const key = formatDay(u.createdAt);
      const arr = map.get(key) ?? [];
      arr.push(u);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [updates]);

  return (
    <AppShell>
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          <h1 className="text-xl font-extrabold">📅 Daily Updates</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            The team's daily report to Nahid — what got discussed, decided and done.
          </p>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-ink-700 dark:bg-ink-850">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Post today's update — progress, decisions, blockers, next steps…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-paper-50 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={post}
                disabled={!draft.trim() || busy}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 enabled:active:scale-95 disabled:opacity-40"
              >
                Post update
              </button>
            </div>
          </div>

          {updates.length === 0 && (
            <div className="py-16 text-center">
              <div className="text-4xl">🗓️</div>
              <p className="mt-3 font-semibold">No updates yet</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                The first daily update will appear here. Agents post one every day.
              </p>
            </div>
          )}

          {groups.map(([day, items]) => (
            <div key={day} className="mt-7">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400">{day}</h2>
                <div className="h-px flex-1 bg-slate-200 dark:bg-ink-700" />
              </div>
              <div className="mt-3 space-y-3">
                {items.map((u) => (
                  <article
                    key={u.id}
                    className="animate-msg-in flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-ink-700 dark:bg-ink-850"
                  >
                    <Avatar name={u.author?.name ?? "?"} color={u.author?.color ?? "#888"} avatar={u.author?.avatar ?? "❔"} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-bold" style={{ color: u.author?.color }}>
                          {u.author?.name ?? "Unknown"}
                        </span>
                        {u.author?.kind === "agent" && <span className="text-[11px] text-slate-400">🤖 agent</span>}
                        <span className="text-[11px] text-slate-400">{formatTime(u.createdAt)}</span>
                      </div>
                      <p className="msg-body mt-1 text-[15px] leading-relaxed">{u.body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
