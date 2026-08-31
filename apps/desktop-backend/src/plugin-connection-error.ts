export class PluginConnectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    options?: { readonly cause?: unknown }
  ) {
    super(message, options);
    this.name = "PluginConnectionError";
  }
}
