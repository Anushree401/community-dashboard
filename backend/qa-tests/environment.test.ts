import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

describe("Environment and project files", () => {
  it.each([
    "package.json",
    "tsconfig.json",
    "prisma/schema.prisma",
    "node_modules/typescript/bin/tsc",
    "node_modules/prisma/build/index.js",
    "node_modules/vitest/vitest.mjs",
    "node_modules/tsx/dist/cli.mjs",
  ])("checks that %s exists", (file) => {
    expect(existsSync(resolve(root, file)), `${file} is missing`).toBe(true);
  });
});
