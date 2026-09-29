import "dotenv/config";
import express from "express";
import cors from "cors";

import { connectMongo } from "./db/mongo.js";
import { requestMeta } from "./middleware/requestMeta.js";
import authRoutes from "./routes/auth.routes.js";
import bookingRoutes from "./routes/bookings.routes.js";
import reminderRoutes from "./routes/reminders.routes.js";
import publicRoutes from "./routes/public.routes.js";
import roomRoutes from "./routes/rooms.routes.js";
import passwordResetRoutes from "./routes/passwordReset.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { startReminderCron } from "./jobs/reminderCron.js";
import { startTicketJobs } from "./jobs/ticketJobs.js";
import ticketRoutes from "./routes/tickets.routes.js";
import ticketAdminRoutes from "./routes/ticketAdmin.routes.js";
import ticketConfigRoutes from "./routes/ticketConfig.routes.js";
import notificationRoutes from "./routes/notifications.routes.js";
import userAdminRoutes from "./routes/userAdmin.routes.js";
import { registerTicketNotifications } from "./services/tickets/notify.js";

const app = express();

app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "8mb" }));
app.use(requestMeta);

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use("/auth", authRoutes);
app.use("/auth", passwordResetRoutes);
app.use("/api", bookingRoutes);
app.use("/api", reminderRoutes);
app.use("/api", roomRoutes);
app.use("/api", adminRoutes);
app.use("/public", publicRoutes);
app.use(ticketRoutes);
app.use(ticketAdminRoutes);
app.use(ticketConfigRoutes);
app.use(notificationRoutes);
app.use(userAdminRoutes);

const PORT = process.env.PORT || 5000;

await connectMongo();
registerTicketNotifications();
startReminderCron();
startTicketJobs();
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
