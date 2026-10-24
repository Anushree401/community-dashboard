import { afterAll, describe, expect, it } from "vitest";

const port = Number(process.env.PORT || 3000);
const baseUrl = `http://127.0.0.1:${port}`;

describe("Backend HTTP smoke tests", () => {
  it.each(["/health", "/health/db"])(
    "returns a successful response from %s",
    async (endpoint) => {
      let response: Response;

      try {
        response = await fetch(`${baseUrl}${endpoint}`, {
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new Error(
          `Cannot reach ${baseUrl}${endpoint}. Start the backend first.`
        );
      }

      expect(
        response.status,
        `${endpoint} returned HTTP ${response.status}`
      ).toBeGreaterThanOrEqual(200);

      expect(response.status).toBeLessThan(300);
    }
  );
});
