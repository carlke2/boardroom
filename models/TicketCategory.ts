import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import { TICKET_PRIORITIES, type TicketPriority } from "../types/tickets.js";

export interface ITicketCategory {
  name: string;
  defaultTeamId: Types.ObjectId | null;
  defaultPriority: TicketPriority;
}

const TicketCategorySchema = new Schema<ITicketCategory>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    defaultTeamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    defaultPriority: { type: String, enum: TICKET_PRIORITIES, default: "MEDIUM" },
  },
  { timestamps: true }
);

export type TicketCategoryDocument = HydratedDocument<ITicketCategory>;
export default mongoose.model<ITicketCategory>("TicketCategory", TicketCategorySchema);
