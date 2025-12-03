import { Value, ListValue, NumberValue, StringValue, BasesEntry, BasesPropertyId } from 'obsidian';
import { NormalizedDateRange, TimelineItem, TrackAssignmentResult } from './types';

function parseYearMonthDay(value: Value | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  if (value instanceof ListValue) {
    if (value.length() >= 3) {
      const y = parseComponent(value.get(0));
      const m = parseComponent(value.get(1));
      const d = parseComponent(value.get(2));
      if (y != null && m != null && d != null) return { y, m, d };
    }
  } else if (value instanceof StringValue) {
    const s = value.toString().trim();
    const parts = s.replace(/\[|\]|\(|\)|\{|\}/g, '').split(/[\s,\/\-]+/).filter(Boolean);
    if (parts.length >= 3) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) return { y, m, d };
    }
  } else if (value instanceof NumberValue) {
    const n = Number(value.toString());
    if (Number.isFinite(n)) {
      const y = Math.floor(n / 10000);
      const m = Math.floor((n % 10000) / 100);
      const d = Math.floor(n % 100);
      if (y && m && d) return { y, m, d };
    }
  }
  return null;
}

function parseComponent(v: unknown): number | null {
  if (v instanceof NumberValue) {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  if (v instanceof StringValue) {
    const n = parseInt(v.toString(), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toAbsoluteDay(y: number, m: number, d: number): number {
  const Y = y;
  const M = m;
  const isLeap = (Y % 4 === 0 && Y % 100 !== 0) || (Y % 400 === 0);
  const monthDays = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let days = 0;
  for (let i = 0; i < Y; i++) {
    const leap = (i % 4 === 0 && i % 100 !== 0) || (i % 400 === 0);
    days += leap ? 366 : 365;
  }
  for (let j = 1; j < M; j++) {
    days += monthDays[j - 1];
  }
  days += d - 1;
  return days;
}

export function toAbsoluteDayWithMonths(y: number, m: number, d: number, months: number[]): number {
  const Y = y;
  const M = m;
  const yearDays = months.reduce((a, b) => a + b, 0);
  let days = Y * yearDays;
  for (let j = 1; j < M; j++) {
    const idx = j - 1;
    const md = months[idx] ?? 30;
    days += md;
  }
  const mdCur = months[(M - 1)] ?? 30;
  const dClamped = Math.max(1, Math.min(mdCur, d));
  days += dClamped - 1;
  return days;
}

export function fromAbsoluteDay(yday: number): { y: number; m: number; d: number } {
  let day = yday;
  let y = 0;
  while (true) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    const yearDays = leap ? 366 : 365;
    if (day < yearDays) break;
    day -= yearDays;
    y++;
  }
  const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const md = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let m = 1;
  for (let i = 0; i < md.length; i++) {
    if (day < md[i]) { m = i + 1; break; }
    day -= md[i];
  }
  const d = day + 1;
  return { y, m, d };
}

export function fromAbsoluteDayWithMonths(yday: number, months: number[]): { y: number; m: number; d: number } {
  const yearDays = months.reduce((a, b) => a + b, 0);
  const y = Math.floor(yday / yearDays);
  let day = yday - y * yearDays;
  let m = 1;
  for (let i = 0; i < months.length; i++) {
    if (day < months[i]) { m = i + 1; break; }
    day -= months[i];
  }
  const d = Math.min(months[m - 1] ?? 30, day + 1);
  return { y, m, d };
}

export function extractDateRange(entry: BasesEntry, startProp: BasesPropertyId | null, endProp: BasesPropertyId | null, calendarMonths?: number[]): NormalizedDateRange | null {
  if (!startProp) return null;
  const startVal = entry.getValue(startProp);
  const start = parseYearMonthDay(startVal);
  if (!start) return null;
  const startDay = calendarMonths && calendarMonths.length > 0
    ? toAbsoluteDayWithMonths(start.y, start.m, start.d, calendarMonths)
    : toAbsoluteDay(start.y, start.m, start.d);
  let endDay = startDay;
  if (endProp) {
    const endVal = entry.getValue(endProp);
    const end = parseYearMonthDay(endVal);
    if (end) {
      endDay = calendarMonths && calendarMonths.length > 0
        ? toAbsoluteDayWithMonths(end.y, end.m, end.d, calendarMonths)
        : toAbsoluteDay(end.y, end.m, end.d);
      if (endDay < startDay) endDay = startDay;
    }
  }
  return { startDay, endDay };
}

export function buildTimelineItems(entries: BasesEntry[], startProp: BasesPropertyId | null, endProp: BasesPropertyId | null, indexProp: BasesPropertyId | null, calendarProp?: BasesPropertyId | null): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const entry of entries) {
    let months: number[] | undefined = undefined;
    if (calendarProp) {
      try {
        const v = entry.getValue(calendarProp);
        if (v instanceof ListValue && v.length() > 0) {
          const arr: number[] = [];
          for (let i = 0; i < v.length(); i++) {
            const n = parseComponent(v.get(i));
            if (n != null && n > 0) arr.push(n);
          }
          if (arr.length > 0) months = arr;
        }
      } catch {}
    }
    const range = extractDateRange(entry, startProp, endProp, months);
    if (!range) continue;
    let indexValue: number | null = null;
    if (indexProp) {
      try {
        const v = entry.getValue(indexProp);
        if (v && v.isTruthy()) {
          const n = Number(v.toString());
          if (Number.isFinite(n)) indexValue = n;
        }
      } catch {}
    }
    items.push({ entry, range, indexValue });
  }
  return items;
}

export function sortByIndexOrDate(items: TimelineItem[]): TimelineItem[] {
  const withIndex = items.some(i => i.indexValue != null);
  const sorted = [...items];
  if (withIndex) {
    sorted.sort((a, b) => (a.indexValue ?? 0) - (b.indexValue ?? 0));
  } else {
    sorted.sort((a, b) => a.range.startDay - b.range.startDay || a.range.endDay - b.range.endDay);
  }
  return sorted;
}

export function assignTracks(items: TimelineItem[]): TrackAssignmentResult {
  const tracks: TimelineItem[][] = [];
  const lastEnd: number[] = [];
  for (const item of items) {
    let placed = false;
    for (let t = 0; t < tracks.length; t++) {
      if (item.range.startDay > lastEnd[t]) {
        tracks[t].push(item);
        lastEnd[t] = item.range.endDay;
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([item]);
      lastEnd.push(item.range.endDay);
    }
  }
  return { tracks };
}

export function detectIndexConflicts(items: TimelineItem[]): Set<string> {
  const conflicts = new Set<string>();
  if (items.length <= 1) return conflicts;
  const dateSorted = [...items].sort((a, b) => a.range.startDay - b.range.startDay || a.range.endDay - b.range.endDay);
  const positionByPath = new Map<string, number>();
  for (let i = 0; i < dateSorted.length; i++) {
    positionByPath.set(dateSorted[i].entry.file.path, i);
  }
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const pPrev = positionByPath.get(prev.entry.file.path) ?? 0;
    const pCurr = positionByPath.get(curr.entry.file.path) ?? 0;
    if (pCurr < pPrev) {
      conflicts.add(prev.entry.file.path);
      conflicts.add(curr.entry.file.path);
    }
  }
  return conflicts;
}
