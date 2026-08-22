import type { PluginPermissionRequest } from "@engineering-os/contracts";
import {
  grantPluginPermissionsRequestSchema,
  pluginPermissionGrantInputSchema,
  pluginPermissionReviewSnapshotSchema,
  revokePluginPermissionRequestSchema,
  toolExecutionPolicyEvaluationSchema,
  type ExecutionContext,
  type GrantPluginPermissionsRequest,
  type PersistedPluginPermissionGrant,
  type PermissionGrantDecision,
  type PluginPermissionGrantInput,
  type PluginPermissionRequirement,
  type PluginPermissionReviewSnapshot,
  type ToolDescriptor,
  type ToolExecutionPolicyEvaluation,
  type ToolRiskLevel
} from "@engineering-os/contracts/unstable-runtime";
import type { Logger } from "@engineering-os/logger";
import type { InstalledPlugin } from "@engineering-os/plugin-registry";
import { PluginRegistryError } from "@engineering-os/plugin-registry";

import {
  constraintsMatch,
  serializePermissionConstraint,
  toPermissionRequirement
} from "./constraints.js";
import { PermissionEngineError } from "./errors.js";
import type { PermissionGrantRepository } from "./repository.js";

export interface InstalledPluginCatalog {
  getInstalledPlugin(pluginId: string): InstalledPlugin | null;
}

export interface PermissionEngineOptions {
  readonly installedPlugins: InstalledPluginCatalog;
  readonly repository: PermissionGrantRepository;
  readonly logger: Logger;
}

const ENABLEMENT_GRANT_DECISIONS = new Set<PermissionGrantDecision>([
  "always-allow",
  "allow-for-session"
]);

const isGrantActive = (
  grant: PersistedPluginPermissionGrant,
  sessionId: string | undefined
): boolean => {
  if (grant.revokedAt) {
    return false;
  }

  if (grant.decision === "deny") {
    return false;
  }

  if (grant.decision === "allow-once") {
    return false;
  }

  if (grant.decision === "allow-for-session") {
    return typeof sessionId === "string" && sessionId.length > 0;
  }

  return grant.decision === "always-allow";
};

const satisfiesRequirement = (
  requirement: PluginPermissionRequirement,
  grants: readonly PersistedPluginPermissionGrant[],
  sessionId: string | undefined
): boolean =>
  grants.some(
    (grant) =>
      grant.scope === requirement.scope &&
      constraintsMatch(grant.constraint, requirement.constraint) &&
      ENABLEMENT_GRANT_DECISIONS.has(grant.decision) &&
      isGrantActive(grant, sessionId)
  );

const requiredApprovalForRisk = (
  riskLevel: ToolRiskLevel
): ToolExecutionPolicyEvaluation["requiredApproval"] => {
  switch (riskLevel) {
    case "read-only":
      return "none";
    case "write":
      return "none";
    case "destructive":
    case "privileged":
    case "unknown":
      return "user-confirmation";
    default: {
      const exhaustiveCheck: never = riskLevel;
      return exhaustiveCheck;
    }
  }
};

const approvalModeSatisfiesRequirement = (
  approvalMode: ExecutionContext["approvalMode"],
  requiredApproval: ToolExecutionPolicyEvaluation["requiredApproval"]
): boolean => {
  if (requiredApproval === "none") {
    return true;
  }

  if (requiredApproval === "user-confirmation") {
    return (
      approvalMode === "user-confirmation" || approvalMode === "dual-confirmation"
    );
  }

  return approvalMode === "dual-confirmation";
};

export class PermissionEngineService {
  private readonly logger: Logger;

  constructor(private readonly options: PermissionEngineOptions) {
    this.logger = options.logger.child({
      component: "permission-engine"
    });
  }

  getPermissionReview(
    pluginId: string,
    sessionId?: string
  ): PluginPermissionReviewSnapshot {
    const plugin = this.requireInstalledPlugin(pluginId);
    const requirements = plugin.manifest.permissions.map(toPermissionRequirement);
    const grants = this.options.repository.listByPluginId(pluginId);
    const pendingRequirements = requirements.filter(
      (requirement) => !satisfiesRequirement(requirement, grants, sessionId)
    );

    return pluginPermissionReviewSnapshotSchema.parse({
      pluginId,
      requirements,
      grants,
      pendingRequirements,
      canEnable: pendingRequirements.length === 0
    });
  }

  grantPermissions(request: GrantPluginPermissionsRequest): PluginPermissionReviewSnapshot {
    const parsedRequest = grantPluginPermissionsRequestSchema.parse(request);
    this.requireInstalledPlugin(parsedRequest.pluginId);
    const grantedAt = new Date().toISOString();

    for (const grant of parsedRequest.grants) {
      this.persistGrant(parsedRequest.pluginId, grant, grantedAt);
    }

    this.logger.info("Updated plugin permission grants.", {
      pluginId: parsedRequest.pluginId,
      grantCount: parsedRequest.grants.length
    });

    return this.getPermissionReview(
      parsedRequest.pluginId,
      parsedRequest.sessionId
    );
  }

  revokePermission(
    pluginId: string,
    scope: PersistedPluginPermissionGrant["scope"]
  ): PluginPermissionReviewSnapshot {
    const parsedRequest = revokePluginPermissionRequestSchema.parse({
      pluginId,
      scope
    });
    this.requireInstalledPlugin(parsedRequest.pluginId);

    const revokedGrant = this.options.repository.revokeGrant(
      parsedRequest.pluginId,
      parsedRequest.scope,
      new Date().toISOString()
    );

    if (revokedGrant) {
      this.logger.info("Revoked plugin permission grant.", {
        pluginId: parsedRequest.pluginId,
        scope: parsedRequest.scope
      });
    }

    return this.getPermissionReview(parsedRequest.pluginId);
  }

  assertCanEnablePlugin(pluginId: string, sessionId?: string): void {
    const review = this.getPermissionReview(pluginId, sessionId);

    if (review.canEnable) {
      return;
    }

    throw new PermissionEngineError(
      "PLUGIN_PERMISSIONS_PENDING",
      `Plugin '${pluginId}' cannot be enabled until all declared permissions are granted.`,
      409
    );
  }

  hasActiveGrant(
    pluginId: string,
    scope: PersistedPluginPermissionGrant["scope"],
    sessionId?: string
  ): boolean {
    return this.options.repository
      .listByPluginId(pluginId)
      .some(
        (grant) =>
          grant.scope === scope &&
          isGrantActive(grant, sessionId) &&
          grant.decision !== "deny"
      );
  }

  evaluateToolExecution(input: {
    readonly tool: ToolDescriptor;
    readonly executionContext: ExecutionContext;
  }): ToolExecutionPolicyEvaluation {
    const requiredApproval = requiredApprovalForRisk(input.tool.riskLevel);

    if (
      input.tool.pluginId &&
      !this.hasActiveGrant(
        input.tool.pluginId,
        "tool.execute",
        input.executionContext.sessionId
      )
    ) {
      return toolExecutionPolicyEvaluationSchema.parse({
        allowed: false,
        requiredApproval,
        code: "PLUGIN_TOOL_EXECUTE_PERMISSION_DENIED",
        message: `Plugin '${input.tool.pluginId}' does not have an active tool.execute grant.`
      });
    }

    if (
      !approvalModeSatisfiesRequirement(
        input.executionContext.approvalMode,
        requiredApproval
      )
    ) {
      return toolExecutionPolicyEvaluationSchema.parse({
        allowed: false,
        requiredApproval,
        code: "MCP_TOOL_EXECUTION_APPROVAL_REQUIRED",
        message: `Tool '${input.tool.id}' requires explicit approval before execution.`
      });
    }

    return toolExecutionPolicyEvaluationSchema.parse({
      allowed: true,
      requiredApproval
    });
  }

  private persistGrant(
    pluginId: string,
    grant: PluginPermissionGrantInput,
    grantedAt: string
  ): PersistedPluginPermissionGrant {
    const parsedGrant = pluginPermissionGrantInputSchema.parse(grant);
    const plugin = this.requireInstalledPlugin(pluginId);
    const manifestPermission = plugin.manifest.permissions.find(
      (permission) => permission.scope === parsedGrant.scope
    );

    if (!manifestPermission) {
      throw new PermissionEngineError(
        "PLUGIN_PERMISSION_SCOPE_UNKNOWN",
        `Plugin '${pluginId}' does not declare permission scope '${parsedGrant.scope}'.`,
        400
      );
    }

    const expectedConstraint = serializePermissionConstraint(manifestPermission);
    const grantedConstraint = parsedGrant.constraint ?? expectedConstraint;

    if (!constraintsMatch(expectedConstraint, grantedConstraint)) {
      throw new PermissionEngineError(
        "PLUGIN_PERMISSION_CONSTRAINT_MISMATCH",
        `Grant constraint for scope '${parsedGrant.scope}' does not match the plugin manifest.`,
        400
      );
    }

    if (parsedGrant.decision === "deny") {
      const revokedGrant = this.options.repository.revokeGrant(
        pluginId,
        parsedGrant.scope,
        grantedAt
      );

      if (revokedGrant) {
        return revokedGrant;
      }

      throw new PermissionEngineError(
        "PLUGIN_PERMISSION_GRANT_NOT_FOUND",
        `Plugin '${pluginId}' does not have an active grant for scope '${parsedGrant.scope}'.`,
        404
      );
    }

    return this.options.repository.upsertGrant({
      pluginId,
      scope: parsedGrant.scope,
      ...(grantedConstraint ? { constraint: grantedConstraint } : {}),
      decision: parsedGrant.decision,
      grantedAt
    });
  }

  private requireInstalledPlugin(pluginId: string): InstalledPlugin {
    const plugin = this.options.installedPlugins.getInstalledPlugin(pluginId);

    if (!plugin) {
      throw new PluginRegistryError(
        "PLUGIN_NOT_FOUND",
        `Plugin '${pluginId}' is not registered.`,
        404
      );
    }

    return plugin;
  }
}

export const requirementsFromManifest = (
  permissions: readonly PluginPermissionRequest[]
): readonly PluginPermissionRequirement[] =>
  permissions.map(toPermissionRequirement);
