import type {
  ToolAnnotations,
  ToolRiskLevel
} from "@engineering-os/contracts/unstable-runtime";

export interface ToolClassificationInput {
  readonly name: string;
  readonly annotations?: ToolAnnotations;
}

const PRIVILEGED_NAME_PATTERN =
  /\b(exec(ute)?\s*(shell|command|cmd)|shell\s*command|run\s*command|sudo|admin|privilege|subprocess|spawn|terminal)\b/i;

const DESTRUCTIVE_NAME_PATTERN =
  /\b(delete|remove|drop|destroy|purge|truncate|force\s*push|delete\s*branch|merge\s*pull)\b/i;

const WRITE_NAME_PATTERN =
  /\b(create|update|write|post|send|append|comment|commit|push|upload|insert|set|merge|apply|patch)\b/i;

const READ_ONLY_NAME_PATTERN =
  /\b(get|list|search|read|fetch|find|query|describe|show|view|lookup|inspect|browse|scan)\b/i;

const normalizeToolName = (name: string): string =>
  name.trim().toLowerCase().replace(/[_-]+/g, " ");

const inferRiskFromName = (name: string): ToolRiskLevel | null => {
  const normalized = normalizeToolName(name);

  if (!normalized) {
    return null;
  }

  if (PRIVILEGED_NAME_PATTERN.test(normalized)) {
    return "privileged";
  }

  if (DESTRUCTIVE_NAME_PATTERN.test(normalized)) {
    return "destructive";
  }

  if (WRITE_NAME_PATTERN.test(normalized)) {
    return "write";
  }

  if (READ_ONLY_NAME_PATTERN.test(normalized)) {
    return "read-only";
  }

  return null;
};

export const classifyToolRiskLevel = (
  input: ToolClassificationInput
): ToolRiskLevel => {
  const nameRisk = inferRiskFromName(input.name);

  if (input.annotations?.destructiveHint) {
    return "destructive";
  }

  if (nameRisk === "privileged" || nameRisk === "destructive") {
    return nameRisk;
  }

  if (nameRisk === "write") {
    return "write";
  }

  if (input.annotations?.readOnlyHint && nameRisk === "read-only") {
    return "read-only";
  }

  if (nameRisk === "read-only") {
    return "read-only";
  }

  return "unknown";
};
