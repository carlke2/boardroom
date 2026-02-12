const express = require("express");
const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const ActivityLog = require("../models/ActivityLog");

const { authRequired } = require("../middleware/auth");

const router = express.Router();

/* ======================================================
   Helpers
====================================================== */

function adminOnly(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ ok: false, message: "Admin only" });
  }
  next();
}

function parseISOOr400(v, name) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) {
    const e = new Error(`${name} must be valid ISO date`);
    e.status = 400;
    throw e;
  }
  return d;
}

/* ======================================================
   ADMIN BOOKINGS LIST  (for AdminSchedule table)
   GET /api/admin/bookings?from=&to=
====================================================== */

router.get("/admin/bookings", authRequired, adminOnly, async (req, res) => {
  try {
    const from = parseISOOr400(req.query.from, "from");
    const to = parseISOOr400(req.query.to, "to");

    const bookings = await Booking.find({
      startAt: { $gte: from, $lt: to }
    })
      .sort({ startAt: 1 })
      .populate("userId", "name email phone")
      .populate("roomId", "name capacity location notes");

    return res.json({ ok: true, bookings });
  } catch (e) {
    return res.status(e.status || 500).json({ ok: false, message: e.message });
  }
});

/* ======================================================
   ADMIN BOOKING DETAILS (View button)
   GET /api/admin/bookings/:id
====================================================== */

router.get("/admin/bookings/:id", authRequired, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ ok: false, message: "Invalid id" });

    const booking = await Booking.findById(req.params.id)
      .populate("userId", "name email phone")
      .populate("roomId", "name capacity location notes");

    if (!booking)
      return res.status(404).json({ ok: false, message: "Booking not found" });

    return res.json({ ok: true, booking });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/* ======================================================
   ADMIN ACTIVITY LOGS  ✅ FIXES YOUR ERROR
   GET /api/admin/activity
====================================================== */

router.get("/admin/activity", authRequired, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const skip = Math.max(0, Number(req.query.skip || 0));

    const [total, items] = await Promise.all([
      ActivityLog.countDocuments({}),
      ActivityLog.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    return res.json({ ok: true, total, items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/* ======================================================
   PDF EXPORT
   npm i pdfkit
   GET /api/admin/reports/bookings.pdf
====================================================== */

router.get("/admin/reports/bookings.pdf", authRequired, adminOnly, async (req, res) => {
  try {
    const PDFDocument = require("pdfkit");

    const from = parseISOOr400(req.query.from, "from");
    const to = parseISOOr400(req.query.to, "to");

    const bookings = await Booking.find({
      startAt: { $gte: from, $lt: to }
    })
      .sort({ startAt: 1 })
      .populate("roomId", "name capacity");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="bookings-report.pdf"');

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(16).text("Bookings Report");
    doc.moveDown();

    bookings.forEach((b) => {
      doc.fontSize(10).text(
        `${new Date(b.startAt).toLocaleString()} | ${b.teamName} | ${b.attendeeCount} | ${b.status} | ${b.roomId?.name || ""}`
      );
    });

    doc.end();
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/* ======================================================
   EXCEL EXPORT
   npm i exceljs
   GET /api/admin/reports/bookings.xlsx
====================================================== */

router.get("/admin/reports/bookings.xlsx", authRequired, adminOnly, async (req, res) => {
  try {
    const ExcelJS = require("exceljs");

    const from = parseISOOr400(req.query.from, "from");
    const to = parseISOOr400(req.query.to, "to");

    const bookings = await Booking.find({
      startAt: { $gte: from, $lt: to }
    })
      .sort({ startAt: 1 })
      .populate("roomId", "name capacity");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bookings");

    ws.columns = [
      { header: "Start", key: "start", width: 22 },
      { header: "Team", key: "team", width: 20 },
      { header: "People", key: "people", width: 10 },
      { header: "Status", key: "status", width: 14 },
      { header: "Room", key: "room", width: 20 }
    ];

    bookings.forEach((b) => {
      ws.addRow({
        start: new Date(b.startAt).toLocaleString(),
        team: b.teamName,
        people: b.attendeeCount,
        status: b.status,
        room: b.roomId?.name || ""
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bookings-report.xlsx"'
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
