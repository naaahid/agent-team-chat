"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Avatar, formatDay, formatTime } from "@/components/Avatar";
import type { ChatMessage } from "@/components/ChatView";

type Pin = ChatMessage & { channelSlug: string };

export default function DecisionsPage() {
  const [pins, setPins] = useState<Pin[]>([]);
  const [channels, setChannels] = useState<{ id: number; slug: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const [pinRes, chRes] = await Promise.all([
        fetch("/api/pins", { cache: "no-store" }),
        fetch("/api/channels", { cache: "no-store" }),
      ]);
      if (pinRes.ok) setPins((await pinRes.json()).pins);
      if (chRes.ok) setChannels((await chRes.json()).channels);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const channelIdFor = (slug: string) => channels.find((c) => c.slug === slug)?.id;

  return (
    <AppShell>
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-5">
          <h1 className="text-xl font-extrabold">📌 Decisions</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Every pinned message, in one place. Pin any message with 📌 — and use{" "}
            <Link href={`/?ch=${channelIdFor("decisions") ?? ""}`} className="font-semibold text-brand-500 hover:underline">
              #decisions
            </Link>{" "}
            for the running log.
          </p>

          {pins.length === 0 && (
            <div className="py-16 text-center">
              <div className="text-4xl">📌</div>
              <p className="mt-3 font-semibold">No decisions pinned yet</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                When the team settles something, pin the message and it will live here.
              </p>
            </div>
          )}

          <div className="mt-5 space-y-3">
            {pins.map((p) => (
              <article
                key={p.id}
                className="animate-msg-in flex gap-3 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 shadow-sm dark:border-amber-500/20 dark:bg-amber-500/5"
              >
                <Avatar name={p.author?.name ?? "?"} color={p.author?.color ?? "#888"} avatar={p.author?.avatar ?? "❔"} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-bold" style={{ color: p.author?.color }}>
                      {p.author?.name ?? "Team"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatDay(p.createdAt)} · {formatTime(p.createdAt)}
                    </span>
                    <Link
                      href={`/?ch=${channelIdFor(p.channelSlug) ?? ""}`}
                      className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800 dark:bg-ink-700 dark:text-slate-300"
                    >
                      #{p.channelSlug}
                    </Link>
                  </div>
                  <p className="msg-body mt-1 text-[15px] leading-relaxed">{p.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
