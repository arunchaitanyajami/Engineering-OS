export class SecretServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly cause?: unknown
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "SecretServiceError";
  }
}
