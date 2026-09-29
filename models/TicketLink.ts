import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import { LINK_TYPES, type TicketLinkType } from "../types/tickets.js";

export interface ITicketLink {
  ticketId: Types.ObjectId;
  relatedTicketId: Types.ObjectId;
  type: TicketLinkType;
}

const TicketLinkSchema = new Schema<ITicketLink>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    relatedTicketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    type: { type: String, enum: LINK_TYPES, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TicketLinkSchema.index({ ticketId: 1, relatedTicketId: 1, type: 1 }, { unique: true });

export type TicketLinkDocument = HydratedDocument<ITicketLink>;
export default mongoose.model<ITicketLink>("TicketLink", TicketLinkSchema);
