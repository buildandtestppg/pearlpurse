import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "verify-check-fixed-name",
      closeBundle() {
        // copy the hashed verify chunk to the fixed name verify.html expects
        const fs = require("fs");
        const f = fs.readdirSync("dist/assets").find((f) => f.startsWith("verify-") && f.endsWith(".js"));
        if (f) fs.copyFileSync(`dist/assets/${f}`, "dist/verify-check.js");
      },
    },
  ],
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
