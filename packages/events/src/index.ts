import type { Logger } from "@engineering-os/logger";

export interface DomainEvent<
  TType extends string = string,
  TPayload = unknown
> {
  readonly id: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly source: string;
}

export type EventHandler<TEvent extends DomainEvent = DomainEvent> = (
  event: TEvent
) => Promise<void> | void;

export class InMemoryEventBus {
  private readonly subscribers = new Map<string, Set<EventHandler>>();

  constructor(private readonly logger?: Logger) {}

  subscribe<TEvent extends DomainEvent>(
    eventType: TEvent["type"],
    handler: EventHandler<TEvent>
  ): () => void {
    const handlers = this.subscribers.get(eventType) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.subscribers.set(eventType, handlers);

    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  async publish<TEvent extends DomainEvent>(event: TEvent): Promise<void> {
    const handlers = this.subscribers.get(event.type);

    if (!handlers || handlers.size === 0) {
      return;
    }

    await Promise.allSettled(
      [...handlers].map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          this.logger?.error("Event subscriber failed.", error, {
            eventType: event.type,
            source: event.source
          });
        }
      })
    );
  }
}
