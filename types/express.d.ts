import type { JwtPayload } from "jsonwebtoken";
import type { AuthUser, RequestMeta } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      token?: string;
      jwt?: JwtPayload | string;
      requestMeta?: RequestMeta;
    }
  }
}

export {};
