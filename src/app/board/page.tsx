"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/components/SessionProvider";
import { Avatar } from "@/components/Avatar";

type Card = {
  id: number;
  title: string;
  description: string;
  column: string;
  proposedBy: { id: number; name: string; color: string; avatar: string } | null;
};

const COLUMNS: { key: string; label: string; icon: string }[] = [
  { key: "idea", label: "Idea", icon: "💡" },
  { key: "discussing", label: "Discussing", icon: "💬" },
  { key: "decided", label: "Decided", icon: "✅" },
  { key: "in_progress", label: "In progress", icon: "🔨" },
  { key: "done", label: "Done", icon: "🎉" },
];

export default function BoardPage() {
  const { me } = useSession();
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      if (res.ok) setCards((await res.json()).cards);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    });
    setTitle("");
    setDescription("");
    setShowForm(false);
    load();
  };

  const move = async (card: Card, dir: 1 | -1) => {
    const idx = COLUMNS.findIndex((c) => c.key === card.column);
    const next = COLUMNS[idx + dir];
    if (!next) return;
    setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, column: next.key } : c)));
    await fetch(`/api/board/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: next.key }),
    });
    load();
  };

  const remove = async (card: Card) => {
    if (!confirm("Delete this card?")) return;
    await fetch(`/api/board/${card.id}`, { method: "DELETE" });
    load();
  };

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-ink-700">
          <div>
            <h1 className="text-base font-bold">📋 Plan Board</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              What should the team build? Move ideas along together.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="ml-auto rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:scale-95"
          >
            + New idea
          </button>
        </div>

        {showForm && (
          <div className="animate-fade-in border-b border-slate-200 bg-paper-100 px-4 py-3 dark:border-ink-700 dark:bg-ink-900">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Idea title — what should we build?"
              autoFocus
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description (optional)"
              rows={2}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-ink-600 dark:bg-ink-800"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={create}
                disabled={!title.trim()}
                className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition enabled:hover:bg-brand-600 disabled:opacity-40"
              >
                Add to board
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="nice-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full min-w-[900px] gap-3 p-4 lg:min-w-0">
            {COLUMNS.map((col) => {
              const colCards = cards.filter((c) => c.column === col.key);
              const colIdx = COLUMNS.indexOf(col);
              return (
                <div
                  key={col.key}
                  className="flex w-1/5 min-w-[180px] flex-col rounded-2xl bg-paper-100 dark:bg-ink-900"
                >
                  <div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[13px] font-bold">
                    <span>{col.icon}</span> {col.label}
                    <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-ink-700 dark:text-slate-300">
                      {colCards.length}
                    </span>
                  </div>
                  <div className="nice-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                    {colCards.map((card) => (
                      <div
                        key={card.id}
                        className="group animate-msg-in rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:shadow dark:border-ink-700 dark:bg-ink-850"
                      >
                        <div className="text-sm font-semibold leading-snug">{card.title}</div>
                        {card.description && (
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            {card.description}
                          </p>
                        )}
                        <div className="mt-2.5 flex items-center gap-1.5">
                          {card.proposedBy && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                              <Avatar name={card.proposedBy.name} color={card.proposedBy.color} avatar={card.proposedBy.avatar} size={16} />
                              {card.proposedBy.name}
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-0.5">
                            <button
                              onClick={() => move(card, -1)}
                              disabled={colIdx === 0}
                              className="rounded px-1.5 py-0.5 text-xs text-slate-400 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:opacity-30 dark:enabled:hover:bg-ink-700"
                              title="Move back"
                            >
                              ←
                            </button>
                            <button
                              onClick={() => move(card, 1)}
                              disabled={colIdx === COLUMNS.length - 1}
                              className="rounded px-1.5 py-0.5 text-xs text-slate-400 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:opacity-30 dark:enabled:hover:bg-ink-700"
                              title="Move forward"
                            >
                              →
                            </button>
                            {(card.proposedBy?.id === me?.id || me?.role === "Owner") && (
                              <button
                                onClick={() => remove(card)}
                                className="rounded px-1.5 py-0.5 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-red-500 dark:hover:bg-ink-700"
                                title="Delete card"
                              >
                                🗑️
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                    {colCards.length === 0 && (
                      <div className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400 dark:border-ink-700">
                        Nothing here yet
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
