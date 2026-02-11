const express = require("express");
const { authRequired } = require("../middleware/auth");
const Reminder = require("../models/Reminder");

const router = express.Router();

/**
 * GET /api/reminders/mine?upcoming=true
 * - upcoming=true => only PENDING reminders scheduled in the future
 */
router.get("/reminders/mine", authRequired(), async (req, res) => {
  try {
    const upcoming = String(req.query.upcoming || "").toLowerCase() === "true";

    const q = { userId: req.user.id };

    if (upcoming) {
      q.status = "PENDING";
      q.scheduledAt = { $gte: new Date() };
    }

    const items = await Reminder.find(q)
      .sort({ scheduledAt: 1 })
      .limit(200)
      .populate({
        path: "bookingId",
        select: "teamName meetingTitle startAt endAt roomId attendeeCount status",
        populate: { path: "roomId", select: "name capacity" }
      });

    return res.json({ ok: true, reminders: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
