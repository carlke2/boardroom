function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function findConflict({ newStart, newEnd, existingEvents, bufferMinutes }) {
  for (const ev of existingEvents) {
    const bufferedEnd = plusMinutes(ev.endAt, bufferMinutes);
    if (overlaps(newStart, newEnd, ev.startAt, bufferedEnd)) return ev;
  }
  return null;
}

module.exports = { findConflict };
