import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "..");
const desktopDirectory = join(workspaceRoot, "apps", "desktop");
const DEFAULT_FRONTEND_HOST = "127.0.0.1";
const DEFAULT_BACKEND_HOST = "127.0.0.1";

const resolveFreePort = async (host) =>
  new Promise((resolvePort, reject) => {
    const server = net.createServer();

    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Failed to allocate a development port."));
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

const startTauriDev = async () => {
  const frontendHost = process.env.FRONTEND_HOST ?? DEFAULT_FRONTEND_HOST;
  const backendHost =
    process.env.EOS_DESKTOP_BACKEND_HOST ?? DEFAULT_BACKEND_HOST;
  const frontendPort = await resolveFreePort(frontendHost);
  const backendPort = await resolveFreePort(backendHost);
  const backendAuthToken = randomBytes(32).toString("hex");
  const allowedOrigin = `http://${frontendHost}:${frontendPort}`;
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "engineering-os-tauri-dev-")
  );
  const overrideConfigPath = join(
    temporaryDirectory,
    "tauri.dev.override.json"
  );
  const overrideConfig = {
    build: {
      devUrl: `http://${frontendHost}:${frontendPort}`
    }
  };

  await writeFile(overrideConfigPath, JSON.stringify(overrideConfig), "utf8");

  console.log(
    [
      "Starting Engineering OS desktop dev runtime with dynamic ports:",
      `  frontend: http://${frontendHost}:${frontendPort}`,
      `  backend:  http://${backendHost}:${backendPort}`
    ].join("\n")
  );

  const child = spawn(
    "pnpm",
    ["exec", "tauri", "dev", "--config", overrideConfigPath],
    {
      cwd: desktopDirectory,
      stdio: "inherit",
      env: {
        ...process.env,
        FRONTEND_HOST: frontendHost,
        FRONTEND_PORT: String(frontendPort),
        EOS_DESKTOP_BACKEND_HOST: backendHost,
        EOS_DESKTOP_BACKEND_PORT: String(backendPort),
        EOS_DESKTOP_BACKEND_AUTH_TOKEN: backendAuthToken,
        EOS_DESKTOP_ALLOWED_ORIGIN: allowedOrigin
      }
    }
  );

  const cleanup = async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  };

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", async (code, signal) => {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    await cleanup();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", async (error) => {
    await cleanup();
    console.error("Failed to start Tauri development mode.", error);
    process.exit(1);
  });
};

void startTauriDev().catch((error) => {
  console.error("Failed to prepare Engineering OS desktop dev runtime.", error);
  process.exit(1);
});
