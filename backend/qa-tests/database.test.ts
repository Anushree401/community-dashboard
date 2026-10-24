import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

describe("PostgreSQL container status", () => {
  it("checks Docker availability without changing containers", () => {
    const docker = spawnSync("docker", ["info"], {
      encoding: "utf8",
      timeout: 15_000,
    });

    if (docker.error?.message.includes("ENOENT")) {
      console.warn("SKIP: Docker is not installed.");
      return;
    }

    expect(
      docker.status,
      `Docker daemon unavailable: ${docker.stderr ?? ""}`
    ).toBe(0);

    const inspect = spawnSync(
      "docker",
      [
        "inspect",
        "-f",
        "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}",
        "ceh-postgres",
      ],
      { encoding: "utf8", timeout: 15_000 }
    );

    if (inspect.status !== 0) {
      console.warn("SKIP: ceh-postgres container was not found.");
      return;
    }

    const [state, health] = inspect.stdout.trim().split("|");
    expect(state, "ceh-postgres is not running").toBe("running");

    if (health !== "healthy") {
      console.warn(`PostgreSQL health status: ${health}`);
    }
  });
});
