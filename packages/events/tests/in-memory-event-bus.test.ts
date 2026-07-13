import { describe, expect, it, vi } from "vitest";

import { InMemoryEventBus } from "@engineering-os/events";
import { createTestLogger } from "@engineering-os/testing";

describe("InMemoryEventBus", () => {
  it("isolates subscriber failures", async () => {
    const { logger } = createTestLogger();
    const eventBus = new InMemoryEventBus(logger);
    const handler = vi.fn();

    eventBus.subscribe("demo.event", () => {
      throw new Error("boom");
    });
    eventBus.subscribe("demo.event", handler);

    await eventBus.publish({
      id: "evt-1",
      type: "demo.event",
      payload: { ok: true },
      timestamp: "2026-01-01T00:00:00.000Z",
      correlationId: "corr-1",
      source: "test"
    });

    expect(handler).toHaveBeenCalledOnce();
  });
});
