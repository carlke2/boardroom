import jwt from "jsonwebtoken";
import type { UserRole } from "../../types/auth.js";

const ROLE_VALUES: UserRole[] = ["ADMIN", "TEAM_LEAD", "AGENT", "USER"];

export function isUserRole(value: string): value is UserRole {
  return ROLE_VALUES.includes(value as UserRole);
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET missing in .env");
  return secret;
}

/** Roles the account may sign in as. A stored list wins; otherwise the primary role. */
export function assignedRoles(user: { role?: string | null; roles?: string[] | null }): UserRole[] {
  const listed = (user.roles || []).filter(isUserRole);
  if (listed.length) return [...new Set(listed)];
  return user.role && isUserRole(user.role) ? [user.role] : ["USER"];
}

export function signAccessToken(userId: string, role: UserRole): string {
  return jwt.sign({ id: userId, role }, jwtSecret(), { expiresIn: "7d" });
}

export function signPendingToken(userId: string, role: UserRole): string {
  return jwt.sign({ id: userId, role, pending: true }, jwtSecret(), { expiresIn: "10m" });
}

export function publicSessionUser(
  user: { _id: { toString(): string }; name: string; email: string; phone?: string | null; roles?: string[] | null; role?: string | null },
  activeRole: UserRole
) {
  const roles = assignedRoles(user);
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone || null,
    role: activeRole,
    roles,
    activeRole,
  };
}

export function issueSession(user: {
  _id: { toString(): string };
  name: string;
  email: string;
  phone?: string | null;
  role?: string | null;
  roles?: string[] | null;
}) {
  const roles = assignedRoles(user);
  if (roles.length > 1) {
    return {
      requiresRoleSelection: true as const,
      pendingToken: signPendingToken(user._id.toString(), roles[0]),
      roles,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
      },
    };
  }

  const role = roles[0];
  return {
    token: signAccessToken(user._id.toString(), role),
    user: publicSessionUser(user, role),
  };
}
