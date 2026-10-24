import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

describe("Prisma schema", () => {
  it("passes Prisma schema validation", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "validate"],
      { encoding: "utf8", timeout: 120_000 }
    );

    expect(
      result.status,
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    ).toBe(0);
  });
});
