import mongoose, { Schema, type HydratedDocument } from "mongoose";

export interface IRoom {
  name: string;
  capacity: number;
  isActive: boolean;
  location: string;
  notes: string;
}

const roomSchema = new Schema<IRoom>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    capacity: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
    location: { type: String, default: "" },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

export type RoomDocument = HydratedDocument<IRoom>;
export default mongoose.model<IRoom>("Room", roomSchema);
