# ADR-0008: Provider-Independent AI Abstraction

## Status

Accepted

## Context

Engineering OS must support multiple AI providers and local models without rewriting core workflows and agents.

## Decision

Keep provider-specific SDKs out of core contracts and standardize around provider-independent abstractions.

## Alternatives Considered

- OpenAI-first architecture
- provider logic embedded directly in agents

## Consequences

- future provider changes stay localized
- workflows and agents remain portable

## Risks

- abstraction quality must stay ahead of provider feature drift

## Revisit Conditions

- revisit if abstraction hides critical provider capabilities needed by the product
