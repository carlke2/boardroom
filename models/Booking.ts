import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export type BookingStatus = "CONFIRMED" | "CANCELLED";

export interface IBooking {
  userId: Types.ObjectId;
  roomId: Types.ObjectId | null;
  attendeeCount: number;
  attendees: string[];
  teamName: string;
  meetingTitle: string;
  durationMinutes: number;
  startAt: Date;
  endAt: Date;
  meetingLink: string | null;
  status: BookingStatus;
  googleEventId: string;
}

const BookingSchema = new Schema<IBooking>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    roomId: { type: Schema.Types.ObjectId, ref: "Room", default: null, index: true },
    attendeeCount: { type: Number, required: true, min: 1 },
    attendees: {
      type: [String],
      default: [],
      validate: {
        validator(arr: unknown) {
          return Array.isArray(arr) && arr.length <= 5;
        },
        message: "attendees must be an array with max 5 emails",
      },
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

export type BookingDocument = HydratedDocument<IBooking>;
export default mongoose.model<IBooking>("Booking", BookingSchema);
