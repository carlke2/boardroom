const mongoose = require("mongoose");

const ActivityLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true }, // e.g. BOOKING_CREATED
    description: { type: String, required: true, trim: true },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: "" },

    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    entityType: { type: String, default: "" }, // e.g. BOOKING, ROOM
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    meta: { type: Object, default: {} }
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", ActivityLogSchema);
