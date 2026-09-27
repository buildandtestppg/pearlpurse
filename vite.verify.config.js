import { defineConfig } from "vite";

// Standalone verifier bundle for /verify (verify.html loads /verify-check.js).
// IIFE + inlineDynamicImports → one self-contained file, no shared chunks with the app.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: "src/verify-entry.js",
      formats: ["iife"],
      name: "PearlVerify",
      fileName: () => "verify-check.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
