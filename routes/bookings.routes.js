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
  buildBookingEmailText
} = require("../services/notify/templates");

const router = express.Router();

// Timeline
router.get("/day", authRequired, async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ ok: false, message: "date=YYYY-MM-DD required" });

    const { start, end } = dayRangeUTC(date);
    const events = await listEvents(start.toISOString(), end.toISOString());
    const { freeSlots, freeGaps, workStart, workEnd } = computeFreeSlots(date, events);

    return res.json({
      ok: true,
      date,
      workWindow: { startAt: workStart, endAt: workEnd },
      booked: events,
      freeSlots,
      freeGaps
    });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
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
      meetingLink
    } = req.body || {};

    // attendeeCount required
    if (!teamName || !startAt || !durationMinutes || attendeeCount == null) {
      return res.status(400).json({
        ok: false,
        message: "teamName, startAt, durationMinutes, attendeeCount required"
      });
    }

    const headcount = Number(attendeeCount);
    if (!Number.isFinite(headcount) || headcount < 1) {
      return res.status(400).json({ ok: false, message: "attendeeCount must be a number >= 1" });
    }

    // roomId optional in case some old flows don't send it
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

    // ✅ NEW: block booking in the past or too soon (buffer)
    // Rule: earliest allowed start = now + BUFFER_MINUTES
    const bufferMin = Number(CONST.BUFFER_MINUTES || 0);
    const now = new Date();
    const minStartAllowed = new Date(now.getTime() + Math.max(0, bufferMin) * 60 * 1000);

    if (newStart.getTime() < minStartAllowed.getTime()) {
      return res.status(400).json({
        ok: false,
        message: `Start time must be at least ${Math.max(0, bufferMin)} minute(s) from now.`,
        now: now.toISOString(),
        minStartAllowed: minStartAllowed.toISOString()
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
      bufferMinutes: bufferMin
    });

    if (conflict) {
      return res.status(409).json({
        ok: false,
        message: `Clash with: "${conflict.title}"`,
        conflict
      });
    }

    const safeTeam = String(teamName).trim();
    const safeTitle = meetingTitle ? String(meetingTitle).trim() : "";
    const eventTitle = safeTitle ? `${safeTeam} — ${safeTitle}` : safeTeam;

    const googleEventId = await createEvent({
      title: eventTitle,
      startAtISO: newStart.toISOString(),
      endAtISO: newEnd.toISOString(),
      meetingLink: meetingLink || null
    });

    const booking = await Booking.create({
      userId: req.user.id,
      roomId: safeRoomId,
      attendeeCount: headcount,
      teamName: safeTeam,
      meetingTitle: safeTitle,
      durationMinutes: dur,
      startAt: newStart,
      endAt: newEnd,
      meetingLink: meetingLink || null,
      googleEventId,
      status: "CONFIRMED"
    });

    // Activity log
    await writeLog({
      req,
      action: "BOOKING_CREATED",
      description: `Booking created: ${booking.teamName} (${headcount} people) | ${newStart.toISOString()} - ${newEnd.toISOString()}`,
      entityType: "BOOKING",
      entityId: booking._id,
      meta: { roomId: booking.roomId || null, attendeeCount: headcount }
    });

    await createRemindersForBooking({
      userId: req.user.id,
      bookingId: booking._id,
      startAt: newStart,
      endAt: newEnd
    });

    // Email + SMS confirmation (best effort)
    try {
      const user = await User.findById(req.user.id);

      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: buildBookingSubject(booking),
          html: buildBookingEmailHtml({ user, booking }),
          text: buildBookingEmailText({ user, booking })
        });
      }

      if (user?.phone) {
        await sendSms({
          to: user.phone,
          message: `Booking confirmed: ${booking.teamName} (${headcount} people).`
        });
      }
    } catch (notifyErr) {
      console.error("Confirmation notify error:", notifyErr.message);
    }

    return res.json({ ok: true, booking });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
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
// ADMIN: hard delete (disappears completely)
// USER: soft cancel (status=CANCELLED)
router.delete("/bookings/:id", authRequired, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });

    const isOwner = booking.userId.toString() === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) return res.status(403).json({ ok: false, message: "Forbidden" });

    // Best effort: delete google event (do not crash if it fails)
    try {
      if (booking.googleEventId) await deleteEvent(booking.googleEventId);
    } catch (e) {
      console.warn("deleteEvent failed:", e?.message || e);
    }

    // Best effort: cancel reminders
    try {
      await cancelRemindersForBooking(booking._id);
    } catch (e) {
      console.warn("cancelRemindersForBooking failed:", e?.message || e);
    }

    // Activity log BEFORE delete/save so we still have data
    await writeLog({
      req,
      action: "BOOKING_CANCELLED",
      description: `Booking cancelled: ${booking.teamName || "team"} (${booking.attendeeCount || "?"} people) | ${new Date(
        booking.startAt
      ).toISOString()} - ${new Date(booking.endAt).toISOString()}`,
      entityType: "BOOKING",
      entityId: booking._id,
      meta: { roomId: booking.roomId || null, attendeeCount: booking.attendeeCount || null }
    });

    if (isAdmin) {
      // hard delete
      await Booking.findByIdAndDelete(booking._id);
      return res.json({ ok: true, deleted: true });
    }

    // user soft cancel
    if (booking.status === "CANCELLED") return res.json({ ok: true, booking });

    booking.status = "CANCELLED";
    await booking.save();

    return res.json({ ok: true, booking });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
