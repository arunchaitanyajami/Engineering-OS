# ADR-0014: Local Configuration Strategy

## Status

Accepted

## Context

Milestone 1 requires local desktop settings, theme persistence, schema
versioning, and migration support. The application must not mix secrets into the
plain settings document.

## Decision

Store application settings in a versioned local configuration document with this
shape:

```ts
interface PersistedApplicationConfig {
  schemaVersion: number;
  settings: ApplicationSettings;
}
```

Configuration loading must use explicit version dispatch. Unknown future schema
versions fail closed with a recoverable compatibility error instead of being
silently overwritten by an older build.

Configuration persistence uses a temporary-file write flow with backup
preservation so desktop settings are not lost because of a partial overwrite.

## Rationale

- Schema versioning allows non-breaking upgrades as desktop settings evolve.
- Fail-closed version handling protects newer config documents from accidental
  downgrade writes by older binaries.
- A dedicated config package keeps parsing, defaults, and migrations out of
  React components.
- Plain settings remain separate from secret-storage infrastructure, which is a
  later milestone concern.

## Consequences

- Every settings change must pass through migration-aware config helpers.
- Invalid or unsupported local config files surface recoverable startup errors
  instead of resetting to defaults.
- Future desktop storage backends can change without rewriting settings
  consumers.
