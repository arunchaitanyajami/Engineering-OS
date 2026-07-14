# ADR-0017: Plugin Package And Manifest Format

## Status

Accepted

## Context

Milestone 2 introduces installable Engineering OS plugins. Discovery must remain declarative and safe, compatibility must be validated before execution, and the core application must not import plugin implementations directly during scanning.

The existing repository already commits to plugin-first architecture, a TypeScript-owned backend runtime, and local-first configuration. Milestone 2 needs a stable package format that future GitHub, Jira, Confluence, and MCP-backed integrations can all share.

## Decision

Define a versioned plugin package manifest as the contract for plugin discovery, validation, installation, and compatibility checks.

The manifest:

- is static JSON data and is never executed during discovery
- includes plugin identity, semantic version, publisher metadata, platform compatibility, entrypoints, requested permissions, and optional bundled MCP server definitions
- uses explicit `schemaVersion` so future incompatible changes fail closed instead of silently degrading
- is runtime-validated with Zod through `@engineering-os/contracts`

The initial package shape centers on backend-capability plugins. Arbitrary UI extension points and remote marketplace packaging remain out of scope for Milestone 2.

## Alternatives Considered

- dynamic JavaScript module inspection during discovery
- plugin metadata embedded only in `package.json`
- unversioned manifest files

## Why This Option

- keeps discovery safe because scanning never executes untrusted code
- supports compatibility validation before enablement
- gives future plugin authors one stable declaration model
- keeps plugin metadata provider-independent and workspace-package-friendly

## Consequences

- plugin authors must keep manifest data synchronized with built entrypoints
- manifest evolution must be handled explicitly through schema versioning and migration guidance
- validation becomes a required part of install and upgrade flows

## Risks

- manifest scope can grow too broadly if it absorbs runtime behavior that belongs in services
- loosely defined capability strings can drift without documentation

## Mitigations

- keep the manifest declarative and move execution policy into core services
- centralize schema ownership in `@engineering-os/contracts`
- document known capability and permission namespaces in contracts and ADRs

## Revisit Conditions

- revisit if Milestone 2 later requires signed packages or package integrity metadata
- revisit if frontend extension packaging becomes a justified milestone requirement
