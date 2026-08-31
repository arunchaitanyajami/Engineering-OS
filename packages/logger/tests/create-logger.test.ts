import { describe, expect, it } from "vitest";

import { createLogger, redactMetadata } from "@engineering-os/logger";
import { InMemoryLogTransport } from "@engineering-os/testing";

describe("createLogger", () => {
  it("redacts sensitive metadata", () => {
    const transport = new InMemoryLogTransport();
    const logger = createLogger({
      component: "logger-test",
      correlationId: "corr-1",
      transport
    });

    logger.info("hello", {
      apiKey: "secret-value",
      nested: {
        password: "another-secret"
      }
    });

    expect(transport.entries).toHaveLength(1);
    expect(redactMetadata(transport.entries[0]?.metadata)).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        password: "[REDACTED]"
      }
    });
    expect(transport.entries[0]?.metadata).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        password: "[REDACTED]"
      }
    });
  });

  it("redacts secrets from messages and serialized errors", () => {
    const transport = new InMemoryLogTransport();
    const logger = createLogger({
      component: "logger-test",
      transport
    });

    logger.error(
      "Request failed: authorization: Bearer message-secret",
      new Error("authorization: Bearer error-secret"),
      {
        authorization: "Bearer metadata-secret"
      }
    );

    expect(transport.entries[0]).toMatchObject({
      message: "Request failed: authorization: Bearer [REDACTED]",
      metadata: {
        authorization: "[REDACTED]"
      },
      error: {
        message: "authorization: Bearer [REDACTED]"
      }
    });
  });
});
