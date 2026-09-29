import type { Request, Response } from "express";
import { errorMessage } from "../utils/errors.js";
import { TicketError } from "../services/tickets/errors.js";

export function wrapTicket(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    void handler(req, res).catch((error: unknown) => {
      if (error instanceof TicketError) {
        res.status(error.status).json({ ok: false, message: error.message });
        return;
      }
      console.error(error);
      res.status(500).json({ ok: false, message: errorMessage(error) || "Internal Server Error" });
    });
  };
}

export function requireUser(req: Request) {
  if (!req.user) {
    throw new TicketError(401, "Unauthorized");
  }
  return req.user;
}
