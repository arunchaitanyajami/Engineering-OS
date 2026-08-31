import { GitHubPluginError, redactSecrets } from "../client/github-errors.js";

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : value.slice(0, max);

const normalizeIsoTimestamp = (value: string): string => {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: "GitHub timestamp could not be normalized.",
      retryable: false
    });
  }

  return parsed.toISOString();
};

export const mapGitHubPayload = <TValue>(
  label: string,
  parse: () => TValue
): TValue => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof GitHubPluginError) {
      throw error;
    }

    throw new GitHubPluginError({
      code: "VALIDATION_ERROR",
      message: redactSecrets(
        `GitHub ${label} payload could not be mapped to the domain contract.`
      ),
      retryable: false
    });
  }
};

export const mappingHelpers = {
  truncate,
  normalizeIsoTimestamp
};
