# ADR-0018: Out-Of-Process Plugin Runtime

## Status

Accepted

## Context

Milestone 2 needs plugins and bundled MCP servers to fail independently from the Engineering OS core runtime. The platform already uses a narrow Rust host plus a Node sidecar backend, and future plugins may include third-party code or unstable local integrations.

Loading plugin code directly into the main backend process would violate the milestone requirement for failure isolation and would make timeout enforcement, crash-loop detection, and per-plugin supervision harder.

## Decision

Run plugins and plugin-owned MCP servers out of process under a supervised Node.js runtime boundary.

The initial supervision model uses child processes with:

- startup timeout
- shutdown grace period
- forced termination fallback
- restart limits and crash-loop detection
- captured stdout and stderr
- health checks and runtime state reporting

Core-to-plugin communication uses a typed RPC protocol defined in `@engineering-os/contracts`. TypeScript types alone are not trusted across process boundaries; all inbound messages must be runtime-validated.

Milestone 2.3 explicitly supports trusted local plugins only. The out-of-process worker boundary improves failure isolation, but it is not treated as a security sandbox for untrusted third-party code.

## Alternatives Considered

- load plugins through unrestricted dynamic imports inside the backend process
- run plugin logic inside the React renderer
- move plugin execution into Rust

## Why This Option

- preserves core stability when plugins crash or hang
- aligns with desktop-first and local-first execution
- keeps plugin runtime implementation in TypeScript instead of expanding Rust ownership
- creates a path toward stronger sandboxing later without changing the public architecture

## Consequences

- process lifecycle management becomes a first-class backend concern
- plugin APIs must remain explicit and message-based
- integration and contract tests are required for the runtime boundary
- plugin permissions, secrets, storage, configuration, and MCP broker APIs remain unavailable until Engineering OS ships a permission-enforced brokered runtime
- third-party public plugin distribution must stay blocked until sandboxing or equivalent brokered enforcement exists

## Risks

- child-process orchestration adds operational complexity
- large or malformed messages could stress the runtime boundary
- local plugins can still use unrestricted Node.js APIs directly inside their own worker processes until sandboxing is added

## Mitigations

- define a versioned RPC envelope with runtime validation
- enforce message size, timeout, and restart policies in the lifecycle manager
- keep the plugin API narrow and capability-based
- expose a minimal allowlisted worker environment instead of inheriting the full backend environment
- make unsupported brokered APIs fail explicitly instead of pretending to enforce permissions or persistence

## Revisit Conditions

- revisit when implementing a permission-enforced broker that mediates filesystem, network, secrets, process spawn, and MCP access
- revisit if stronger OS-level sandboxing becomes necessary for trusted third-party plugins
- revisit if a future runtime provides equivalent isolation with lower operational overhead
