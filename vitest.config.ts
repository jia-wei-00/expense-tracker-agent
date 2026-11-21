import { defineConfig } from "vitest/config";

// eslint-disable-next-line no-restricted-exports -- tooling config must default-export, like src/index.ts
export default defineConfig({
  // Root-relative, so no node:path import is needed (the repo has no Node types).
  resolve: { alias: [{ find: /^@\//, replacement: "/src/" }] },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
