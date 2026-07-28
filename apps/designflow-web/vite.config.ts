// apps/designflow-web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API runs beside this in development; proxying keeps the client's
    // fetch calls same-origin so there is no CORS story to explain.
    proxy: {
      "/api": {
        target: process.env.DESIGNFLOW_API ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
