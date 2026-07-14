# ADR-0019: MCP Gateway As The Single MCP Boundary

## Status

Accepted

## Context

Engineering OS is MCP-first, but plugins, agents, workflows, UI features, and provider adapters must not each connect to MCP servers independently. Direct access would duplicate lifecycle management, permission enforcement, logging, timeout handling, and capability normalization.

Milestone 2 requires local `stdio` MCP support first, with room for later remote transports.

## Decision

Introduce the MCP Gateway as the only internal boundary allowed to register, connect to, supervise, discover, and invoke MCP capabilities.

The MCP Gateway owns:

- MCP server registration
- process and connection lifecycle
- transport creation
- capability discovery
- normalized capability catalogs
- invocation validation
- timeout and cancellation handling
- diagnostic and audit hooks

UI code, agents, workflows, and provider adapters depend on gateway contracts rather than MCP SDK types or raw server connections.

## Alternatives Considered

- let each plugin or agent manage its own MCP client
- expose raw MCP SDK clients to the renderer or AI provider adapters
- connect directly from provider-specific adapters to MCP servers

## Why This Option

- keeps safety, permissions, and logging centralized
- preserves provider independence
- contains MCP SDK churn behind one package boundary
- prevents GitHub or future integrations from bypassing platform policy

## Consequences

- the gateway becomes a critical backend service
- feature teams must extend gateway contracts instead of making direct MCP calls
- capability discovery and execution need shared test fixtures

## Risks

- overloading the gateway with provider-specific logic
- accidental leakage of MCP SDK types beyond the gateway boundary

## Mitigations

- expose Engineering OS contracts from `@engineering-os/contracts`
- keep provider adapters downstream of normalized gateway descriptors
- isolate MCP SDK-specific code inside dedicated gateway or client packages

## Revisit Conditions

- revisit if future remote transports require a separate transport broker while preserving the same policy boundary
