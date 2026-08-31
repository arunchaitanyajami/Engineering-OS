const sensitiveEnvironmentKeyPattern =
  /(^|_)(API_KEY|ACCESS_KEY|CLIENT_SECRET|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIALS?|KEY)(_|$)/i;

export const isSensitiveEnvironmentKey = (key: string): boolean =>
  sensitiveEnvironmentKeyPattern.test(key);

export const findLiteralSecretEnvironmentViolations = (
  environment: Readonly<Record<string, unknown>>
): readonly string[] => {
  const violations: string[] = [];

  for (const [key, value] of Object.entries(environment)) {
    if (
      typeof value === "string" &&
      value.trim().length > 0 &&
      isSensitiveEnvironmentKey(key)
    ) {
      violations.push(key);
    }
  }

  return violations;
};
