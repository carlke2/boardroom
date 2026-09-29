import mongoose, { Schema, type HydratedDocument } from "mongoose";
import type { UserRole } from "../types/auth.js";

export interface IUser {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "USER"], default: "USER" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type UserDocument = HydratedDocument<IUser>;
export default mongoose.model<IUser>("User", UserSchema);
