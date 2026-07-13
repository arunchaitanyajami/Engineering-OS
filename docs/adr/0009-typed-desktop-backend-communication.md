# ADR-0009: Typed Desktop-to-Backend Communication

## Status

Accepted

## Context

The desktop UI needs privileged application services without gaining direct access to secrets, file system, database, or provider SDKs.

## Decision

Enforce a typed command boundary between the React frontend and backend application services.

## Alternatives Considered

- direct UI imports of backend packages
- ad hoc string-based IPC contracts

## Consequences

- protects local secrets and operating system access
- keeps UI components decoupled from infrastructure details

## Risks

- boundary design can become noisy if commands are overly granular

## Revisit Conditions

- revisit when the command surface becomes hard to maintain or version
