import { Router } from "express";
import Notification from "../models/Notification.js";
import { authRequired } from "../middleware/auth.js";
import { requireUser, wrapTicket } from "./ticketHttp.js";

const router = Router();

router.get(
  "/notifications",
  authRequired(),
  wrapTicket(async (req, res) => {
    const actor = requireUser(req);
    const items = await Notification.find({ userId: actor.id }).sort({ createdAt: -1 }).limit(100);
    res.json({ ok: true, notifications: items });
  })
);

router.post(
  "/notifications/:id/read",
  authRequired(),
  wrapTicket(async (req, res) => {
    const actor = requireUser(req);
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: actor.id },
      { readAt: new Date() },
      { new: true }
    );
    if (!item) {
      res.status(404).json({ ok: false, message: "Notification not found" });
      return;
    }
    res.json({ ok: true, notification: item });
  })
);

export default router;
