import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ICsatResponse {
  ticketId: Types.ObjectId;
  requesterId: Types.ObjectId;
  score: number;
  comment: string;
}

const CsatResponseSchema = new Schema<ICsatResponse>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: "Ticket", required: true, unique: true },
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
  },
  { timestamps: true }
);

export type CsatResponseDocument = HydratedDocument<ICsatResponse>;
export default mongoose.model<ICsatResponse>("CsatResponse", CsatResponseSchema);
