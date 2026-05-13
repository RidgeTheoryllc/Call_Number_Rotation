/** Same calendar day in the browser's local timezone. */
export function isSameLocalCalendarDay(iso: string | null | undefined, ref = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

export function localDateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Value for `<input type="datetime-local" />` in local time. */
export function isoToDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Local `YYYY-MM-DDTHH:mm` from a `Date` in the browser timezone. */
export function dateToDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse `YYYY-MM-DDTHH:mm` as local wall time. */
export function parseDatetimeLocalValue(s: string): Date | null {
  if (!s || !s.includes("T")) return null;
  const [datePart, timePart] = s.split("T");
  const [y, mo, da] = datePart.split("-").map(Number);
  const tp = (timePart ?? "0:0").slice(0, 5);
  const [h, mi] = tp.split(":").map((x) => Number(x));
  if (!y || !mo || !da || Number.isNaN(h) || Number.isNaN(mi)) return null;
  const d = new Date(y, mo - 1, da, h, mi, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
