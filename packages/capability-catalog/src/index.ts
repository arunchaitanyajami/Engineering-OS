import type {
  PromptDescriptor,
  ResourceDescriptor,
  ToolDescriptor
} from "@engineering-os/contracts/unstable-runtime";

export type { PromptDescriptor, ResourceDescriptor, ToolDescriptor };

export type CapabilityKind = "tool" | "resource" | "prompt";

export interface CapabilityCatalogEntry {
  readonly kind: CapabilityKind;
  readonly pluginId: string;
  readonly registrationId: string;
  readonly name: string;
  readonly description?: string;
}

export interface CapabilityCatalogSnapshot {
  readonly tools: readonly ToolDescriptor[];
  readonly resources: readonly ResourceDescriptor[];
  readonly prompts: readonly PromptDescriptor[];
}

export const emptyCapabilityCatalogSnapshot =
  (): CapabilityCatalogSnapshot => ({
    tools: [],
    resources: [],
    prompts: []
  });
