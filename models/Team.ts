import mongoose, { Schema, type HydratedDocument } from "mongoose";

export interface ITeam {
  name: string;
  rrIndex: number;
}

const TeamSchema = new Schema<ITeam>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    rrIndex: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type TeamDocument = HydratedDocument<ITeam>;
export default mongoose.model<ITeam>("Team", TeamSchema);
