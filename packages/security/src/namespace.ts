import { keySchema } from "@engineering-os/contracts";

import { SecretServiceError } from "./errors.js";

const namespaceSchema = keySchema;

export const assertValidSecretNamespace = (namespace: string): void => {
  const result = namespaceSchema.safeParse(namespace);

  if (!result.success) {
    throw new SecretServiceError(
      "SECRET_NAMESPACE_INVALID",
      "Secret namespace is invalid.",
      400
    );
  }
};

export const assertValidSecretKey = (key: string): void => {
  const result = keySchema.safeParse(key);

  if (!result.success) {
    throw new SecretServiceError(
      "SECRET_KEY_INVALID",
      "Secret key is invalid.",
      400
    );
  }
};
