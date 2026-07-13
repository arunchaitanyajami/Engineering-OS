# Coding Standards

## TypeScript

- strict mode is required
- prefer small reusable modules with explicit exports
- avoid `any`
- keep runtime boundaries explicit between UI, core, plugins, and agents

## React

- keep view logic composable and easy to test
- avoid mixing connector or workflow execution logic directly into UI components
- prefer clear state ownership and typed props

## Architecture

- do not hardcode model providers
- do not mix connector logic inside agents
- do not bypass plugin permissions
- document significant architecture decisions with ADRs

## Testing

- add focused tests when they meaningfully reduce regression risk
- avoid placeholder tests that only restate the implementation

## Documentation

- update docs when architecture, milestones, or contracts change
- explain tradeoffs for non-obvious decisions
