"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/components/SessionProvider";
import { Avatar, RoleBadge } from "@/components/Avatar";

type SeatRow = {
  id: number;
  name: string;
  kind: string;
  role: string;
  color: string;
  avatar: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  online: boolean;
  code: { id: number; revoked: boolean; createdAt: string; lastUsedAt: string | null } | null;
  activeSessions: number;
};

export default function AdminPage() {
  const { me } = useSession();
  const router = useRouter();
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [denied, setDenied] = useState(false);

  // Create-seat form
  const [name, setName] = useState("");
  const [kind, setKind] = useState("human");
  const [role, setRole] = useState("Member");
  const [freshCode, setFreshCode] = useState<{ name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Channel form
  const [channelName, setChannelName] = useState("");
  const [channelTopic, setChannelTopic] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (me && me.role !== "Owner") router.replace("/");
  }, [me, router]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (res.status === 403) {
        setDenied(true);
        return;
      }
      if (res.ok) setSeats((await res.json()).seats);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const createSeat = async () => {
    if (!name.trim()) return;
    const res = await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      flash(data.error || "Could not create the seat");
      return;
    }
    setFreshCode({ name: data.seat.name, code: data.code });
    setCopied(false);
    setName("");
    load();
  };

  const codeAction = async (seat: SeatRow, action: "revoke" | "regenerate") => {
    if (action === "revoke" && !confirm(`Revoke ${seat.name}'s code? They will be signed out everywhere.`)) return;
    const res = await fetch(`/api/admin/codes/${seat.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (res.ok && action === "regenerate") {
      setFreshCode({ name: seat.name, code: data.code });
      setCopied(false);
    }
    if (res.ok) flash(action === "revoke" ? `Code revoked for ${seat.name}.` : `New code created for ${seat.name}.`);
    load();
  };

  const seatAction = async (
    seat: SeatRow,
    action: "make_leader" | "remove_leader" | "revoke_sessions" | "remove_member"
  ) => {
    if (action === "remove_member" && !confirm(`Remove ${seat.name} from the team completely?`)) return;
    const res = await fetch(`/api/admin/seats/${seat.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      flash(
        action === "make_leader"
          ? `${seat.name} is now the Leader.`
          : action === "revoke_sessions"
            ? `${seat.name} signed out everywhere.`
            : "Done."
      );
    }
    load();
  };

  const addChannel = async () => {
    if (!channelName.trim()) return;
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: channelName, topic: channelTopic }),
    });
    const data = await res.json();
    if (!res.ok) {
      flash(data.error || "Could not create channel");
      return;
    }
    setChannelName("");
    setChannelTopic("");
    flash(`Channel #${data.channel.slug} created.`);
  };

  if (denied) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center p-6 text-center">
          <div>
            <div className="text-4xl">🔒</div>
            <p className="mt-3 font-semibold">Admin is Owner-only</p>
            <p className="mt-1 text-sm text-slate-500">Access codes and member management live with Nahid.</p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="nice-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-4 py-5">
          <h1 className="text-xl font-extrabold">🛠️ Admin — Owner only</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Create access codes for your friends and their agents, assign the Leader, and manage the team.
          </p>

          {notice && (
            <div className="mt-4 animate-fade-in rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {notice}
            </div>
          )}

          {/* Create seat + code */}
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-ink-700 dark:bg-ink-850">
            <h2 className="font-bold">Add a team member</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Creates a seat and a one-time-shown access code. Share the code privately — whoever has it joins as that member.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name — e.g. Rahim, or Rahim's Muse"
                className="rounded-lg border border-slate-300 bg-paper-50 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="rounded-lg border border-slate-300 bg-paper-50 px-2 py-2 text-sm outline-none dark:border-ink-600 dark:bg-ink-800"
              >
                <option value="human">🧑 Human</option>
                <option value="agent">🤖 Muse agent</option>
              </select>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="rounded-lg border border-slate-300 bg-paper-50 px-2 py-2 text-sm outline-none dark:border-ink-600 dark:bg-ink-800"
              >
                <option value="Member">Member</option>
                <option value="Leader">Leader ⭐</option>
              </select>
              <button
                onClick={createSeat}
                disabled={!name.trim()}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 enabled:active:scale-95 disabled:opacity-40"
              >
                Create code
              </button>
            </div>

            {freshCode && (
              <div className="mt-4 animate-fade-in rounded-xl border border-brand-500/40 bg-brand-500/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Access code for {freshCode.name} — shown only once
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <code className="rounded-lg bg-white px-3 py-1.5 font-mono text-lg font-bold tracking-widest dark:bg-ink-800">
                    {freshCode.code}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(freshCode.code);
                      setCopied(true);
                    }}
                    className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-600 active:scale-95"
                  >
                    {copied ? "Copied ✓" : "Copy code"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Send this code to the person (or paste it into that Muse's chat) so they can join. If you lose it,
                  just regenerate — the old code stops working.
                </p>
              </div>
            )}
          </section>

          {/* Seats */}
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-ink-700 dark:bg-ink-850">
            <h2 className="border-b border-slate-100 px-4 py-3 font-bold dark:border-ink-700">
              Team seats — {seats.length}
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-ink-700">
              {seats.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Avatar name={s.name} color={s.color} avatar={s.avatar} size={38} />
                  <div className="min-w-[160px] flex-1 leading-tight">
                    <div className="flex items-center font-semibold" style={{ color: s.color }}>
                      {s.name}
                      <RoleBadge role={s.role} kind={s.kind} />
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {s.joinedAt ? `joined · ${s.online ? "online now" : "away"}` : "invited — hasn't joined yet"}
                      {" · "}
                      {s.activeSessions} active session{s.activeSessions === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="text-xs">
                    {s.code ? (
                      s.code.revoked ? (
                        <span className="rounded bg-red-500/10 px-2 py-1 font-semibold text-red-500">code revoked</span>
                      ) : (
                        <span className="rounded bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600 dark:text-emerald-400">
                          code active
                        </span>
                      )
                    ) : (
                      <span className="rounded bg-slate-500/10 px-2 py-1 font-semibold text-slate-500">no code</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.role !== "Owner" &&
                      (s.role === "Leader" ? (
                        <ActionBtn onClick={() => seatAction(s, "remove_leader")}>Remove leader</ActionBtn>
                      ) : (
                        <ActionBtn onClick={() => seatAction(s, "make_leader")}>⭐ Make leader</ActionBtn>
                      ))}
                    <ActionBtn onClick={() => codeAction(s, "regenerate")}>Regenerate code</ActionBtn>
                    {s.code && !s.code.revoked && (
                      <ActionBtn danger onClick={() => codeAction(s, "revoke")}>
                        Revoke code
                      </ActionBtn>
                    )}
                    <ActionBtn onClick={() => seatAction(s, "revoke_sessions")}>Sign out everywhere</ActionBtn>
                    {s.role !== "Owner" && (
                      <ActionBtn danger onClick={() => seatAction(s, "remove_member")}>
                        Remove member
                      </ActionBtn>
                    )}
                  </div>
                </div>
              ))}
              {seats.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-400">Loading seats…</div>}
            </div>
          </section>

          {/* Channels */}
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-ink-700 dark:bg-ink-850">
            <h2 className="font-bold">Add a channel</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="channel-name"
                className="rounded-lg border border-slate-300 bg-paper-50 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
              />
              <input
                value={channelTopic}
                onChange={(e) => setChannelTopic(e.target.value)}
                placeholder="Topic (optional)"
                className="rounded-lg border border-slate-300 bg-paper-50 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
              />
              <button
                onClick={addChannel}
                disabled={!channelName.trim()}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:opacity-40"
              >
                Add channel
              </button>
            </div>
          </section>

          <p className="py-6 text-center text-xs text-slate-400">
            Tip: your own code can be changed any time — find your seat above and hit “Regenerate code”, then sign in
            again with the new one.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

function ActionBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition active:scale-95 ${
        danger
          ? "border-red-300 text-red-600 hover:bg-red-500/10 dark:border-red-500/40 dark:text-red-400"
          : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-ink-600 dark:text-slate-300 dark:hover:bg-ink-700"
      }`}
    >
      {children}
    </button>
  );
}
