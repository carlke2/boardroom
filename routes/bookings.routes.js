const express = require("express");
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const User = require("../models/User");

const { authRequired } = require("../middleware/auth");
const { CONST } = require("../config/constants");

const { listEvents, createEvent, deleteEvent } = require("../services/googleCalendar");
const { dayRangeUTC, computeFreeSlots } = require("../services/slots");
const { findConflict } = require("../services/overlap");

const { createRemindersForBooking, cancelRemindersForBooking } = require("../services/reminders");
const { writeLog } = require("../services/activityLog");

// notifications
const { sendEmail } = require("../services/notify/email");
const { sendSms } = require("../services/notify/sms");
const {
  buildBookingSubject,
  buildBookingEmailHtml,
  buildBookingEmailText,
} = require("../services/notify/templates");

const router = express.Router();

/**
 * Helpers
 */
function isYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeEmails(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : String(input).split(",");
  return arr
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
}

function isValidEmail(email) {
  // simple pragmatic validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  for (const x of list || []) {
    if (!x) continue;
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

// Timeline
router.get("/day", authRequired, async (req, res) => {
  try {
    const date = req.query.date;

    if (!date) {
      return res.status(400).json({ ok: false, message: "date=YYYY-MM-DD required" });
    }

    if (!isYYYYMMDD(date)) {
      return res.status(400).json({ ok: false, message: "date must be YYYY-MM-DD" });
    }

    const { start, end } = dayRangeUTC(date);

    const events = await listEvents(start.toISOString(), end.toISOString());

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
    console.error("[/api/day] ERROR", {
      message: e?.message,
      stack: e?.stack,
      googleStatus: e?.response?.status,
      googleData: e?.response?.data,
    });

    return res.status(500).json({ ok: false, message: e?.message || "Internal Server Error" });
  }
});

// Create booking
router.post("/bookings", authRequired, async (req, res) => {
  try {
    const {
      roomId,
      attendeeCount,
      teamName,
      meetingTitle,
      startAt,
      durationMinutes,
      meetingLink,

      // ✅ NEW: attendee emails (array or comma string)
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

    let safeRoomId = null;
    if (roomId) {
      if (!mongoose.isValidObjectId(roomId)) {
        return res.status(400).json({ ok: false, message: "roomId must be a valid ObjectId" });
      }
      safeRoomId = roomId;
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

    // ✅ attendee emails validation (max 5)
    const attendeeEmails = uniq(normalizeEmails(attendees));
    if (attendeeEmails.length > 5) {
      return res.status(400).json({ ok: false, message: "attendees max is 5 emails" });
    }
    for (const em of attendeeEmails) {
      if (!isValidEmail(em)) {
        return res.status(400).json({ ok: false, message: `Invalid attendee email: ${em}` });
      }
    }

    // block booking in the past or too soon (buffer)
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

    // Fetch events around the time window to check conflict
    const windowStart = new Date(newStart.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(newEnd.getTime() + 24 * 60 * 60 * 1000);

    const existing = await listEvents(windowStart.toISOString(), windowEnd.toISOString());
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
    const eventTitle = safeTitle ? `${safeTeam} — ${safeTitle}` : safeTeam;

    const googleEventId = await createEvent({
      title: eventTitle,
      startAtISO: newStart.toISOString(),
      endAtISO: newEnd.toISOString(),
      meetingLink: meetingLink || null,
    });

    const booking = await Booking.create({
      userId: req.user.id,
      roomId: safeRoomId,
      attendeeCount: headcount,
      attendees: attendeeEmails, // ✅ persisted
      teamName: safeTeam,
      meetingTitle: safeTitle,
      durationMinutes: dur,
      startAt: newStart,
      endAt: newEnd,
      meetingLink: meetingLink || null,
      googleEventId,
      status: "CONFIRMED",
    });

    // Activity log
    await writeLog({
      req,
      action: "BOOKING_CREATED",
      description: `Booking created: ${booking.teamName} (${headcount} people) | ${newStart.toISOString()} - ${newEnd.toISOString()}`,
      entityType: "BOOKING",
      entityId: booking._id,
      meta: { roomId: booking.roomId || null, attendeeCount: headcount, attendees: attendeeEmails },
    });

    // ✅ Create reminder job for ENDING_20 (20 mins before exit)
    await createRemindersForBooking({
      userId: req.user.id,
      bookingId: booking._id,
      startAt: newStart,
      endAt: newEnd,
    });

    // ✅ Email confirmation to ALL attendees (+ booker if not in list)
    try {
      const user = await User.findById(req.user.id);

      const recipients = uniq([
        ...(attendeeEmails || []),
        ...(user?.email ? [String(user.email).trim().toLowerCase()] : []),
      ]);

      const subject = buildBookingSubject(booking);

      // Send one-by-one for privacy
      for (const email of recipients) {
        await sendEmail({
          to: email,
          subject,
          html: buildBookingEmailHtml({ user, recipientName: null, booking }),
          text: buildBookingEmailText({ user, recipientName: null, booking }),
        });
      }

      // optional SMS confirmation to booker only
      if (user?.phone) {
        await sendSms({
          to: user.phone,
          message: `Booking confirmed: ${booking.teamName} (${headcount} people).`,
        });
      }
    } catch (notifyErr) {
      console.error("Confirmation notify error:", notifyErr.message);
    }

    return res.json({ ok: true, booking });
  } catch (e) {
    console.error("[/api/bookings] ERROR", e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || "Internal Server Error" });
  }
});

// My bookings
router.get("/bookings/mine", authRequired, async (req, res) => {
  try {
    const items = await Booking.find({ userId: req.user.id }).sort({ startAt: 1 }).limit(200);
    return res.json({ ok: true, bookings: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

// Cancel booking
router.delete("/bookings/:id", authRequired, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

    const isOwner = booking.userId.toString() === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, message: "Forbidden" });

    try {
      if (booking.googleEventId) await deleteEvent(booking.googleEventId);
    } catch (e) {
      console.warn("deleteEvent failed:", e?.message || e);
    }

    try {
      await cancelRemindersForBooking(booking._id);
    } catch (e) {
      console.warn("cancelRemindersForBooking failed:", e?.message || e);
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
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
