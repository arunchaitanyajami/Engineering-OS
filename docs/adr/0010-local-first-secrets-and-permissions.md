# ADR-0010: Local-First Secret and Permission Model

## Status

Accepted

## Context

Engineering OS will eventually execute powerful local and remote actions, so the platform needs a security model before feature work begins.

## Decision

Keep secrets local by default, access them through a `SecretStore` abstraction, require permissions for capabilities, and define confirmation policies for destructive actions.

## Alternatives Considered

- plaintext config secrets
- implicit trust for plugins and workflows

## Consequences

- security boundaries exist before connectors arrive
- auditability and approval flows have a stable foundation

## Risks

- operating system secret integrations still need later implementation

## Revisit Conditions

- revisit when platform permissions become too coarse for real-world usage
