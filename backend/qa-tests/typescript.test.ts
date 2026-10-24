import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

describe("TypeScript compilation", () => {
  it("passes tsc --noEmit", () => {
    const result = spawnSync(
      process.execPath,
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      { encoding: "utf8", timeout: 120_000 }
    );

    expect(
      result.status,
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`
    ).toBe(0);
  });
});
