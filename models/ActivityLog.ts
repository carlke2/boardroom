import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface IActivityLog {
  action: string;
  description: string;
  actorId: Types.ObjectId | null;
  actorEmail: string;
  ip: string;
  userAgent: string;
  entityType: string;
  entityId: Types.ObjectId | null;
  meta: Record<string, unknown>;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    action: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    entityType: { type: String, default: "" },
    entityId: { type: Schema.Types.ObjectId, default: null },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

export type ActivityLogDocument = HydratedDocument<IActivityLog>;
export default mongoose.model<IActivityLog>("ActivityLog", ActivityLogSchema);
