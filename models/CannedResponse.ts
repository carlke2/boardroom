import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ICannedResponse {
  title: string;
  body: string;
  teamId: Types.ObjectId | null;
}

const CannedResponseSchema = new Schema<ICannedResponse>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
  },
  { timestamps: true }
);

export type CannedResponseDocument = HydratedDocument<ICannedResponse>;
export default mongoose.model<ICannedResponse>("CannedResponse", CannedResponseSchema);
