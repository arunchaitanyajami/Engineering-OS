# ADR-0011: Internal Event Architecture

## Status

Accepted

## Context

Engineering OS needs decoupled internal communication between services without introducing distributed infrastructure in the local desktop foundation.

## Decision

Use a typed in-process event model and event bus for internal coordination during early milestones.

## Alternatives Considered

- direct service-to-service calls only
- distributed infrastructure such as Kafka or Redis

## Consequences

- local-first architecture stays simple
- subscribers can be added without tightly coupling core services

## Risks

- event overuse can make control flow harder to follow

## Revisit Conditions

- revisit if local event volume or reliability needs exceed an in-process model
