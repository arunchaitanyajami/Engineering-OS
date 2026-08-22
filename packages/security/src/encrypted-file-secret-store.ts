import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";

import type { SecretStore } from "@engineering-os/contracts/unstable-runtime";

import { SecretServiceError } from "./errors.js";
import { assertValidSecretKey, assertValidSecretNamespace } from "./namespace.js";

const SECRET_STORE_VERSION = "v1";
const MASTER_KEY_BYTES = 32;
const MASTER_KEY_FILE_NAME = ".master-key";
const NAMESPACE_FILE_EXTENSION = ".secrets.json";

interface NamespaceSecretFile {
  readonly version: typeof SECRET_STORE_VERSION;
  readonly secrets: Record<string, string>;
}

const encryptSecretValue = (plaintext: string, masterKey: Buffer): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_STORE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
};

const decryptSecretValue = (
  ciphertext: string,
  masterKey: Buffer
): string => {
  const [version, ivValue, tagValue, encryptedValue] = ciphertext.split(":");

  if (
    version !== SECRET_STORE_VERSION ||
    !ivValue ||
    !tagValue ||
    !encryptedValue
  ) {
    throw new SecretServiceError(
      "SECRET_STORE_CORRUPT",
      "Stored secret payload is invalid.",
      500
    );
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey,
    Buffer.from(ivValue, "base64url")
  );

  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
};

const namespaceFileName = (namespace: string): string =>
  `${encodeURIComponent(namespace)}${NAMESPACE_FILE_EXTENSION}`;

const readNamespaceFile = async (
  filePath: string
): Promise<NamespaceSecretFile> => {
  try {
    const serialized = await readFile(filePath, "utf8");
    const parsed = JSON.parse(serialized) as NamespaceSecretFile;

    if (
      parsed.version !== SECRET_STORE_VERSION ||
      typeof parsed.secrets !== "object" ||
      parsed.secrets === null
    ) {
      throw new SecretServiceError(
        "SECRET_STORE_CORRUPT",
        "Secret namespace file is invalid.",
        500
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof SecretServiceError) {
      throw error;
    }

    throw new SecretServiceError(
      "SECRET_STORE_READ_FAILED",
      "Secret namespace file could not be read.",
      500,
      error
    );
  }
};

const writeNamespaceFile = async (
  filePath: string,
  payload: NamespaceSecretFile
): Promise<void> => {
  await writeFile(filePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
};

export class EncryptedFileSecretStore implements SecretStore {
  private constructor(
    private readonly secretsDirectory: string,
    private readonly masterKey: Buffer
  ) {}

  static async open(secretsDirectory: string): Promise<EncryptedFileSecretStore> {
    await mkdir(secretsDirectory, { recursive: true });

    const masterKeyPath = join(secretsDirectory, MASTER_KEY_FILE_NAME);
    let masterKey: Buffer;

    try {
      await access(masterKeyPath, fsConstants.F_OK);
      masterKey = await readFile(masterKeyPath);

      if (masterKey.length !== MASTER_KEY_BYTES) {
        throw new SecretServiceError(
          "SECRET_STORE_MASTER_KEY_INVALID",
          "Secret store master key is invalid.",
          500
        );
      }
    } catch (error) {
      if (error instanceof SecretServiceError) {
        throw error;
      }

      masterKey = randomBytes(MASTER_KEY_BYTES);
      await writeFile(masterKeyPath, masterKey, { mode: 0o600 });
    }

    return new EncryptedFileSecretStore(secretsDirectory, masterKey);
  }

  private namespaceFilePath(namespace: string): string {
    assertValidSecretNamespace(namespace);
    return join(this.secretsDirectory, namespaceFileName(namespace));
  }

  private async readNamespaceSecrets(
    namespace: string
  ): Promise<NamespaceSecretFile> {
    const filePath = this.namespaceFilePath(namespace);

    try {
      await access(filePath, fsConstants.F_OK);
    } catch {
      return {
        version: SECRET_STORE_VERSION,
        secrets: {}
      };
    }

    return readNamespaceFile(filePath);
  }

  async get(namespace: string, key: string): Promise<string | null> {
    assertValidSecretKey(key);
    const namespaceSecrets = await this.readNamespaceSecrets(namespace);
    const encryptedValue = namespaceSecrets.secrets[key];

    if (!encryptedValue) {
      return null;
    }

    return decryptSecretValue(encryptedValue, this.masterKey);
  }

  async set(namespace: string, key: string, value: string): Promise<void> {
    assertValidSecretKey(key);

    if (value.length === 0) {
      throw new SecretServiceError(
        "SECRET_VALUE_INVALID",
        "Secret value must not be empty.",
        400
      );
    }

    const namespaceSecrets = await this.readNamespaceSecrets(namespace);
    const nextSecrets = {
      ...namespaceSecrets.secrets,
      [key]: encryptSecretValue(value, this.masterKey)
    };

    await writeNamespaceFile(this.namespaceFilePath(namespace), {
      version: SECRET_STORE_VERSION,
      secrets: nextSecrets
    });
  }

  async delete(namespace: string, key: string): Promise<void> {
    assertValidSecretKey(key);
    const namespaceSecrets = await this.readNamespaceSecrets(namespace);

    if (!(key in namespaceSecrets.secrets)) {
      return;
    }

    const nextSecrets = { ...namespaceSecrets.secrets };
    delete nextSecrets[key];

    const filePath = this.namespaceFilePath(namespace);

    if (Object.keys(nextSecrets).length === 0) {
      await rm(filePath, { force: true });
      return;
    }

    await writeNamespaceFile(filePath, {
      version: SECRET_STORE_VERSION,
      secrets: nextSecrets
    });
  }

  async listKeys(namespace: string): Promise<string[]> {
    const namespaceSecrets = await this.readNamespaceSecrets(namespace);
    return Object.keys(namespaceSecrets.secrets).sort();
  }

  async listNamespaces(): Promise<string[]> {
    const entries = await readdir(this.secretsDirectory, {
      withFileTypes: true
    });

    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(NAMESPACE_FILE_EXTENSION) &&
          entry.name !== MASTER_KEY_FILE_NAME
      )
      .map((entry) =>
        decodeURIComponent(
          entry.name.slice(0, -NAMESPACE_FILE_EXTENSION.length)
        )
      )
      .sort();
  }
}
