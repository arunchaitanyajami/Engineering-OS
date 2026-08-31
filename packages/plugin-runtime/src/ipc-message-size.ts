import { MAX_RUNTIME_MESSAGE_BYTES } from "@engineering-os/contracts/unstable-runtime";

export { MAX_RUNTIME_MESSAGE_BYTES };

export const estimateIpcMessageBytes = (message: unknown): number =>
  Buffer.byteLength(JSON.stringify(message), "utf8");

export const assertIpcMessageWithinLimit = (
  message: unknown,
  context: string
): void => {
  const messageBytes = estimateIpcMessageBytes(message);

  if (messageBytes > MAX_RUNTIME_MESSAGE_BYTES) {
    throw new Error(
      `${context} exceeds the maximum IPC message size of ${MAX_RUNTIME_MESSAGE_BYTES} bytes.`
    );
  }
};
