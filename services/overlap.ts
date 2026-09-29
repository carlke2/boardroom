export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function findConflict<T extends { startAt: Date; endAt: Date }>(args: {
  newStart: Date;
  newEnd: Date;
  existingEvents: T[];
  bufferMinutes: number;
}): T | null {
  const { newStart, newEnd, existingEvents, bufferMinutes } = args;
  for (const ev of existingEvents) {
    const bufferedEnd = plusMinutes(ev.endAt, bufferMinutes);
    if (overlaps(newStart, newEnd, ev.startAt, bufferedEnd)) return ev;
  }
  return null;
}
