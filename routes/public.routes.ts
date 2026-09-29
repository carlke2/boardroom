import { Router } from "express";
import { listEvents } from "../services/googleCalendar.js";
import { dayRangeUTC } from "../services/slots.js";
import { asString, errorMessage } from "../utils/errors.js";

const router = Router();

router.get("/day", async (req, res) => {
  try {
    const date = asString(req.query.date);
    if (!date) return res.status(400).json({ ok: false, message: "date=YYYY-MM-DD required" });

    const { start, end } = dayRangeUTC(date);
    const events = await listEvents(start.toISOString(), end.toISOString());
    const items = events.map((e) => ({
      title: e.title,
      startAt: e.startAt,
      endAt: e.endAt,
    }));

    return res.json({ ok: true, date, booked: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

export default router;
