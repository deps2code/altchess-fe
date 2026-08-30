import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ws: true so the game WebSocket (GET /api/v1/games/{id}/ws) upgrades
      // through the proxy instead of being handled as plain HTTP.
      "/api": { target: "http://localhost:8080", ws: true },
      "/healthz": "http://localhost:8080",
    },
  },
  build: {
    target: "es2022",
  },
});

