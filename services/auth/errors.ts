export class AuthProviderError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthProviderError";
    this.status = status;
  }
}
