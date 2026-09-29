import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

export interface ITeamMember {
  teamId: Types.ObjectId;
  userId: Types.ObjectId;
  isLead: boolean;
}

const TeamMemberSchema = new Schema<ITeamMember>(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isLead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

TeamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });

export type TeamMemberDocument = HydratedDocument<ITeamMember>;
export default mongoose.model<ITeamMember>("TeamMember", TeamMemberSchema);
