import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import Reminder from "../models/Reminder.js";
import { asString, errorMessage } from "../utils/errors.js";

const router = Router();

router.get("/reminders/mine", authRequired(), async (req, res) => {
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ ok: false, message: "Unauthorized" });

    const upcoming = asString(req.query.upcoming).toLowerCase() === "true";
    const q: Record<string, unknown> = { userId: actor.id };

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
        populate: { path: "roomId", select: "name capacity" },
      });

    return res.json({ ok: true, reminders: items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

export default router;
