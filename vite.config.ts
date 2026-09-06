import { resolve } from "node:path";
import dts from "vite-plugin-dts";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

const entries = {
  index: resolve(root, "src/index.ts"),
  "drivers/localStorage": resolve(root, "src/drivers/localStorage.ts"),
  "drivers/indexedDB": resolve(root, "src/drivers/indexedDB.ts"),
  "methods/get": resolve(root, "src/methods/get.ts"),
  "methods/set": resolve(root, "src/methods/set.ts"),
  "methods/update": resolve(root, "src/methods/update.ts"),
  "methods/upsert": resolve(root, "src/methods/upsert.ts"),
  "methods/remove": resolve(root, "src/methods/remove.ts"),
  "methods/has": resolve(root, "src/methods/has.ts"),
  "methods/clear": resolve(root, "src/methods/clear.ts"),
  "methods/purge": resolve(root, "src/methods/purge.ts"),
};

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/cdn.ts"],
      rollupTypes: false,
      insertTypesEntry: true,
      outDir: "dist",
    }),
  ],
  build: {
    emptyOutDir: true,
    lib: {
      entry: entries,
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const ext = format === "es" ? "js" : "cjs";
        return `${entryName}.${ext}`;
      },
    },
    minify: false,
    rollupOptions: {
      // Keep method/driver boundaries so consumers can tree-shake.
      output: {
        preserveModules: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/types.ts", "src/cdn.ts"],
    },
  },
});
