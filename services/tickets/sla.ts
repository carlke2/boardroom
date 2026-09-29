import type { Types } from "mongoose";
import BusinessHours, { type HoursWindow } from "../../models/BusinessHours.js";
import SlaPolicy from "../../models/SlaPolicy.js";
import type { TicketPriority } from "../../types/tickets.js";

function parseHHMM(value: string): number {
  const [hRaw, mRaw] = value.split(":");
  return Number(hRaw) * 60 + Number(mRaw);
}

function minutesUntilClose(cursor: Date, windows: HoursWindow[]): number {
  const day = cursor.getDay();
  const minute = cursor.getHours() * 60 + cursor.getMinutes();
  for (const window of windows) {
    if (window.day !== day) continue;
    const start = parseHHMM(window.start);
    const end = parseHHMM(window.end);
    if (minute >= start && minute < end) return end - minute;
  }
  return 0;
}

function jumpToNextOpen(cursor: Date, windows: HoursWindow[]): Date {
  for (let offset = 0; offset < 8; offset += 1) {
    const dayDate = new Date(cursor);
    dayDate.setDate(cursor.getDate() + offset);
    const day = dayDate.getDay();
    const candidates = windows
      .filter((window) => window.day === day)
      .sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start));
    for (const window of candidates) {
      const startMin = parseHHMM(window.start);
      const at = new Date(dayDate);
      at.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      if (at.getTime() > cursor.getTime()) return at;
    }
  }
  return new Date(cursor.getTime() + 60 * 1000);
}

export function addBusinessMinutes(start: Date, minutes: number, windows: HoursWindow[]): Date {
  if (!windows.length) return new Date(start.getTime() + minutes * 60 * 1000);

  let remaining = minutes;
  let cursor = new Date(start.getTime());
  let safety = 0;
  while (remaining > 0 && safety < 20000) {
    safety += 1;
    const openFor = minutesUntilClose(cursor, windows);
    if (openFor > 0) {
      const step = Math.min(remaining, openFor);
      cursor = new Date(cursor.getTime() + step * 60 * 1000);
      remaining -= step;
    } else {
      cursor = jumpToNextOpen(cursor, windows);
    }
  }
  return cursor;
}

export async function dueDatesFor(
  start: Date,
  priority: TicketPriority
): Promise<{ response: Date | null; resolution: Date | null }> {
  const policy = await SlaPolicy.findOne({ priority });
  if (!policy) return { response: null, resolution: null };

  let windows: HoursWindow[] = [];
  if (policy.businessHoursId) {
    const hours = await BusinessHours.findById(policy.businessHoursId);
    windows = hours?.windows ?? [];
  }

  return {
    response: addBusinessMinutes(start, policy.responseMinutes, windows),
    resolution: addBusinessMinutes(start, policy.resolutionMinutes, windows),
  };
}

export function slaRiskWindowMs(): number {
  const minutes = Number(process.env.SLA_AT_RISK_MINUTES || 30);
  return (Number.isFinite(minutes) ? minutes : 30) * 60 * 1000;
}

export function reopenWindowMs(): number {
  const days = Number(process.env.TICKET_REOPEN_DAYS || 7);
  return (Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000;
}

export function asId(value: Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}
