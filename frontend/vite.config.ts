import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BACKEND_URL = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/auth": BACKEND_URL,
      "/requests": BACKEND_URL,
      "/admin/requests": BACKEND_URL,
      "/admin/audit": BACKEND_URL,
      "/sessions": BACKEND_URL,
      "/policy": BACKEND_URL,
      "/health": BACKEND_URL,
    },
  },
});
