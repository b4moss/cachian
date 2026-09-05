import { resolve } from "node:path";
import { defineConfig } from "vite";

const entry = resolve(import.meta.dirname, "src/index.ts");

export default defineConfig(({ mode }) => {
  const minify = mode === "minify";
  return {
    build: {
      emptyOutDir: false,
      lib: {
        entry,
        name: "Cachian",
        formats: ["iife"],
        fileName: () =>
          minify ? "cachian.iife.min.js" : "cachian.iife.js",
      },
      // Vite 8: prefer oxc minify (no separate esbuild dependency).
      minify: minify ? "oxc" : false,
    },
  };
});
