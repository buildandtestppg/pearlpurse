import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { app: "/app.html", verify: "/src/verify-entry.js" },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://blockbook.pearlresearch.ai",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, "/api"),
      },
    },
  },
});
