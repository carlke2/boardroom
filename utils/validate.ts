import { HttpError } from "./httpError.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(422, `${name} is required`, "validation");
  }
  return value.trim();
}

export function optionalText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(422, "invalid text", "validation");
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function optionalEnum(value: unknown, allowed: readonly string[], name: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new HttpError(422, `invalid ${name}`, "validation");
  }
  return value;
}

export function optionalUuid(value: unknown, name: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(422, `invalid ${name}`, "validation");
  return value;
}

export function requiredUuid(value: unknown, name: string): string {
  const id = optionalUuid(value, name);
  if (!id) throw new HttpError(422, `${name} is required`, "validation");
  return id;
}

export function optionalLimit(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError(422, "invalid limit", "validation");
  return parsed;
}

export function optionalTimestamp(value: unknown, name: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new HttpError(422, `invalid ${name}`, "validation");
  }
  return new Date(value).toISOString();
}

export function optionalDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(422, "invalid day", "validation");
  }
  return value;
}

export function optionalBool(value: unknown): boolean {
  return value === true || value === "true";
}

export function optionalInt(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new HttpError(422, `invalid ${name}`, "validation");
  return parsed;
}
