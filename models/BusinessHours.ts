import mongoose, { Schema, type HydratedDocument } from "mongoose";

export interface HoursWindow {
  day: number;
  start: string;
  end: string;
}

export interface IBusinessHours {
  name: string;
  timezone: string;
  windows: HoursWindow[];
}

const BusinessHoursSchema = new Schema<IBusinessHours>(
  {
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: "Africa/Nairobi" },
    windows: {
      type: [
        {
          day: { type: Number, required: true, min: 0, max: 6 },
          start: { type: String, required: true },
          end: { type: String, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export type BusinessHoursDocument = HydratedDocument<IBusinessHours>;
export default mongoose.model<IBusinessHours>("BusinessHours", BusinessHoursSchema);
