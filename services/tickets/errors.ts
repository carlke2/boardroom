export class TicketError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TicketError";
    this.status = status;
  }
}
