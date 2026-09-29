import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface INotification {
  userId: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  ticketId: Types.ObjectId | null;
  readAt: Date | null;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type NotificationDocument = HydratedDocument<INotification>;
export default mongoose.model<INotification>("Notification", NotificationSchema);
