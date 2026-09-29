import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ITicketComment {
  ticketId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  isInternal: boolean;
}

const TicketCommentSchema = new Schema<ITicketComment>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true },
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export type TicketCommentDocument = HydratedDocument<ITicketComment>;
export default mongoose.model<ITicketComment>("TicketComment", TicketCommentSchema);
