import type { Types } from "mongoose";

export type UserRole = "ADMIN" | "TEAM_LEAD" | "AGENT" | "USER";

export interface AuthUser {
  id: string;
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
  activeRole: UserRole;
  phone: string | null;
}

export interface RequestMeta {
  ip: string;
  userAgent: string;
}
