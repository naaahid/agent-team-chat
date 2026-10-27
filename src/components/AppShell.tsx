"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession, type Me } from "./SessionProvider";
import { Avatar, RoleBadge } from "./Avatar";

export type Channel = { id: number; slug: string; name: string; topic: string };
export type Member = Me & { online: boolean; joinedAt: string | null };

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  return (
    <button
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("theme", next ? "dark" : "light");
      }}
      className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-ink-700 dark:hover:text-slate-100"
      title="Toggle light / dark"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

const NAV = [
  { href: "/", label: "Chat", icon: "💬" },
  { href: "/board", label: "Plan Board", icon: "📋" },
  { href: "/updates", label: "Daily Updates", icon: "📅" },
  { href: "/decisions", label: "Decisions", icon: "📌" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          <div className="animate-pulse text-sm text-slate-500">Opening the team room…</div>
        </div>
      }
    >
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useSession();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeChannelId = Number(searchParams.get("ch") ?? 0);

  useEffect(() => {
    if (!me) return;
    let stop = false;
    const load = async () => {
      try {
        const [chRes, memRes] = await Promise.all([
          fetch("/api/channels", { cache: "no-store" }),
          fetch("/api/members", { cache: "no-store" }),
        ]);
        if (stop) return;
        if (chRes.ok) setChannels((await chRes.json()).channels);
        if (memRes.ok) setMembers((await memRes.json()).members);
      } catch {
        // network blip — next tick retries
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [me]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="animate-pulse text-sm text-slate-500">Opening the team room…</div>
      </div>
    );
  }
  if (!me) return null; // SessionProvider redirects to /join

  const navItem = (href: string, label: string, icon: string) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
          active
            ? "bg-brand-500 text-white shadow-sm"
            : "text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-ink-700 dark:hover:text-white"
        }`}
      >
        <span aria-hidden>{icon}</span> {label}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-paper-100 dark:bg-ink-900">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg shadow">🛰️</div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold leading-tight">Agent Team</div>
          <div className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">3 friends · 3 Muse agents</div>
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <nav className="space-y-1 px-3 py-2">
        {NAV.map((n) => navItem(n.href, n.label, n.icon))}
        {me.role === "Owner" && navItem("/admin", "Admin", "🛠️")}
      </nav>

      <div className="px-3 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Channels
      </div>
      <div className="nice-scroll space-y-0.5 overflow-y-auto px-3">
        {channels.map((ch) => {
          const active = pathname === "/" && activeChannelId === ch.id;
          return (
            <button
              key={ch.id}
              onClick={() => {
                setMobileOpen(false);
                router.push(`/?ch=${ch.id}`);
              }}
              className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-sm transition ${
                active
                  ? "bg-slate-300/60 font-semibold text-slate-900 dark:bg-ink-700 dark:text-white"
                  : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-ink-800"
              }`}
            >
              <span className="text-slate-400">#</span>
              <span className="truncate">{ch.name}</span>
            </button>
          );
        })}
        {channels.length === 0 && (
          <div className="px-3 py-1 text-xs text-slate-400">No channels yet</div>
        )}
      </div>

      <div className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        Team — {members.length}
      </div>
      <div className="nice-scroll space-y-0.5 overflow-y-auto px-3 pb-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <div className="relative">
              <Avatar name={m.name} color={m.color} avatar={m.avatar} size={28} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-paper-100 dark:border-ink-900 ${
                  m.online ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center truncate text-[13px] font-medium" style={{ color: m.color }}>
                {m.name}
                <RoleBadge role={m.role} kind={m.kind} />
              </div>
              <div className="text-[11px] text-slate-400">
                {m.joinedAt ? (m.online ? "online" : "away") : "invited — not joined yet"}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-slate-200 p-3 dark:border-ink-700">
        <div className="flex items-center gap-2.5">
          <Avatar name={me.name} color={me.color} avatar={me.avatar} size={34} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-center truncate text-sm font-semibold" style={{ color: me.color }}>
              {me.name}
              <RoleBadge role={me.role} kind={me.kind} />
            </div>
            <div className="text-[11px] text-slate-400">signed in with access code</div>
          </div>
          <button
            onClick={logout}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-ink-700 dark:hover:text-slate-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 dark:border-ink-700 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl animate-fade-in">{sidebar}</aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-ink-700 md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg px-2 py-1.5 text-lg hover:bg-slate-200/70 dark:hover:bg-ink-700"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="text-sm font-bold">🛰️ Agent Team</span>
        </div>
        {children}
      </main>
    </div>
  );
}
