const { CONST } = require("../config/constants");

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return { h, m };
}

// Builds a UTC day range for a YYYY-MM-DD string.
// (Prototype simplification: we assume date is provided consistently.)
function dayRangeUTC(dateYYYYMMDD) {
  const start = new Date(`${dateYYYYMMDD}T00:00:00.000Z`);
  const end = new Date(`${dateYYYYMMDD}T23:59:59.999Z`);
  return { start, end };
}

// Work window inside the day (based on WORK_START/WORK_END)
function buildWorkWindow(dateYYYYMMDD) {
  const { h: sh, m: sm } = parseHHMM(CONST.WORK_START);
  const { h: eh, m: em } = parseHHMM(CONST.WORK_END);

  const workStart = new Date(`${dateYYYYMMDD}T00:00:00.000Z`);
  workStart.setUTCHours(sh, sm, 0, 0);

  const workEnd = new Date(`${dateYYYYMMDD}T00:00:00.000Z`);
  workEnd.setUTCHours(eh, em, 0, 0);

  return { workStart, workEnd };
}

/**
 * Returns:
 * - freeGaps: big free windows between booked events
 * - freeSlots: snapped to SLOT_MINUTES chunks for tap-to-book UI
 */
function computeFreeSlots(dateYYYYMMDD, bookedEvents) {
  const { workStart, workEnd } = buildWorkWindow(dateYYYYMMDD);
  const slotMinutes = Number(CONST.SLOT_MINUTES || 30);

  // sort booked events by start time
  const sorted = [...bookedEvents].sort((a, b) => a.startAt - b.startAt);

  // clamp booked blocks within work window
  const blocks = sorted
    .map((e) => ({
      startAt: e.startAt < workStart ? workStart : e.startAt,
      endAt: e.endAt > workEnd ? workEnd : e.endAt,
    }))
    .filter((b) => b.endAt > workStart && b.startAt < workEnd);

  const freeGaps = [];
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

  // snap into fixed-size slots for UI taps (e.g., 30 minutes)
  const freeSlots = [];
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

module.exports = { dayRangeUTC, computeFreeSlots };
