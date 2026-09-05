#!/usr/bin/env node
/**
 * Multi-format library build for @b4moss/cachian.
 * 1) ESM + CJS (+ d.ts) via vite.config.ts
 * 2) IIFE (CDN) via vite.cdn.config.ts
 * 3) IIFE minify (CDN) via vite.cdn.config.ts --mode minify
 */
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  configFile: join(pkg, "vite.config.ts"),
  root: pkg,
});
await build({
  configFile: join(pkg, "vite.cdn.config.ts"),
  root: pkg,
});
await build({
  configFile: join(pkg, "vite.cdn.config.ts"),
  root: pkg,
  mode: "minify",
});
