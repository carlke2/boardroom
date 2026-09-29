import { Router } from "express";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import { authRequired } from "../middleware/auth.js";
import { CONST } from "../config/constants.js";
import { occupiedBetween } from "../services/occupancy.js";
import { dayRangeUTC, computeFreeSlots } from "../services/slots.js";
import { findConflict } from "../services/overlap.js";
import { createRemindersForBooking, cancelRemindersForBooking } from "../services/reminders.js";
import { writeLog } from "../services/activityLog.js";
import { sendEmail } from "../services/notify/email.js";
import { sendSms } from "../services/notify/sms.js";
import {
  buildBookingSubject,
  buildBookingEmailHtml,
  buildBookingEmailText,
} from "../services/notify/templates.js";
import { asString, errorMessage } from "../utils/errors.js";

const router = Router();

function isYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeEmails(input: unknown): string[] {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(",");
  return arr.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function uniq(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list || []) {
    if (!x) continue;
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

router.get("/day", authRequired, async (req, res) => {
  try {
    const date = asString(req.query.date);

    if (!date) {
      return res.status(400).json({ ok: false, message: "date=YYYY-MM-DD required" });
    }

    if (!isYYYYMMDD(date)) {
      return res.status(400).json({ ok: false, message: "date must be YYYY-MM-DD" });
    }

    const { start, end } = dayRangeUTC(date);
    const events = await occupiedBetween(start, end);
    const { freeSlots, freeGaps, workStart, workEnd } = computeFreeSlots(date, events);

    return res.json({
      ok: true,
      date,
      workWindow: { startAt: workStart, endAt: workEnd },
      booked: events,
      freeSlots,
      freeGaps,
    });
  } catch (e) {
    console.error("[/api/day] ERROR", e);
    return res.status(500).json({ ok: false, message: errorMessage(e) || "Internal Server Error" });
  }
});

router.post("/bookings", authRequired, async (req, res) => {
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const {
      roomId,
      attendeeCount,
      teamName,
      meetingTitle,
      startAt,
      durationMinutes,
      meetingLink,
      attendees,
    } = req.body || {};

    if (!teamName || !startAt || !durationMinutes || attendeeCount == null) {
      return res.status(400).json({
        ok: false,
        message: "teamName, startAt, durationMinutes, attendeeCount required",
      });
    }

    const headcount = Number(attendeeCount);
    if (!Number.isFinite(headcount) || headcount < 1) {
      return res.status(400).json({ ok: false, message: "attendeeCount must be a number >= 1" });
    }

    let safeRoomId: string | null = null;
    if (roomId) {
      if (!mongoose.isValidObjectId(roomId)) {
        return res.status(400).json({ ok: false, message: "roomId must be a valid ObjectId" });
      }
      safeRoomId = String(roomId);
    }

    const dur = Number(durationMinutes);
    if (!Number.isFinite(dur) || dur < 30) {
      return res.status(400).json({ ok: false, message: "durationMinutes must be a number >= 30" });
    }

    const newStart = new Date(startAt);
    if (Number.isNaN(newStart.getTime())) {
      return res.status(400).json({ ok: false, message: "startAt must be a valid ISO date" });
    }

    const newEnd = new Date(newStart.getTime() + dur * 60 * 1000);
    const attendeeEmails = uniq(normalizeEmails(attendees));
    if (attendeeEmails.length > 5) {
      return res.status(400).json({ ok: false, message: "attendees max is 5 emails" });
    }
    for (const em of attendeeEmails) {
      if (!isValidEmail(em)) {
        return res.status(400).json({ ok: false, message: `Invalid attendee email: ${em}` });
      }
    }

    const bufferMin = Number(CONST.BUFFER_MINUTES || 0);
    const now = new Date();
    const minStartAllowed = new Date(now.getTime() + Math.max(0, bufferMin) * 60 * 1000);

    if (newStart.getTime() < minStartAllowed.getTime()) {
      return res.status(400).json({
        ok: false,
        message: `Start time must be at least ${Math.max(0, bufferMin)} minute(s) from now.`,
        now: now.toISOString(),
        minStartAllowed: minStartAllowed.toISOString(),
      });
    }

    const windowStart = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(newEnd.getTime() + 24 * 60 * 60 * 1000);
    const existing = await occupiedBetween(windowStart, windowEnd);
    const conflict = findConflict({
      newStart,
      newEnd,
      existingEvents: existing,
      bufferMinutes: bufferMin,
    });

    if (conflict) {
      return res.status(409).json({
        ok: false,
        message: `Clash with: "${conflict.title}"`,
        conflict,
      });
    }

    const safeTeam = String(teamName).trim();
    const safeTitle = meetingTitle ? String(meetingTitle).trim() : "";

    const booking = await Booking.create({
      userId: actor.id,
      roomId: safeRoomId,
      attendeeCount: headcount,
      attendees: attendeeEmails,
      teamName: safeTeam,
      meetingTitle: safeTitle,
      durationMinutes: dur,
      startAt: newStart,
      endAt: newEnd,
      meetingLink: meetingLink || null,
      status: "CONFIRMED",
    });

    await writeLog({
      req,
      action: "BOOKING_CREATED",
      description: `Booking created: ${booking.teamName} (${headcount} people) | ${newStart.toISOString()} - ${newEnd.toISOString()}`,
      entityType: "BOOKING",
      entityId: booking._id,
      meta: { roomId: booking.roomId || null, attendeeCount: headcount, attendees: attendeeEmails },
    });

    await createRemindersForBooking({
      userId: actor.id,
      bookingId: booking._id,
      startAt: newStart,
      endAt: newEnd,
    });

    try {
      const user = await User.findById(actor.id);
      const recipients = uniq([
        ...attendeeEmails,
        ...(user?.email ? [String(user.email).trim().toLowerCase()] : []),
      ]);

      const subject = buildBookingSubject(booking);
      for (const email of recipients) {
        await sendEmail({
          to: email,
          subject,
          html: buildBookingEmailHtml({ user, recipientName: null, booking }),
          text: buildBookingEmailText({ user, recipientName: null, booking }),
        });
      }

      if (user?.phone) {
        await sendSms({
          to: user.phone,
          message: `Booking confirmed: ${booking.teamName} (${headcount} people).`,
        });
      }
    } catch (notifyErr) {
      console.error("Confirmation notify error:", errorMessage(notifyErr));
    }

    return res.json({ ok: true, booking });
  } catch (e) {
    console.error("[/api/bookings] ERROR", errorMessage(e));
    return res.status(500).json({ ok: false, message: errorMessage(e) || "Internal Server Error" });
  }
});

router.get("/bookings/mine", authRequired, async (req, res) => {
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const items = await Booking.find({ userId: actor.id }).sort({ startAt: 1 }).limit(200);
    return res.json({ ok: true, bookings: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

router.delete("/bookings/:id", authRequired, async (req, res) => {
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

    const isOwner = booking.userId.toString() === actor.id;
    const isAdmin = actor.role === "ADMIN";
    if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, message: "Forbidden" });

    try {
      await cancelRemindersForBooking(booking._id);
    } catch (e) {
      console.warn("cancelRemindersForBooking failed:", errorMessage(e));
    }

    await writeLog({
      req,
      action: "BOOKING_CANCELLED",
      description: `Booking cancelled: ${booking.teamName || "team"} (${
        booking.attendeeCount || "?"
      } people) | ${new Date(booking.startAt).toISOString()} - ${new Date(booking.endAt).toISOString()}`,
      entityType: "BOOKING",
      entityId: booking._id,
      meta: { roomId: booking.roomId || null, attendeeCount: booking.attendeeCount || null },
    });

    if (isAdmin) {
      await Booking.findByIdAndDelete(booking._id);
      return res.json({ ok: true, deleted: true });
    }

    if (booking.status === "CANCELLED") return res.json({ ok: true, booking });

    booking.status = "CANCELLED";
    await booking.save();
    return res.json({ ok: true, booking });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

export default router;
