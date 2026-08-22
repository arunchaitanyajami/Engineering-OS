import { pluginRuntimeProtocolVersion } from "@engineering-os/contracts/unstable-runtime";

export class PluginRuntimeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginRuntimeProtocolError";
  }
}

export const readProtocolVersion = (message: unknown): unknown => {
  if (
    typeof message === "object" &&
    message !== null &&
    "protocolVersion" in message
  ) {
    return (message as { protocolVersion: unknown }).protocolVersion;
  }

  return undefined;
};

export const assertSupportedProtocolVersion = (value: unknown): void => {
  if (value !== pluginRuntimeProtocolVersion) {
    throw new PluginRuntimeProtocolError(
      `Unsupported plugin runtime protocol version '${String(value)}'.`
    );
  }
};
