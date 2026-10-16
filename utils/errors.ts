export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Validation text stays visible. Unexpected failures stay generic in production. */
export function clientErrorMessage(err: unknown, status = 500, nodeEnv = "development"): string {
  if (status >= 500 && nodeEnv === "production") return "Internal Server Error";
  return errorMessage(err) || "Internal Server Error";
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
