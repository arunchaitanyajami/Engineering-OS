# ADR-0003: TypeScript as Primary Application Language

## Status

Accepted

## Context

Most platform logic, connectors, workflows, and UI code benefit from a shared language and type system.

## Decision

Use TypeScript as the primary language for application code. Use Rust only where Tauri requires native functionality.

## Alternatives Considered

- Python-first runtime
- mixed-language core from the start

## Consequences

- shared types across UI, services, and packages
- lower cognitive overhead for contributors

## Risks

- native or ML-heavy paths may still require non-TypeScript components later

## Revisit Conditions

- revisit for isolated subsystems that materially benefit from another language
