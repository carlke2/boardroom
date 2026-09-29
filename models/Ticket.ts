import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import {
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from "../types/tickets.js";

export interface ITicket {
  number: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryId: Types.ObjectId | null;
  requesterId: Types.ObjectId;
  assigneeId: Types.ObjectId | null;
  teamId: Types.ObjectId | null;
  channel: TicketChannel;
  sourceRef: string | null;
  resolutionNote: string | null;
  firstResponseAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaResponseDue: Date | null;
  slaResolutionDue: Date | null;
  slaPausedAt: Date | null;
}

const TicketSchema = new Schema<ITicket>(
  {
    number: { type: String, required: true, unique: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    status: { type: String, enum: TICKET_STATUSES, default: "NEW", index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: "MEDIUM" },
    categoryId: { type: Schema.Types.ObjectId, ref: "TicketCategory", default: null },
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    channel: { type: String, enum: TICKET_CHANNELS, default: "API" },
    sourceRef: { type: String, default: null },
    resolutionNote: { type: String, default: null },
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    slaResponseDue: { type: Date, default: null },
    slaResolutionDue: { type: Date, default: null },
    slaPausedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TicketSchema.index({ status: 1, assigneeId: 1 });
TicketSchema.index({ teamId: 1, status: 1 });
TicketSchema.index({ requesterId: 1 });
TicketSchema.index({ slaResolutionDue: 1 });
TicketSchema.index({ createdAt: 1 });

export type TicketDocument = HydratedDocument<ITicket>;
export default mongoose.model<ITicket>("Ticket", TicketSchema);
