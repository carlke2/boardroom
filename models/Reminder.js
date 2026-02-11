const mongoose = require("mongoose");

const ReminderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    type: { type: String, enum: ["STARTS_20", "JOIN_NOW", "ENDING_10"], required: true },
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: ["PENDING", "SENT", "CANCELLED"], default: "PENDING" },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reminder", ReminderSchema);
