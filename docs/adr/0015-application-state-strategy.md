# ADR-0015: Application State Strategy

## Status

Accepted

## Context

The desktop shell needs global awareness of initialization state, theme,
workspace sessions, and platform status. Milestone 1 does not need a large
all-purpose state container for every future concern.

## Decision

Use a small typed application store for truly global desktop concerns and keep
feature-specific state local to routes and components.

## Rationale

- Prevents premature adoption of a large global store before async data
  boundaries are clear.
- Keeps routing, command palette, theme, and initialization concerns together
  without mixing in future plugin or workflow data models.
- Makes later migration to more specialized stores easier because the global
  state surface stays small.

## Consequences

- React local state remains the default for transient UI interactions.
- Global state is reserved for shell-wide concerns such as initialization,
  theme, session navigation, and platform status.
