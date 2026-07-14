# ADR-0023: Plugin SDK Compatibility Policy

## Status

Accepted

## Context

Milestone 2 introduces the first stable plugin contracts, but the Engineering OS platform will continue evolving quickly across Milestones 3 and beyond. Plugin authors need clear expectations for compatibility, versioning, and where breaking changes are allowed.

Without an explicit policy, plugin packages could silently drift from runtime expectations and fail only after installation or activation.

## Decision

Treat `@engineering-os/contracts` as the first compatibility boundary for plugin manifests, permission scopes, MCP registration contracts, tool models, and plugin runtime RPC envelopes.

The policy is:

- manifest `schemaVersion` changes only for incompatible manifest format changes
- contract additions prefer backward-compatible optional fields
- breaking changes require a coordinated milestone decision, release notes, and upgrade guidance
- plugin runtime request and response envelopes are versioned and runtime-validated
- `@engineering-os/plugin-sdk` will be layered on top of `@engineering-os/contracts` rather than redefining the same wire contracts

Compatibility responsibility is shared:

- core validates plugin manifests and runtime messages
- plugins declare supported Engineering OS versions
- SDK packages document which contract version they target

## Alternatives Considered

- no explicit compatibility guarantees until marketplace support exists
- version only the SDK package and not the manifest or runtime contracts
- allow silent best-effort compatibility at runtime

## Why This Option

- makes compatibility rules explicit early
- reduces risk of silent plugin breakage
- supports independent evolution of SDK, core services, and plugin packages
- aligns with fail-closed configuration handling already used in the project

## Consequences

- contract changes need stronger review than ordinary internal refactors
- future SDK release notes must call out compatibility impact clearly
- contract and fixture tests become part of milestone hardening

## Risks

- the policy can slow iteration if every contract change is treated as heavy-weight
- plugins may still rely on undocumented behavior outside the formal contracts

## Mitigations

- keep the contract surface intentionally small
- add reference plugins and contract fixtures as executable documentation
- reject invalid or unsupported versions clearly at install and startup time

## Revisit Conditions

- revisit if plugin distribution expands beyond workspace and local package installs
- revisit if multiple long-lived SDK major versions must be supported concurrently
