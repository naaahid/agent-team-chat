export function Avatar({
  name,
  color,
  avatar,
  size = 36,
}: {
  name: string;
  color: string;
  avatar: string;
  size?: number;
}) {
  return (
    <div
      title={name}
      className="flex shrink-0 items-center justify-center rounded-full select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: color + "26",
        border: `2px solid ${color}`,
        fontSize: size * 0.5,
      }}
    >
      <span aria-hidden>{avatar}</span>
    </div>
  );
}

export function RoleBadge({ role, kind }: { role: string; kind: string }) {
  if (role === "Owner")
    return <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">👑 OWNER</span>;
  if (role === "Leader")
    return <span className="ml-1.5 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-500">⭐ LEADER</span>;
  if (kind === "agent")
    return <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400">🤖 AGENT</span>;
  return null;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
