import { resolve } from "node:path";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

const entry = resolve(import.meta.dirname, "src/index.ts");

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      exclude: ["src/**/*.test.ts"],
      rollupTypes: true,
      insertTypesEntry: true,
      outDir: "dist",
    }),
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry,
      name: "Cachian",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "cachian.js" : "cachian.cjs"),
    },
    minify: false,
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
