const express = require("express");
const Room = require("../models/Room");
const { authRequired } = require("../middleware/auth");
const { adminRequired } = require("../middleware/admin");
const { writeLog } = require("../services/activityLog");

const router = express.Router();

// list rooms (logged-in)
router.get("/rooms", authRequired(), async (req, res) => {
  try {
    const rooms = await Room.find({}).sort({ name: 1 });
    return res.json({ ok: true, rooms });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

// create room (admin)
router.post("/rooms", authRequired(), adminRequired(), async (req, res) => {
  try {
    const { name, capacity, location = "", notes = "" } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, message: "name required" });

    const room = await Room.create({
      name: String(name).trim(),
      capacity: Number(capacity || 0),
      location,
      notes,
      isActive: true,
    });

    await writeLog({
      req,
      action: "ROOM_CREATED",
      description: `Room created: ${room.name} (Cap ${room.capacity || 0})`,
      entityType: "ROOM",
      entityId: room._id,
    });

    return res.status(201).json({ ok: true, room });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ ok: false, message: "Room name already exists" });
    }
    return res.status(500).json({ ok: false, message: e.message });
  }
});

// update room (admin)
router.patch("/rooms/:id", authRequired(), adminRequired(), async (req, res) => {
  try {
    const patch = {};
    if (req.body?.name != null) patch.name = String(req.body.name).trim();
    if (req.body?.capacity != null) patch.capacity = Number(req.body.capacity || 0);
    if (req.body?.isActive != null) patch.isActive = Boolean(req.body.isActive);
    if (req.body?.location != null) patch.location = String(req.body.location);
    if (req.body?.notes != null) patch.notes = String(req.body.notes);

    const room = await Room.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!room) return res.status(404).json({ ok: false, message: "Room not found" });

    await writeLog({
      req,
      action: "ROOM_UPDATED",
      description: `Room updated: ${room.name} (Cap ${room.capacity || 0})`,
      entityType: "ROOM",
      entityId: room._id,
      meta: patch,
    });

    return res.json({ ok: true, room });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

// delete room (admin)
router.delete("/rooms/:id", authRequired(), adminRequired(), async (req, res) => {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) return res.status(404).json({ ok: false, message: "Room not found" });

    await writeLog({
      req,
      action: "ROOM_DELETED",
      description: `Room deleted: ${room.name} (Cap ${room.capacity || 0})`,
      entityType: "ROOM",
      entityId: room._id,
    });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
