require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { connectMongo } = require("./db/mongo");
const { requestMeta } = require("./middleware/requestMeta");

const authRoutes = require("./routes/auth.routes");
const bookingRoutes = require("./routes/bookings.routes");
const reminderRoutes = require("./routes/reminders.routes");
const publicRoutes = require("./routes/public.routes");
const roomRoutes = require("./routes/rooms.routes");
const passwordResetRoutes = require("./routes/passwordReset.routes.js");
const adminRoutes = require("./routes/admin.routes"); 

const { startReminderCron } = require("./jobs/reminderCron");

const app = express();

//  important for req.ip behind proxies (Render/Railway/etc.)
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json());

//  capture ip + user-agent for logging
app.use(requestMeta);

app.get("/health", (_, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// Routes
app.use("/auth", authRoutes);
app.use("/auth", passwordResetRoutes);

app.use("/api", bookingRoutes);
app.use("/api", reminderRoutes);
app.use("/api", roomRoutes);
app.use("/api", adminRoutes); //  mount admin endpoints under /api
app.use("/public", publicRoutes);

const PORT = process.env.PORT || 5000;

(async () => {
  await connectMongo();
  startReminderCron();
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
