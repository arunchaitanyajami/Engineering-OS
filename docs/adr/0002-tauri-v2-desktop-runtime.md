# ADR-0002: Tauri v2 as Desktop Runtime

## Status

Accepted

## Context

Engineering OS needs a desktop-native runtime with strong local integration, small footprint, and a web-friendly UI stack.

## Decision

Use Tauri v2 as the primary desktop runtime.

## Alternatives Considered

- Electron
- native-only desktop UI frameworks
- web-first deployment

## Consequences

- enables React + TypeScript UI with Rust only where native capabilities require it
- preserves desktop-first product direction

## Risks

- native packaging and system dependencies add setup complexity

## Revisit Conditions

- revisit if Tauri cannot support required native capabilities or distribution needs
