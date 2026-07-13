# ADR-0006: MCP-First Integration Architecture

## Status

Accepted

## Context

Engineering OS needs a standard way to expose tools, resources, and prompts across connectors without hardcoding vendor-specific integration paths.

## Decision

Prefer MCP as the default integration protocol for external systems and plugin capabilities.

## Alternatives Considered

- custom connector APIs per integration
- direct provider SDK usage in agents

## Consequences

- improves interoperability and plugin consistency
- keeps future connectors aligned around one integration model

## Risks

- not every vendor capability will map cleanly to MCP immediately

## Revisit Conditions

- revisit if MCP materially blocks high-value integrations
