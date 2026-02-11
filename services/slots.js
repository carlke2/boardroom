const { CONST } = require("../config/constants");

function parseHHMM(hhmm) {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return { h, m };
}

/**
 * Builds a LOCAL day range for a YYYY-MM-DD string.
 * This prevents timezone shifts when your business rules are in local time
 * (e.g., Kenya 08:00–17:00).
 */
function dayRangeLocal(dateYYYYMMDD) {
  const start = new Date(`${dateYYYYMMDD}T00:00:00.000`); // <-- NO "Z"
  const end = new Date(`${dateYYYYMMDD}T23:59:59.999`);   // <-- NO "Z"
  return { start, end };
}

/**
 * Work window inside the day (based on WORK_START/WORK_END) in LOCAL time.
 * If CONST.WORK_START="08:00" and WORK_END="17:00" -> returns local 8am–5pm.
 */
function buildWorkWindow(dateYYYYMMDD) {
  const { h: sh, m: sm } = parseHHMM(CONST.WORK_START);
  const { h: eh, m: em } = parseHHMM(CONST.WORK_END);

  const workStart = new Date(`${dateYYYYMMDD}T00:00:00.000`); // <-- NO "Z"
  workStart.setHours(sh, sm, 0, 0); // <-- LOCAL hours

  const workEnd = new Date(`${dateYYYYMMDD}T00:00:00.000`); // <-- NO "Z"
  workEnd.setHours(eh, em, 0, 0); // <-- LOCAL hours

  return { workStart, workEnd };
}

/**
 * Returns:
 * - freeGaps: big free windows between booked events
 * - freeSlots: snapped to SLOT_MINUTES chunks for tap-to-book UI
 * - workStart/workEnd: the computed local work window
 */
function computeFreeSlots(dateYYYYMMDD, bookedEvents) {
  const { workStart, workEnd } = buildWorkWindow(dateYYYYMMDD);
  const slotMinutes = Number(CONST.SLOT_MINUTES || 30);

  // sort booked events by start time
  // assume bookedEvents startAt/endAt are Date objects already
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

module.exports = {
  // Replace UTC dayRange with LOCAL to match your business hours
  dayRangeUTC: dayRangeLocal, // keep exported name so other files don't break
  computeFreeSlots,
};
