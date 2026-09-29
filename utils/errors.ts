export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
