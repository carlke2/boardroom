export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface GoogleApiError {
  message?: string;
  stack?: string;
  response?: {
    status?: number;
    data?: {
      error?: { message?: string } | string;
      error_description?: string;
    };
  };
}

export function asGoogleApiError(err: unknown): GoogleApiError {
  if (err && typeof err === "object") return err as GoogleApiError;
  return { message: String(err) };
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
