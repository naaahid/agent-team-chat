export const BOARD_COLUMNS = ["idea", "discussing", "decided", "in_progress", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export function isBoardColumn(v: unknown): v is BoardColumn {
  return typeof v === "string" && (BOARD_COLUMNS as readonly string[]).includes(v);
}
