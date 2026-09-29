import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export type ReminderType = "STARTS_20" | "JOIN_NOW" | "ENDING_10" | "ENDING_20";
export type ReminderStatus = "PENDING" | "SENT" | "CANCELLED" | "FAILED";

export interface IReminder {
  userId: Types.ObjectId;
  bookingId: Types.ObjectId;
  type: ReminderType;
  scheduledAt: Date;
  status: ReminderStatus;
  sentAt: Date | null;
  failedAt: Date | null;
  lastError: string | null;
  meta: Record<string, unknown>;
}

const ReminderSchema = new Schema<IReminder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    type: {
      type: String,
      enum: ["STARTS_20", "JOIN_NOW", "ENDING_10", "ENDING_20"],
      required: true,
    },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SENT", "CANCELLED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    sentAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

ReminderSchema.index({ status: 1, scheduledAt: 1 });

export type ReminderDocument = HydratedDocument<IReminder>;
export default mongoose.model<IReminder>("Reminder", ReminderSchema);
