const express = require("express");
const { listEvents } = require("../services/googleCalendar");
const { dayRangeUTC } = require("../services/slots");

const router = express.Router();

// Public calendar preview (landing page)
// GET /public/day?date=YYYY-MM-DD
router.get("/day", async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ ok: false, message: "date=YYYY-MM-DD required" });

    const { start, end } = dayRangeUTC(date);
    const events = await listEvents(start.toISOString(), end.toISOString());

    // Safe fields only
    const items = events.map((e) => ({
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt
    }));

    return res.json({ ok: true, date, booked: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
