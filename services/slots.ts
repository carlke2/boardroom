import { CONST } from "../config/constants.js";

export interface TimeRange {
  startAt: Date;
  endAt: Date;
}

function parseHHMM(hhmm: string): { h: number; m: number } {
  const [hRaw, mRaw] = String(hhmm).split(":");
  return {
    h: parseInt(hRaw ?? "", 10),
    m: parseInt(mRaw ?? "", 10),
  };
}

/**
 * Builds a LOCAL day range for a YYYY-MM-DD string.
 * This prevents timezone shifts when your business rules are in local time
 * (e.g., Kenya 08:00–17:00).
 */
export function dayRangeLocal(dateYYYYMMDD: string): { start: Date; end: Date } {
  const start = new Date(`${dateYYYYMMDD}T00:00:00.000`);
  const end = new Date(`${dateYYYYMMDD}T23:59:59.999`);
  return { start, end };
}

function buildWorkWindow(dateYYYYMMDD: string): { workStart: Date; workEnd: Date } {
  const { h: sh, m: sm } = parseHHMM(CONST.WORK_START);
  const { h: eh, m: em } = parseHHMM(CONST.WORK_END);

  const workStart = new Date(`${dateYYYYMMDD}T00:00:00.000`);
  workStart.setHours(sh, sm, 0, 0);

  const workEnd = new Date(`${dateYYYYMMDD}T00:00:00.000`);
  workEnd.setHours(eh, em, 0, 0);

  return { workStart, workEnd };
}

export function computeFreeSlots(
  dateYYYYMMDD: string,
  bookedEvents: TimeRange[]
): { freeGaps: TimeRange[]; freeSlots: TimeRange[]; workStart: Date; workEnd: Date } {
  const { workStart, workEnd } = buildWorkWindow(dateYYYYMMDD);
  const slotMinutes = Number(CONST.SLOT_MINUTES || 30);

  const sorted = [...bookedEvents].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const blocks = sorted
    .map((e) => ({
      startAt: e.startAt < workStart ? workStart : e.startAt,
      endAt: e.endAt > workEnd ? workEnd : e.endAt,
    }))
    .filter((b) => b.endAt > workStart && b.startAt < workEnd);

  const freeGaps: TimeRange[] = [];
  let cursor = new Date(workStart);

  for (const b of blocks) {
    if (cursor < b.startAt) {
      freeGaps.push({ startAt: new Date(cursor), endAt: new Date(b.startAt) });
    }
    if (cursor < b.endAt) cursor = new Date(b.endAt);
  }

  if (cursor < workEnd) {
    freeGaps.push({ startAt: new Date(cursor), endAt: new Date(workEnd) });
  }

  const freeSlots: TimeRange[] = [];
  for (const gap of freeGaps) {
    let t = new Date(gap.startAt);
    while (t.getTime() + slotMinutes * 60 * 1000 <= gap.endAt.getTime()) {
      const e = new Date(t.getTime() + slotMinutes * 60 * 1000);
      freeSlots.push({ startAt: new Date(t), endAt: e });
      t = e;
    }
  }

  return { freeGaps, freeSlots, workStart, workEnd };
}

export const dayRangeUTC = dayRangeLocal;
