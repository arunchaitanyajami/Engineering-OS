# ADR-0024: MCP Runtime Failure Policy And Trusted Plugin Command Policy

## Status

Accepted

## Context

Milestone 2 introduces local `stdio` MCP execution for trusted local plugins, user registrations, and future system registrations.

The gateway now supervises startup, discovery, execution, and shutdown, but two policy decisions must be explicit before broader plugin distribution or automatic recovery work begins:

- what to do when an MCP server crashes unexpectedly
- what command containment guarantees exist for plugin-owned MCP servers

Without an explicit policy, future work could accidentally add unsafe auto-restart behavior or overstate the trust boundary for plugin-defined commands.

## Decision

For Milestone 2 and the current trusted local plugin model:

- unexpected MCP server exits are isolated, recorded in gateway health, and require explicit manual restart
- the gateway does not automatically restart crashed MCP servers
- plugin-owned MCP server commands are treated as trusted local plugin input
- plugin MCP working directories must remain inside the managed installation directory
- the command string itself is not yet constrained to a binary inside the managed plugin directory

## Why This Option

- avoids unsafe restart semantics for tools that may have side effects
- keeps execution-state handling honest until restart and replay policy is designed explicitly
- documents the real trust model instead of implying stronger sandboxing than currently exists
- preserves the current local-plugin workflow without inventing a partial broker too early

## Consequences

- crashed MCP servers remain unhealthy until a user or orchestrator restarts them
- future marketplace or untrusted plugin support must tighten command containment
- UI and workflow code must treat MCP crash recovery as an explicit action, not an automatic guarantee

## Risks

- manual restart can feel less convenient than automatic recovery
- plugin command trust is too broad for public or third-party plugin distribution

## Mitigations

- record crash state in gateway health snapshots and backend APIs
- keep plugin MCP startup and disable under one lifecycle coordinator
- revisit command policy before public plugin distribution
- design restart policy together with execution reconciliation, idempotency, and audit requirements

## Revisit Conditions

- revisit when public or signed plugin distribution begins
- revisit when remote transports or brokered process execution land
- revisit when workflow-owned execution recovery semantics are defined
