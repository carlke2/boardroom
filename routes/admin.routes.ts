import { Router, type NextFunction, type Request, type Response } from "express";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import Booking from "../models/Booking.js";
import ActivityLog from "../models/ActivityLog.js";
import { authRequired } from "../middleware/auth.js";
import { asString, errorMessage } from "../utils/errors.js";

const router = Router();

interface ReportBooking {
  startAt: Date;
  endAt: Date;
  teamName?: string;
  attendeeCount?: number;
  status?: string;
  userId?: { name?: string; email?: string; phone?: string } | null;
  roomId?: { name?: string; capacity?: number; location?: string; notes?: string } | null;
}

function adminOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ ok: false, message: "Admin only" });
    return;
  }
  next();
}

function parseISOOr400(v: unknown, name: string): Date {
  const d = new Date(typeof v === "string" ? v : "");
  if (!v || Number.isNaN(d.getTime())) {
    const e = new Error(`${name} must be valid ISO date`) as Error & { status?: number };
    e.status = 400;
    throw e;
  }
  return d;
}

function statusOf(e: unknown): number {
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return 500;
}

function safeText(v: unknown): string {
  if (v == null) return "—";
  const s = String(v).trim();
  return s ? s : "—";
}

function minutesBetween(a: Date | string, b: Date | string): number {
  const A = new Date(a).getTime();
  const B = new Date(b).getTime();
  if (Number.isNaN(A) || Number.isNaN(B)) return 0;
  return Math.max(0, Math.round((B - A) / 60000));
}

function sumMinutes(bookings: ReportBooking[]): number {
  return bookings.reduce((acc, b) => acc + minutesBetween(b.startAt, b.endAt), 0);
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const TZ = "Africa/Nairobi";

function fmtDateOnly(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: TZ,
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function fmtDateTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function fmtTimeOnly(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

function fmtTimeRange(startAt: Date | string, endAt: Date | string): string {
  return `${fmtTimeOnly(new Date(startAt))}-${fmtTimeOnly(new Date(endAt))}`;
}

function periodLabel(from: Date, to: Date): string {
  return `${fmtDateOnly(from)}  –  ${fmtDateOnly(to)}`;
}

router.get("/admin/bookings", authRequired, adminOnly, async (req, res) => {
  try {
    const from = parseISOOr400(asString(req.query.from), "from");
    const to = parseISOOr400(asString(req.query.to), "to");

    const bookings = await Booking.find({
      startAt: { $gte: from, $lt: to },
    })
      .sort({ startAt: 1 })
      .populate("userId", "name email phone")
      .populate("roomId", "name capacity location notes");

    return res.json({ ok: true, bookings });
  } catch (e) {
    return res.status(statusOf(e)).json({ ok: false, message: errorMessage(e) });
  }
});

router.get("/admin/bookings/:id", authRequired, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const booking = await Booking.findById(req.params.id)
      .populate("userId", "name email phone")
      .populate("roomId", "name capacity location notes");

    if (!booking) return res.status(404).json({ ok: false, message: "Booking not found" });
    return res.json({ ok: true, booking });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

router.get("/admin/activity", authRequired, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(asString(req.query.limit) || 50)));
    const skip = Math.max(0, Number(asString(req.query.skip) || 0));

    const [total, items] = await Promise.all([
      ActivityLog.countDocuments({}),
      ActivityLog.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return res.json({ ok: true, total, items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

router.get("/admin/reports/bookings.pdf", authRequired, adminOnly, async (req, res) => {
  try {
    const from = parseISOOr400(asString(req.query.from), "from");
    const to = parseISOOr400(asString(req.query.to), "to");

    const bookings = (await Booking.find({
      startAt: { $gte: from, $lt: to },
    })
      .sort({ startAt: 1 })
      .populate("userId", "name email")
      .populate("roomId", "name capacity")
      .lean()) as unknown as ReportBooking[];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="bookings-report.pdf"');

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 50,
      bufferPages: true,
    });

    doc.pipe(res);

    const M = doc.page.margins.left;
    const PAGE_W = doc.page.width;
    const PAGE_H = doc.page.height;
    const CONTENT_W = PAGE_W - doc.page.margins.left - doc.page.margins.right;
    const FOOTER_H = 28;

    function bottomLimit(): number {
      return PAGE_H - doc.page.margins.bottom - FOOTER_H;
    }

    function drawHeader(): void {
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(22).text("Boardroom Booking Report", M, 50);
      doc.moveTo(M, 82).lineTo(M + CONTENT_W, 82).strokeColor("#D1D5DB").lineWidth(1).stroke();
      doc.font("Helvetica").fontSize(11).fillColor("#111");
      doc.text(`Period: ${periodLabel(from, to)}`, M, 94);
      doc.text(`Generated: ${fmtDateTime(new Date())} (${TZ})`, M, 110);
      doc.moveDown(1.0);

      const totalMins = sumMinutes(bookings);
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#000");
      doc.text(`Total bookings: ${bookings.length}`, M, 136);
      doc.font("Helvetica").fontSize(10).fillColor("#333");
      doc.text(`Total duration: ${fmtDuration(totalMins)}`, M, 152);
      doc.moveDown(1.2);
      doc.y = 176;
    }

    const cols: Array<{ key: string; title: string; w: number; align: "left" | "right" }> = [
      { key: "time", title: "Time", w: 95, align: "left" },
      { key: "team", title: "Team", w: 170, align: "left" },
      { key: "room", title: "Room", w: 160, align: "left" },
      { key: "cap", title: "Cap", w: 55, align: "right" },
      { key: "email", title: "Email", w: 230, align: "left" },
      { key: "status", title: "Status", w: 110, align: "left" },
    ];

    const totalW = cols.reduce((a, c) => a + c.w, 0);
    if (totalW > CONTENT_W) {
      const overflow = totalW - CONTENT_W;
      const shrinkTargets = ["email", "team", "room"];
      let remaining = overflow;
      for (const key of shrinkTargets) {
        if (remaining <= 0) break;
        const col = cols.find((c) => c.key === key);
        if (!col) continue;
        const canShrink = Math.max(0, col.w - 120);
        const shrink = Math.min(canShrink, remaining);
        col.w -= shrink;
        remaining -= shrink;
      }
    }

    function drawTableHeader(y: number): number {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
      let x = M;
      cols.forEach((c) => {
        doc.text(c.title, x, y, { width: c.w, align: c.align });
        x += c.w;
      });
      const lineY = y + 16;
      doc.moveTo(M, lineY).lineTo(M + CONTENT_W, lineY).strokeColor("#D1D5DB").lineWidth(1).stroke();
      return lineY + 8;
    }

    function rowObj(b: ReportBooking): Record<string, string> {
      return {
        time: fmtTimeRange(b.startAt, b.endAt),
        team: safeText(b.teamName),
        room: safeText(b.roomId?.name),
        cap: b.roomId?.capacity != null ? String(b.roomId.capacity) : "—",
        email: safeText(b.userId?.email),
        status: safeText(b.status),
      };
    }

    function rowHeight(row: Record<string, string>): number {
      doc.font("Helvetica").fontSize(10);
      const heights = cols.map((c) => doc.heightOfString(safeText(row[c.key]), { width: c.w }));
      return Math.max(18, Math.max(...heights) + 6);
    }

    function drawRow(row: Record<string, string>, y: number): number {
      doc.font("Helvetica").fontSize(10).fillColor("#000");
      let x = M;
      cols.forEach((c) => {
        doc.text(safeText(row[c.key]), x, y, { width: c.w, align: c.align, ellipsis: true });
        x += c.w;
      });
      return y + rowHeight(row);
    }

    drawHeader();
    let y = doc.y;
    y = drawTableHeader(y);

    if (!bookings.length) {
      doc.font("Helvetica").fontSize(11).fillColor("#444");
      doc.text("No bookings found for this period.", M, y + 8);
    } else {
      for (const b of bookings) {
        const r = rowObj(b);
        const needed = rowHeight(r);
        if (y + needed > bottomLimit()) {
          doc.addPage();
          drawHeader();
          y = doc.y;
          y = drawTableHeader(y);
        }
        y = drawRow(r, y);
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const pageNo = i + 1;
      const total = range.count;
      const fy = PAGE_H - doc.page.margins.bottom - 18;
      doc.font("Helvetica").fontSize(9).fillColor("#666");
      doc.text(`Page ${pageNo} of ${total}`, M, fy, { width: CONTENT_W, align: "right" });
      doc.fillColor("#000");
    }

    doc.end();
    return;
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

router.get("/admin/reports/bookings.xlsx", authRequired, adminOnly, async (req, res) => {
  try {
    const from = parseISOOr400(asString(req.query.from), "from");
    const to = parseISOOr400(asString(req.query.to), "to");

    const bookings = (await Booking.find({
      startAt: { $gte: from, $lt: to },
    })
      .sort({ startAt: 1 })
      .populate("roomId", "name capacity")
      .lean()) as unknown as ReportBooking[];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bookings");

    ws.columns = [
      { header: "Start", key: "start", width: 22 },
      { header: "Team", key: "team", width: 20 },
      { header: "People", key: "people", width: 10 },
      { header: "Status", key: "status", width: 14 },
      { header: "Room", key: "room", width: 20 },
    ];

    bookings.forEach((b) => {
      ws.addRow({
        start: new Date(b.startAt).toLocaleString(),
        team: b.teamName,
        people: b.attendeeCount,
        status: b.status,
        room: b.roomId?.name || "",
      });
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="bookings-report.xlsx"');

    await wb.xlsx.write(res);
    res.end();
    return;
  } catch (e) {
    return res.status(500).json({ ok: false, message: errorMessage(e) });
  }
});

export default router;
