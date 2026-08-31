import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
const desktopDirectory = join(workspaceRoot, "apps", "desktop");
const DEFAULT_FRONTEND_HOST = "127.0.0.1";
const DEFAULT_BACKEND_HOST = "127.0.0.1";
const DEFAULT_FRONTEND_PORT = "4173";
const READY_MESSAGE_PREFIX = "ENGINEERING_OS_BACKEND_READY ";

const resolveFreePort = async (host) =>
  new Promise((resolvePort, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate an E2E backend port."));
        });
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePort(address.port);
      });
    });
  });

const waitForBackendReady = (child) =>
  new Promise((resolveReady, rejectReady) => {
    let buffer = "";

    const handleOutput = (chunk) => {
      buffer += chunk.toString();
      const markerIndex = buffer.indexOf(READY_MESSAGE_PREFIX);

      if (markerIndex === -1) {
        return;
      }

      const payloadStart = markerIndex + READY_MESSAGE_PREFIX.length;
      const payloadEnd = buffer.indexOf("\n", payloadStart);
      const payload =
        payloadEnd === -1
          ? buffer.slice(payloadStart)
          : buffer.slice(payloadStart, payloadEnd);

      try {
        resolveReady(JSON.parse(payload));
      } catch (error) {
        rejectReady(error);
      } finally {
        child.stdout?.off("data", handleOutput);
        child.stderr?.off("data", handleOutput);
      }
    };

    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    child.on("exit", (code) => {
      rejectReady(
        new Error(`Desktop backend exited before becoming ready (${code}).`)
      );
    });
  });

const startE2eDesktopEnv = async () => {
  const frontendHost = process.env.FRONTEND_HOST ?? DEFAULT_FRONTEND_HOST;
  const backendHost =
    process.env.EOS_DESKTOP_BACKEND_HOST ?? DEFAULT_BACKEND_HOST;
  const frontendPort = process.env.FRONTEND_PORT ?? DEFAULT_FRONTEND_PORT;
  const backendPort = await resolveFreePort(backendHost);
  const backendAuthToken = randomBytes(32).toString("hex");
  const allowedOrigin = `http://${frontendHost}:${frontendPort}`;
  const appDataDirectory = await mkdtemp(
    join(tmpdir(), "engineering-os-e2e-backend-")
  );
  const backendBaseUrl = `http://${backendHost}:${backendPort}`;

  console.log(
    [
      "Starting Engineering OS Playwright E2E environment:",
      `  frontend: http://${frontendHost}:${frontendPort}`,
      `  backend:  ${backendBaseUrl}`
    ].join("\n")
  );

  const backendChild = spawn(
    "pnpm",
    ["--filter", "@engineering-os/desktop-backend", "dev"],
    {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        EOS_APPLICATION_DATA_DIR: appDataDirectory,
        EOS_DESKTOP_BACKEND_HOST: backendHost,
        EOS_DESKTOP_BACKEND_PORT: String(backendPort),
        EOS_DESKTOP_BACKEND_AUTH_TOKEN: backendAuthToken,
        EOS_DESKTOP_ALLOWED_ORIGIN: allowedOrigin
      }
    }
  );

  await waitForBackendReady(backendChild);

  const frontendChild = spawn(
    "pnpm",
    ["--filter", "@engineering-os/desktop", "dev:e2e"],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        FRONTEND_HOST: frontendHost,
        FRONTEND_PORT: frontendPort,
        VITE_E2E_BACKEND: "true",
        VITE_E2E_BACKEND_URL: backendBaseUrl,
        VITE_E2E_BACKEND_TOKEN: backendAuthToken
      }
    }
  );

  const children = [backendChild, frontendChild];

  const cleanup = async () => {
    await rm(appDataDirectory, { recursive: true, force: true });
  };

  const forwardSignal = (signal) => {
    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  const handleExit = async () => {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    await cleanup();
  };

  backendChild.on("exit", async (code) => {
    if (!frontendChild.killed) {
      frontendChild.kill("SIGTERM");
    }

    await handleExit();
    process.exit(code ?? 1);
  });

  frontendChild.on("exit", async (code, signal) => {
    if (!backendChild.killed) {
      backendChild.kill("SIGTERM");
    }

    await handleExit();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  frontendChild.on("error", async (error) => {
    await handleExit();
    console.error("Failed to start Playwright frontend server.", error);
    process.exit(1);
  });
};

void startE2eDesktopEnv().catch((error) => {
  console.error("Failed to prepare Playwright E2E environment.", error);
  process.exit(1);
});
