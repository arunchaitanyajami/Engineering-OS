export class PluginRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly cause?: unknown
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "PluginRegistryError";
  }
}
