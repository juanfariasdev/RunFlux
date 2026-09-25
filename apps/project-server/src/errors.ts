/**
 * An error the API answers with its own status and code, as `{ error: { code, message, details } }`.
 * The services' errors extend it, so one middleware maps them all.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, message: string, details: unknown = null) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toBody(): { error: { code: string; message: string; details: unknown } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
