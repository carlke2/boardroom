import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import {
  ASSIGN_STRATEGIES,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  type AssignStrategy,
  type TicketChannel,
  type TicketPriority,
} from "../types/tickets.js";

export interface IRoutingRule {
  name: string;
  active: boolean;
  channel: TicketChannel | null;
  keyword: string;
  categoryId: Types.ObjectId | null;
  priority: TicketPriority | null;
  teamId: Types.ObjectId | null;
  assignStrategy: AssignStrategy;
  order: number;
}

const RoutingRuleSchema = new Schema<IRoutingRule>(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    channel: { type: String, enum: [...TICKET_CHANNELS, null], default: null },
    keyword: { type: String, default: "", trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "TicketCategory", default: null },
    priority: { type: String, enum: [...TICKET_PRIORITIES, null], default: null },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    assignStrategy: { type: String, enum: ASSIGN_STRATEGIES, default: "MANUAL" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type RoutingRuleDocument = HydratedDocument<IRoutingRule>;
export default mongoose.model<IRoutingRule>("RoutingRule", RoutingRuleSchema);
