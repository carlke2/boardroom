import Booking from "../models/Booking.js";

export interface OccupiedSlot {
  googleEventId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  meetingLink: string | null;
}

/** Confirmed bookings that overlap [start, end). One shared schedule, not split by room. */
export async function occupiedBetween(start: Date, end: Date): Promise<OccupiedSlot[]> {
  const bookings = await Booking.find({
    status: "CONFIRMED",
    startAt: { $lt: end },
    endAt: { $gt: start },
  }).sort({ startAt: 1 });

  return bookings.map((booking) => {
    const title = booking.meetingTitle
      ? `${booking.teamName} — ${booking.meetingTitle}`
      : booking.teamName;
    return {
      googleEventId: booking._id.toString(),
      title,
      startAt: booking.startAt,
      endAt: booking.endAt,
      meetingLink: booking.meetingLink || null,
    };
  });
}
