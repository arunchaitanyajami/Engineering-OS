import {
  toolPolicyReviewSchema,
  type PersistedToolPolicy,
  type ToolPolicyReview,
  type ToolRiskLevel
} from "@engineering-os/contracts/unstable-runtime";

import {
  classifyToolRiskLevel,
  type ToolClassificationInput
} from "./tool-safety.js";
import type { ToolPolicyRepository } from "./tool-policy-repository.js";

export interface ToolSafetyServiceOptions {
  readonly repository: ToolPolicyRepository;
  readonly now?: () => string;
}

export interface ToolRiskResolutionInput extends ToolClassificationInput {
  readonly id: string;
}

export class ToolSafetyService {
  private readonly repository: ToolPolicyRepository;
  private readonly now: () => string;

  constructor(options: ToolSafetyServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  resolveRiskLevel(input: ToolRiskResolutionInput): ToolRiskLevel {
    const manualPolicy = this.repository.getByToolId(input.id);

    if (manualPolicy) {
      return manualPolicy.riskLevel;
    }

    return classifyToolRiskLevel(input);
  }

  getPolicyReview(input: ToolRiskResolutionInput): ToolPolicyReview {
    const manualPolicy = this.repository.getByToolId(input.id);
    const inferredRiskLevel = classifyToolRiskLevel(input);

    return toolPolicyReviewSchema.parse({
      toolId: input.id,
      effectiveRiskLevel: manualPolicy?.riskLevel ?? inferredRiskLevel,
      source: manualPolicy ? "manual" : "inferred",
      inferredRiskLevel,
      ...(manualPolicy ? { manualPolicy } : {})
    });
  }

  listManualPolicies(): readonly PersistedToolPolicy[] {
    return this.repository.listManualPolicies();
  }

  setManualPolicy(
    toolId: string,
    riskLevel: ToolRiskLevel,
    classificationInput?: ToolClassificationInput
  ): ToolPolicyReview {
    const manualPolicy = this.repository.upsertManualPolicy(
      toolId,
      riskLevel,
      this.now()
    );

    return toolPolicyReviewSchema.parse({
      toolId,
      effectiveRiskLevel: manualPolicy.riskLevel,
      source: "manual",
      inferredRiskLevel: classifyToolRiskLevel(
        classificationInput ?? { name: toolId }
      ),
      manualPolicy
    });
  }
}
