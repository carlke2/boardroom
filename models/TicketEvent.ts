import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ITicketEvent {
  ticketId: Types.ObjectId;
  actorId: Types.ObjectId | null;
  type: string;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown>;
}

const TicketEventSchema = new Schema<ITicketEvent>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    type: { type: String, required: true },
    fromValue: { type: String, default: null },
    toValue: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type TicketEventDocument = HydratedDocument<ITicketEvent>;
export default mongoose.model<ITicketEvent>("TicketEvent", TicketEventSchema);
