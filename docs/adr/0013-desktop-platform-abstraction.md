# ADR-0013: Desktop Platform Abstraction

## Status

Accepted

## Context

Milestone 1 needs a secure desktop shell that can query platform information
and invoke privileged commands without letting React components call Tauri APIs
directly. The shell must also remain testable in browser-like environments.

## Decision

Introduce a typed `DesktopPlatform` abstraction in `packages/platform` and keep
the Tauri implementation inside `apps/desktop`.

## Why

- Prevents direct Tauri imports from spreading across feature components.
- Makes route, settings, and initialization flows testable with a mock
  platform.
- Preserves the option to support CLI or headless execution surfaces later
  without rewriting every feature.

## Tradeoffs

- Adds one more abstraction layer for simple runtime calls.
- Requires discipline to keep the interface small and milestone-focused.

## Consequences

- Frontend features depend on platform contracts, not on Tauri-specific modules.
- Desktop-only behavior remains concentrated in one adapter boundary.
