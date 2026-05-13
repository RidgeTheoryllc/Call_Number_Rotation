"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dateToDatetimeLocalValue, parseDatetimeLocalValue } from "@/lib/callback-schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function buildMonthGrid(viewMonth: Date): { date: Date; inMonth: boolean }[] {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const first = new Date(y, m, 1);
  const lastDay = new Date(y, m + 1, 0).getDate();
  const pad = first.getDay();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < pad; i++) {
    cells.push({ date: new Date(y, m, i - pad + 1), inMonth: false });
  }
  for (let day = 1; day <= lastDay; day++) {
    cells.push({ date: new Date(y, m, day), inMonth: true });
  }
  let tailDay = lastDay + 1;
  while (cells.length % 7 !== 0) {
    cells.push({ date: new Date(y, m, tailDay), inMonth: false });
    tailDay += 1;
  }
  return cells;
}

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

const QUICK_SLOTS: { label: string; hour: number; minute: number }[] = [
  { label: "9:00 AM", hour: 9, minute: 0 },
  { label: "11:00 AM", hour: 11, minute: 0 },
  { label: "1:00 PM", hour: 13, minute: 0 },
  { label: "3:00 PM", hour: 15, minute: 0 },
  { label: "5:00 PM", hour: 17, minute: 0 },
];

type Props = {
  value: string;
  onChange: (datetimeLocal: string) => void;
  idPrefix?: string;
};

export function CallbackSchedulePicker({ value, onChange, idPrefix = "cb-sched" }: Props) {
  const selected = useMemo(() => parseDatetimeLocalValue(value) ?? new Date(), [value]);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected));

  useEffect(() => {
    const d = parseDatetimeLocalValue(value);
    if (d) queueMicrotask(() => setViewMonth(startOfMonth(d)));
  }, [value]);

  const today = useMemo(() => new Date(), []);
  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleString(undefined, { month: "long", year: "numeric" });

  const setSelectedDateKeepingTime = useCallback(
    (day: Date) => {
      const next = new Date(day);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      onChange(dateToDatetimeLocalValue(next));
    },
    [onChange, selected],
  );

  const setTime = useCallback(
    (hour: number, minute: number) => {
      const next = new Date(selected);
      next.setHours(hour, minute, 0, 0);
      onChange(dateToDatetimeLocalValue(next));
    },
    [onChange, selected],
  );

  const hour = selected.getHours();
  const minute = selected.getMinutes();

  const hourOptions = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 rounded-2xl border border-slate-200/80 bg-linear-to-b from-slate-50 to-white p-4 shadow-sm ring-1 ring-slate-100">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            aria-label="Previous month"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <p className="text-center text-sm font-semibold tracking-tight text-slate-900">{monthLabel}</p>
          <button
            type="button"
            onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
            aria-label="Next month"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {grid.map(({ date, inMonth }, i) => {
            const isSelected = sameLocalDay(date, selected);
            const isToday = sameLocalDay(date, today);
            return (
              <button
                key={`${i}-${date.getTime()}`}
                type="button"
                onClick={() => setSelectedDateKeepingTime(date)}
                className={[
                  "relative flex aspect-square max-h-10 items-center justify-center rounded-xl text-sm font-medium transition",
                  !inMonth && "text-slate-300 hover:bg-slate-100 hover:text-slate-500",
                  inMonth && !isSelected && "text-slate-700 hover:bg-indigo-50 hover:text-indigo-900",
                  isSelected && "bg-indigo-600 text-white shadow-md shadow-indigo-600/25 hover:bg-indigo-700",
                  isToday && !isSelected && "ring-2 ring-amber-300/80 ring-offset-1 ring-offset-white",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 sm:w-[220px]">
        <div>
          <p id={`${idPrefix}-time-h`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Time
          </p>
          <div className="flex gap-2">
            <label htmlFor={`${idPrefix}-hour`} className="sr-only">
              Hour
            </label>
            <select
              id={`${idPrefix}-hour`}
              value={hour}
              onChange={(e) => setTime(Number(e.target.value), minute)}
              className="h-11 min-w-0 flex-1 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {new Date(2000, 0, 1, h).toLocaleString(undefined, { hour: "numeric", hour12: true })}
                </option>
              ))}
            </select>
            <label htmlFor={`${idPrefix}-min`} className="sr-only">
              Minutes
            </label>
            <select
              id={`${idPrefix}-min`}
              value={minute}
              onChange={(e) => setTime(hour, Number(e.target.value))}
              className="h-11 w-22 shrink-0 cursor-pointer rounded-xl border border-slate-200 bg-white px-2 text-center text-sm font-semibold text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            >
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  :{String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick pick</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_SLOTS.map((slot) => {
              const active = hour === slot.hour && minute === slot.minute;
              return (
                <button
                  key={slot.label}
                  type="button"
                  onClick={() => setTime(slot.hour, slot.minute)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 ring-1 ring-slate-200/80 hover:bg-indigo-50 hover:text-indigo-900"
                  }`}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-800">Preview:</span>{" "}
          {selected.toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
