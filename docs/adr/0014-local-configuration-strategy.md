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

## Rationale

- Schema versioning allows non-breaking upgrades as desktop settings evolve.
- A dedicated config package keeps parsing, defaults, and migrations out of
  React components.
- Plain settings remain separate from secret-storage infrastructure, which is a
  later milestone concern.

## Consequences

- Every settings change must pass through migration-aware config helpers.
- Future desktop storage backends can change without rewriting settings
  consumers.
