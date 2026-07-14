import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendHost = process.env.FRONTEND_HOST ?? "127.0.0.1";
const frontendPort = Number.parseInt(process.env.FRONTEND_PORT ?? "1420", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    host: frontendHost,
    port: Number.isNaN(frontendPort) ? 1420 : frontendPort,
    strictPort: true
  }
});
