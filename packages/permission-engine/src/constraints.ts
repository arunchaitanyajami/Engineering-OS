import type { PluginPermissionRequest } from "@engineering-os/contracts";
import type { PluginPermissionRequirement } from "@engineering-os/contracts/unstable-runtime";

export const serializePermissionConstraint = (
  permission: PluginPermissionRequest
): Record<string, unknown> | undefined => {
  if (
    permission.scope === "filesystem.read" ||
    permission.scope === "filesystem.write" ||
    permission.scope === "filesystem.watch"
  ) {
    return { paths: permission.paths };
  }

  if (permission.scope === "network.access") {
    return { hosts: permission.hosts };
  }

  return undefined;
};

export const toPermissionRequirement = (
  permission: PluginPermissionRequest
): PluginPermissionRequirement => ({
  scope: permission.scope,
  reason: permission.reason,
  ...(serializePermissionConstraint(permission)
    ? { constraint: serializePermissionConstraint(permission) }
    : {})
});

export const constraintsMatch = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
