export class HttpError extends Error {
  readonly status: number;
  readonly apiCode: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, message: string, apiCode: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.apiCode = apiCode;
    this.details = details;
  }
}

function pgField(error: unknown, field: "code" | "detail" | "message"): string {
  if (!error || typeof error !== "object" || !(field in error)) return "";
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

/** Maps a Postgres error from an RPC into the API error shape. Unknown errors pass through. */
export function mapDbError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  const code = pgField(error, "code");
  const message = pgField(error, "message") || (error instanceof Error ? error.message : "") || "Request failed";
  if (code === "42501") return new HttpError(403, "forbidden", "forbidden");
  if (code === "23P01") {
    const detail = pgField(error, "detail");
    let booking: unknown;
    try {
      booking = detail ? JSON.parse(detail) : undefined;
    } catch {
      booking = undefined;
    }
    return new HttpError(409, "room is already booked", "conflict", booking ? { booking } : {});
  }
  if (code === "P0001" && /not found/i.test(message)) return new HttpError(404, message, "not_found");
  if (code === "P0001" || code === "22P02" || code === "22023") return new HttpError(422, message, "validation");
  return error;
}
