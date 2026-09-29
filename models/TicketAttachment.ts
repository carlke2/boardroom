import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ITicketAttachment {
  ticketId: Types.ObjectId;
  commentId: Types.ObjectId | null;
  storageKey: string;
  filename: string;
  size: number;
  mime: string;
}

const TicketAttachmentSchema = new Schema<ITicketAttachment>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    commentId: { type: Schema.Types.ObjectId, ref: "TicketComment", default: null },
    storageKey: { type: String, required: true },
    filename: { type: String, required: true },
    size: { type: Number, required: true },
    mime: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type TicketAttachmentDocument = HydratedDocument<ITicketAttachment>;
export default mongoose.model<ITicketAttachment>("TicketAttachment", TicketAttachmentSchema);
