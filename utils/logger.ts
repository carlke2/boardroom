import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import pino from "pino";
import pinoHttp from "pino-http";
import type { Request, RequestHandler, Response } from "express";
import { getEnv } from "../config/env.js";

export type AppLogger = pino.Logger;

/** Path only — never query strings (tokens can appear in query). */
export function requestPath(url: string | undefined): string {
  if (!url) return "/";
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function clientIpOf(req: IncomingMessage): string {
  const expressReq = req as Request;
  return expressReq.requestMeta?.ip || req.socket?.remoteAddress || "";
}

function lineFields(req: IncomingMessage, res: ServerResponse, durationMs: number) {
  return {
    method: req.method || "GET",
    path: requestPath(req.url),
    status: res.statusCode,
    durationMs,
    clientIp: clientIpOf(req),
    requestId: (req as { id?: string }).id,
  };
}

export function createLogger(nodeEnv = getEnv().NODE_ENV): AppLogger {
  const pretty = nodeEnv === "development";
  return pino({
    level: "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
              singleLine: true,
              messageFormat: "{msg}",
            },
          },
        }
      : {}),
  });
}

/**
 * One line per request: time, method, path, status, durationMs, clientIp, requestId.
 * Serializers omit bodies, headers, and query strings.
 */
export function createRequestLogger(logger: AppLogger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId(req: IncomingMessage, res: ServerResponse): string {
      const incoming = req.headers["x-request-id"];
      const raw = Array.isArray(incoming) ? incoming[0] : incoming;
      const id = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 128) : randomUUID();
      res.setHeader("X-Request-Id", id);
      return id;
    },
    customAttributeKeys: {
      req: "req",
      res: "res",
      err: "err",
      responseTime: "durationMs",
    },
    serializers: {
      req() {
        return undefined;
      },
      res() {
        return undefined;
      },
      err() {
        return undefined;
      },
    },
    customSuccessObject(req, res, val) {
      const ms = Number(val.durationMs ?? val.responseTime ?? 0);
      return lineFields(req, res, ms);
    },
    customErrorObject(req, res, error, val) {
      void error;
      const ms = Number(val.durationMs ?? val.responseTime ?? 0);
      return lineFields(req, res, ms);
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${requestPath(req.url)} ${res.statusCode}`;
    },
    customErrorMessage(req, res) {
      return `${req.method} ${requestPath(req.url)} ${res.statusCode}`;
    },
    customLogLevel(_req, res, err) {
      if (err) return "error";
      if (res.statusCode >= 500) return "warn";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    quietReqLogger: true,
  }) as unknown as RequestHandler;
}

/** Attach request id from pino-http onto Express for error JSON. */
export function attachRequestId(): RequestHandler {
  return (req: Request, res: Response, next) => {
    const id = req.id;
    if (id) {
      req.requestId = id;
      if (!res.getHeader("X-Request-Id")) {
        res.setHeader("X-Request-Id", id);
      }
    }
    next();
  };
}
