# ADR-0022: Local Secret Storage Abstraction

## Status

Accepted

## Context

Plugins and MCP server registrations need credentials, but Engineering OS is explicitly local-first and must never persist plaintext secrets in manifests, normal configuration, or SQLite records.

Milestone 2 must define a secret abstraction before plugin registry, permission review, and MCP transport configuration are implemented.

## Decision

Define a namespaced local secret storage abstraction and expose it through contracts rather than implementation-specific APIs.

The abstraction:

- stores secrets under plugin-specific or system-specific namespaces
- exposes `get`, `set`, `delete`, and `listKeys`
- allows SQLite and configuration records to store secret references instead of plaintext values
- hides the concrete storage backend from plugins and higher-level services

The preferred implementation order is:

1. OS credential vault integration where available.
2. Encrypted local fallback only when required.
3. Never plaintext manifest or SQLite storage for live credentials.

## Alternatives Considered

- store credentials directly in plugin manifests
- store secrets as plain configuration values in SQLite
- expose the operating-system credential API directly to plugins

## Why This Option

- preserves local-first ownership of credentials
- lets the core swap storage implementations without breaking plugin contracts
- supports secret redaction in logs and audit data
- keeps plugins isolated to their own namespaces

## Consequences

- secret references become part of MCP registration and plugin configuration flows
- secret migration and recovery behavior must be documented when implementation lands
- plugin SDK APIs must remain namespace-aware

## Risks

- secure OS storage can differ across platforms
- fallback encryption can create operational and UX complexity

## Mitigations

- keep the public contract storage-agnostic
- prefer OS secure storage when supported
- validate that logs, diagnostics, and audits never emit secret values

## Revisit Conditions

- revisit if Tauri-supported secure storage materially changes across target platforms
- revisit if enterprise sync of encrypted secrets becomes a future milestone requirement
