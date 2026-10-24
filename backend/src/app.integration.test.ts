import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "./app.js";
import prisma from "./lib/prisma.js";

describe("Express application integration", () => {
  it("GET /health returns the API health status", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "ceh-api",
    });
  });

  it("GET /health/db confirms the test database is reachable", async () => {
    const response = await request(app).get("/health/db");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      service: "ceh-api",
      database: "reachable",
    });
  });

  it("returns 404 for an unknown route", async () => {
    const response = await request(app).get("/api/__integration_test_unknown_route__");

    expect(response.status).toBe(404);
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
