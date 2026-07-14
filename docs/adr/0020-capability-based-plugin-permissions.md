# ADR-0020: Capability-Based Plugin Permissions

## Status

Accepted

## Context

Milestone 2 requires explicit, reviewable, and revocable plugin permissions. Installation must not imply permission grants, and destructive operations need stronger approval than passive reads.

The project already commits to local-first secrets, explicit approval for dangerous actions, and auditability. Milestone 2 needs those principles expressed as stable permission contracts that future plugins and MCP tools can share.

## Decision

Adopt a capability-based permission model for plugins and MCP-adjacent platform actions.

The initial permission namespaces are:

- filesystem: `filesystem.read`, `filesystem.write`, `filesystem.watch`
- network: `network.access`
- processes: `process.spawn`
- secrets: `secrets.read`, `secrets.write`
- application: `notifications.show`, `clipboard.read`, `clipboard.write`, `external-url.open`
- Engineering OS: `mcp.register-server`, `tool.execute`, `workflow.register`, `agent.register`, `ui.register-view`

Permission grants remain separate from invocation-time approvals. A plugin may hold a capability grant and still require explicit confirmation for a destructive tool execution.

The policy model supports:

- deny
- allow once
- allow for session
- always allow

## Alternatives Considered

- coarse trusted or untrusted plugin flags
- installation-time blanket approval
- descriptive permissions in UI without runtime enforcement

## Why This Option

- maps directly to enforceable runtime checks
- keeps plugin safety review understandable for users
- scales better than binary trust flags as the platform grows
- supports later path-level or host-level restrictions without changing the core model

## Consequences

- privileged services must receive execution identity and consult the permission service
- upgrades introducing new permissions require renewed review
- permission UI and backend policy storage must stay aligned

## Risks

- permission scopes can become descriptive rather than enforceable
- overlapping scope names can drift across packages

## Mitigations

- centralize permission scope definitions in `@engineering-os/contracts`
- require runtime enforcement in privileged services, not only UI display
- keep audit logging for grants, denials, and sensitive executions

## Revisit Conditions

- revisit if future sandboxing requires a lower-level permission model
- revisit if we split tool execution policy into a separate risk engine package
