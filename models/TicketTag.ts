import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ITicketTag {
  ticketId: Types.ObjectId;
  tag: string;
}

const TicketTagSchema = new Schema<ITicketTag>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true },
    tag: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TicketTagSchema.index({ ticketId: 1, tag: 1 }, { unique: true });

export type TicketTagDocument = HydratedDocument<ITicketTag>;
export default mongoose.model<ITicketTag>("TicketTag", TicketTagSchema);
