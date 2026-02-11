const express = require("express");
const Booking = require("../models/Booking");
const ActivityLog = require("../models/ActivityLog");
const { authRequired } = require("../middleware/auth");
const { adminRequired } = require("../middleware/admin");

const router = express.Router();

// GET /api/admin/bookings?from=ISO&to=ISO
router.get("/admin/bookings", authRequired(), adminRequired(), async (req, res) => {
  try {
    const { from, to } = req.query || {};
    if (!from || !to) {
      return res.status(400).json({ ok: false, message: "from and to query params required (ISO)" });
    }

    const fromD = new Date(from);
    const toD = new Date(to);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return res.status(400).json({ ok: false, message: "from/to must be valid ISO dates" });
    }

    const bookings = await Booking.find({
      startAt: { $lt: toD },
      endAt: { $gt: fromD }
    })
      .sort({ startAt: 1 })
      .populate("userId", "name email phone role")
      .populate("roomId", "name capacity");

    res.json({ ok: true, bookings });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// ✅ GET /api/admin/activity?limit=50&skip=0
router.get("/admin/activity", authRequired(), adminRequired(), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = Math.max(0, Number(req.query.skip || 0));

    const items = await ActivityLog.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("actorId", "name email role");

    const total = await ActivityLog.countDocuments({});

    return res.json({ ok: true, total, items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
