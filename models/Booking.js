const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // keep optional if you don't want to break old bookings
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null, index: true },

    // number of people attending
    attendeeCount: { type: Number, required: true, min: 1 },

    //  NEW: attendee email list (max 5)
    attendees: {
      type: [String],
      default: [],
      validate: [
        (arr) => Array.isArray(arr) && arr.length <= 5,
        "attendees must be an array with max 5 emails",
      ],
    },

    teamName: { type: String, required: true, trim: true },
    meetingTitle: { type: String, trim: true, default: "" },
    durationMinutes: { type: Number, required: true, min: 30 },

    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    meetingLink: { type: String, default: null },

    status: { type: String, enum: ["CONFIRMED", "CANCELLED"], default: "CONFIRMED" },
    googleEventId: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", BookingSchema);
