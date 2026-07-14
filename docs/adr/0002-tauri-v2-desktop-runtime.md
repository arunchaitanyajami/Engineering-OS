# ADR-0002: Tauri v2 as Desktop Runtime

## Status

Accepted

## Context

Engineering OS needs a desktop-native runtime with strong local integration,
small footprint, secure privilege boundaries, and a web-friendly UI stack.
Milestone 1 requires a stable desktop shell without turning the product into a
web-first application.

## Decision

Use Tauri v2 as the primary desktop runtime.

## Alternatives Considered

- Electron
- native-only desktop UI frameworks
- web-first deployment

## Rationale

- Tauri preserves the desktop-first product direction while keeping the UI in
  React and TypeScript.
- Rust remains limited to the privileged boundary, which aligns with the
  project rule to use minimal Rust only where the desktop runtime requires it.
- The Tauri capability model gives the shell an explicit permission surface
  instead of broad desktop access.
- Packaging stays cross-platform across macOS, Windows, and Linux without
  forcing a Node.js runtime to ship as the full desktop host.

## Why Not Electron

- Electron ships a larger runtime footprint for the same desktop shell
  capability set.
- Tauri offers a narrower native boundary by default, which better supports the
  project's security posture.
- The Engineering OS shell does not currently need Electron-specific browser
  process features to justify the larger packaging cost.

## Consequences

- enables React + TypeScript UI with Rust only where native capabilities require it
- preserves desktop-first product direction
- requires an explicit typed IPC boundary between the React shell and desktop
  capabilities
- requires packaging validation on all supported operating systems

## Risks

- native packaging and system dependencies add setup complexity
- privileged commands can become unsafe if the boundary grows without typed
  contracts and capability review

## Revisit Conditions

- revisit if Tauri cannot support required native capabilities or distribution needs
