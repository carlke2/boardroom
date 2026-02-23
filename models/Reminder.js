const mongoose = require("mongoose");

const ReminderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },

    //  Added ENDING_20 (20 mins before end time)
    type: {
      type: String,
      enum: ["STARTS_20", "JOIN_NOW", "ENDING_10", "ENDING_20"],
      required: true,
    },

    scheduledAt: { type: Date, required: true },

    //  Added FAILED (your cron already uses markReminderFailed)
    status: {
      type: String,
      enum: ["PENDING", "SENT", "CANCELLED", "FAILED"],
      default: "PENDING",
      index: true,
    },

    sentAt: { type: Date, default: null },

    // Failure tracking (used by cron)
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

// Helpful index for due reminders
ReminderSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model("Reminder", ReminderSchema);
