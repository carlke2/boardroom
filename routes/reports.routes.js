const express = require("express");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const Booking = require("../models/Booking");
const { authRequired } = require("../middleware/auth");
const { adminRequired } = require("../middleware/admin"); // <-- use your real admin middleware

const router = express.Router();

function fmtTimeRange(startAt, endAt) {
  const s = new Date(startAt);
  const e = new Date(endAt);
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${hhmm(s)}-${hhmm(e)}`;
}

function safeText(v) {
  if (v == null) return "—";
  const s = String(v).trim();
  return s ? s : "—";
}

function parseRange(req, res) {
  const { from, to } = req.query || {};
  if (!from || !to) {
    res.status(400).json({ ok: false, message: "from and to query params required (ISO)" });
    return null;
  }

  const fromD = new Date(from);
  const toD = new Date(to);

  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
    res.status(400).json({ ok: false, message: "from/to must be valid ISO dates" });
    return null;
  }

  return { fromD, toD };
}

// GET /api/admin/reports/bookings.pdf?from=ISO&to=ISO
router.get("/admin/reports/bookings.pdf", authRequired(), adminRequired(), async (req, res) => {
  const range = parseRange(req, res);
  if (!range) return;

  const { fromD, toD } = range;

  const bookings = await Booking.find({
    startAt: { $lt: toD },
    endAt: { $gt: fromD },
    status: { $ne: "CANCELLED" },
  })
    .sort({ startAt: 1 })
    .populate("userId", "name email")
    .populate("roomId", "name capacity");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="bookings_${fromD.toISOString()}_${toD.toISOString()}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);

  // Title
  doc.fontSize(20).text("Boardroom Booking Report");
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor("#444").text(`Period: ${fromD.toISOString()}  -  ${toD.toISOString()}`);
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown(1);
  doc.fillColor("#000").fontSize(12).text(`Total bookings: ${bookings.length}`);
  doc.moveDown(1);

  // Table header
  const startX = doc.x;
  let y = doc.y;

  // Columns (add People + Meeting)
  const cols = [
    { key: "time", title: "Time", w: 70 },
    { key: "team", title: "Team", w: 110 },
    { key: "meeting", title: "Meeting", w: 100 },
    { key: "people", title: "People", w: 50 },
    { key: "room", title: "Room", w: 90 },
    { key: "cap", title: "Cap", w: 40 },
    { key: "email", title: "Email", w: 120 },
    { key: "status", title: "Status", w: 70 },
  ];

  doc.fontSize(10).fillColor("#111");

  // draw header
  let x = startX;
  cols.forEach((c) => {
    doc.text(c.title, x, y, { width: c.w, ellipsis: true });
    x += c.w;
  });

  y += 16;
  doc.moveTo(startX, y).lineTo(startX + cols.reduce((a, c) => a + c.w, 0), y).strokeColor("#ddd").stroke();
  y += 10;

  // rows
  doc.fontSize(9).fillColor("#000");

  for (const b of bookings) {
    // page break
    if (y > 760) {
      doc.addPage();
      y = 50;
    }

    const row = {
      time: fmtTimeRange(b.startAt, b.endAt),
      team: safeText(b.teamName),
      meeting: safeText(b.meetingTitle),
      people: b.attendeeCount != null ? String(b.attendeeCount) : "—",
      room: safeText(b.roomId?.name),
      cap: b.roomId?.capacity != null ? String(b.roomId.capacity) : "—",
      email: safeText(b.userId?.email),
      status: safeText(b.status),
    };

    x = startX;
    cols.forEach((c) => {
      doc.text(row[c.key], x, y, { width: c.w, ellipsis: true });
      x += c.w;
    });

    y += 18;
  }

  doc.end();
});

// GET /api/admin/reports/bookings.xlsx?from=ISO&to=ISO
router.get("/admin/reports/bookings.xlsx", authRequired(), adminRequired(), async (req, res) => {
  const range = parseRange(req, res);
  if (!range) return;

  const { fromD, toD } = range;

  const bookings = await Booking.find({
    startAt: { $lt: toD },
    endAt: { $gt: fromD },
    status: { $ne: "CANCELLED" },
  })
    .sort({ startAt: 1 })
    .populate("userId", "name email")
    .populate("roomId", "name capacity");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bookings");

  ws.columns = [
    { header: "Time", key: "time", width: 12 },
    { header: "Team", key: "team", width: 22 },
    { header: "Meeting", key: "meeting", width: 22 },
    { header: "People", key: "people", width: 10 },
    { header: "Room", key: "room", width: 18 },
    { header: "Cap", key: "cap", width: 8 },
    { header: "Email", key: "email", width: 28 },
    { header: "Status", key: "status", width: 14 },
  ];

  bookings.forEach((b) => {
    ws.addRow({
      time: fmtTimeRange(b.startAt, b.endAt),
      team: safeText(b.teamName),
      meeting: safeText(b.meetingTitle),
      people: b.attendeeCount ?? "",
      room: safeText(b.roomId?.name),
      cap: b.roomId?.capacity ?? "",
      email: safeText(b.userId?.email),
      status: safeText(b.status),
    });
  });

  // header styling
  ws.getRow(1).font = { bold: true };

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bookings_${fromD.toISOString()}_${toD.toISOString()}.xlsx"`
  );

  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
