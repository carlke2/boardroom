import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import { TICKET_PRIORITIES, type TicketPriority } from "../types/tickets.js";

export interface ISlaPolicy {
  priority: TicketPriority;
  responseMinutes: number;
  resolutionMinutes: number;
  businessHoursId: Types.ObjectId | null;
}

const SlaPolicySchema = new Schema<ISlaPolicy>(
  {
    priority: { type: String, enum: TICKET_PRIORITIES, required: true, unique: true },
    responseMinutes: { type: Number, required: true, min: 1 },
    resolutionMinutes: { type: Number, required: true, min: 1 },
    businessHoursId: { type: Schema.Types.ObjectId, ref: "BusinessHours", default: null },
  },
  { timestamps: true }
);

export type SlaPolicyDocument = HydratedDocument<ISlaPolicy>;
export default mongoose.model<ISlaPolicy>("SlaPolicy", SlaPolicySchema);
