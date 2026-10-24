import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";

vi.mock("../lib/email.js", () => ({
  sendVerificationOtp: vi.fn().mockResolvedValue(undefined),
}));

import app from "../app.js";
import prisma from "../lib/prisma.js";
import { sendVerificationOtp } from "../lib/email.js";

const PASSWORD = "SecureTestPassword#2026";
const TEST_OTP = "123456";
const testId = randomUUID().replaceAll("-", "");
const email = (name: string) => `ceh-${name}-${testId}@example.test`;

const mockSendOtp = vi.mocked(sendVerificationOtp);
const createdUserIds: string[] = [];

async function createUser(
  name: string,
  status: "ACTIVE" | "PENDING_VERIFICATION" | "SUSPENDED" = "ACTIVE",
) {
  const user = await prisma.user.create({
    data: {
      email: email(name),
      displayName: `Test ${name}`,
      passwordHash: await hash(PASSWORD),
      status,
    },
  });

  createdUserIds.push(user.id);
  return user;
}

async function createChallenge(
  userId: string,
  overrides: {
    expiresAt?: Date;
    attempts?: number;
    consumedAt?: Date;
    createdAt?: Date;
  } = {},
) {
  const secret = process.env.OTP_HASH_SECRET!;

  return prisma.emailVerificationChallenge.create({
    data: {
      userId,
      codeHash: createHmac("sha256", secret)
        .update(`${userId}:${TEST_OTP}`)
        .digest("hex"),
      expiresAt: overrides.expiresAt ??
        new Date(Date.now() + 10 * 60 * 1000),
      attempts: overrides.attempts ?? 0,
      consumedAt: overrides.consumedAt,
      createdAt: overrides.createdAt,
    },
  });
}

beforeAll(() => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toBe("/ceh_test_db");
  mockSendOtp.mockClear();
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: createdUserIds } },
  });

  await prisma.$disconnect();
});

describe("Authentication HTTP integration", () => {
  it("rejects invalid registration data", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: "not-an-email",
        password: "short",
        displayName: "A",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid registration data");
  });

  it("registers a pending user and creates an OTP challenge", async () => {
    const address = email("registration");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: address,
        password: PASSWORD,
        displayName: "Registration Test",
      });

    expect(response.status).toBe(201);
    expect(response.body.user.status).toBe("PENDING_VERIFICATION");

    const user = await prisma.user.findUnique({
      where: { email: address },
      include: { emailVerificationChallenges: true },
    });

    expect(user).not.toBeNull();
    expect(user!.emailVerificationChallenges).toHaveLength(1);
    expect(mockSendOtp).toHaveBeenCalled();

    createdUserIds.push(user!.id);
  });

  it("rejects registration with an existing email", async () => {
    const user = await createUser("duplicate");

    const response = await request(app)
      .post("/api/auth/register")
      .send({
        email: user.email,
        password: PASSWORD,
        displayName: "Duplicate Test",
      });

    expect(response.status).toBe(409);
  });

  it("rejects an incorrect OTP and increments attempts", async () => {
    const user = await createUser("incorrect-otp", "PENDING_VERIFICATION");
    const challenge = await createChallenge(user.id);

    const response = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: user.email, otp: "999999" });

    expect(response.status).toBe(400);

    const updated = await prisma.emailVerificationChallenge.findUnique({
      where: { id: challenge.id },
    });

    expect(updated?.attempts).toBe(1);
  });

  it("rejects an expired OTP", async () => {
    const user = await createUser("expired-otp", "PENDING_VERIFICATION");

    await createChallenge(user.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const response = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: user.email, otp: TEST_OTP });

    expect(response.status).toBe(400);
  });

  it("rejects an OTP after five failed attempts", async () => {
    const user = await createUser("locked-otp", "PENDING_VERIFICATION");

    await createChallenge(user.id, { attempts: 5 });

    const response = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: user.email, otp: TEST_OTP });

    expect(response.status).toBe(400);
  });

  it("verifies an OTP and prevents replay", async () => {
    const user = await createUser("valid-otp", "PENDING_VERIFICATION");
    const challenge = await createChallenge(user.id);

    const first = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: user.email, otp: TEST_OTP });

    expect(first.status).toBe(200);

    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });

    expect(updatedUser?.status).toBe("ACTIVE");

    const updatedChallenge = await prisma.emailVerificationChallenge.findUnique({
      where: { id: challenge.id },
    });

    expect(updatedChallenge?.consumedAt).not.toBeNull();

    const replay = await request(app)
      .post("/api/auth/verify-email")
      .send({ email: user.email, otp: TEST_OTP });

    expect(replay.status).toBe(400);
  });

  it("returns a generic response for an unknown resend email", async () => {
    const response = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: email("nonexistent") });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("If this account");
  });

  it("does not resend during the cooldown", async () => {
    const user = await createUser("cooldown", "PENDING_VERIFICATION");
    await createChallenge(user.id);

    mockSendOtp.mockClear();

    const response = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: user.email });

    expect(response.status).toBe(200);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("rejects incorrect login credentials", async () => {
    const user = await createUser("wrong-password");

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "IncorrectPassword" });

    expect(response.status).toBe(401);
  });

  it("prevents unverified users from logging in", async () => {
    const user = await createUser("unverified", "PENDING_VERIFICATION");

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("prevents suspended users from logging in", async () => {
    const user = await createUser("suspended", "SUSPENDED");

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(401);
  });

  it("logs in, authenticates /me, logs out, and invalidates the token", async () => {
    const user = await createUser("session");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.token).toEqual(expect.any(String));

    const token = login.body.token as string;

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user.id);

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logout.status).toBe(204);

    const afterLogout = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(afterLogout.status).toBe(401);
  });

  it("rejects requests without authentication", async () => {
    const response = await request(app).get("/api/auth/me");

    expect(response.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
  });
});
