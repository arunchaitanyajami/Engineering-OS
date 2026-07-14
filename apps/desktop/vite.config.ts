import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { workspaceAliases } from "../../scripts/workspace-aliases";

const frontendHost = process.env.FRONTEND_HOST ?? "127.0.0.1";
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? "1420", 10);

export default defineConfig({
  resolve: {
    alias: workspaceAliases
  },
  plugins: [react()],
  server: {
    host: frontendHost,
    port: Number.isNaN(frontendPort) ? 1420 : frontendPort,
    strictPort: true
  }
});
