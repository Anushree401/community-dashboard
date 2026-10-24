import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const userIds: string[] = [];
const communityIds: string[] = [];
const badgeIds: string[] = [];

type TestUser = { id: string; token: string };

async function createUser(label: string): Promise<TestUser> {
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.user.create({
        data: {
            email: `ceh-gamification-${label}-${runId}@example.test`,
            displayName: `Gamification ${label}`,
            passwordHash: await hash("GamificationTestPassword#2026"),
            status: "ACTIVE",
            sessions: {
                create: {
                    tokenHash: createHash("sha256").update(token).digest("hex"),
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                },
            },
        },
        select: { id: true },
    });
    userIds.push(user.id);
    return { id: user.id, token };
}

function get(user: TestUser, path: string) {
    return request(app).get(path).set("Authorization", `Bearer ${user.token}`);
}
function post(user: TestUser, path: string) {
    return request(app).post(path).set("Authorization", `Bearer ${user.token}`);
}

async function createCommunity(creator: TestUser) {
    const community = await prisma.community.create({
        data: {
            name: `Gamification ${randomUUID().slice(0, 8)}`,
            slug: `gamification-${randomUUID()}`,
            createdById: creator.id,
        },
        select: { id: true },
    });
    communityIds.push(community.id);
    return community.id;
}

async function addMember(communityId: string, userId: string, role = "MEMBER", status = "ACTIVE") {
    await prisma.communityMembership.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: {
            communityId,
            userId,
            role: role as "MEMBER" | "MODERATOR" | "COMMUNITY_ADMIN",
            status: status as "ACTIVE" | "PENDING" | "BANNED",
        },
        update: {
            role: role as "MEMBER" | "MODERATOR" | "COMMUNITY_ADMIN",
            status: status as "ACTIVE" | "PENDING" | "BANNED",
        },
    });
}

async function createBadge() {
    const badge = await prisma.badge.create({
        data: {
            code: `test-${runId}-${randomUUID().slice(0, 8)}`,
            name: `Test Badge ${randomUUID().slice(0, 8)}`,
            description: "Integration test badge",
            criteria: { type: "manual-test" },
            isActive: true,
        },
        select: { id: true },
    });
    badgeIds.push(badge.id);
    return badge.id;
}

beforeAll(() => {
    if (!process.env.DATABASE_URL ||
        new URL(process.env.DATABASE_URL).pathname !== "/ceh_test_db") {
        throw new Error("Gamification integration tests require ceh_test_db.");
    }
});

afterAll(async () => {
    if (communityIds.length) {
        await prisma.community.deleteMany({ where: { id: { in: communityIds } } });
    }
    if (badgeIds.length) {
        await prisma.userBadge.deleteMany({ where: { badgeId: { in: badgeIds } } });
        await prisma.badge.deleteMany({ where: { id: { in: badgeIds } } });
    }
    if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
});

describe("Gamification HTTP integration", () => {
    it("requires authentication", async () => {
        expect((await request(app).get("/api/gamification/badges")).status).toBe(401);
        expect((await request(app).get("/api/gamification/community/not-a-uuid/points")).status)
            .toBe(401);
    });

    it("lists active badges", async () => {
        const user = await createUser("active-badges");
        const badgeId = await createBadge();

        const response = await get(user, "/api/gamification/badges");
        expect(response.status).toBe(200);
        expect(response.body.badges.some((b: { id: string }) => b.id === badgeId)).toBe(true);
    });

    it("returns zero points for a member with no transactions", async () => {
        const user = await createUser("zero-points");
        const communityId = await createCommunity(user);

        const response = await get(user, `/api/gamification/community/${communityId}/points`);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            communityId, userId: user.id, points: 0,
        });
    });

    it("awards points, rejects duplicate idempotency keys, and reports balance/history", async () => {
        const admin = await createUser("points-admin");
        const member = await createUser("points-member");
        const communityId = await createCommunity(admin);
        await addMember(communityId, member.id);

        const payload = {
            userId: member.id,
            points: 25,
            reason: "ADMIN_ADJUSTMENT",
            idempotencyKey: `points-${runId}-key1`,
        };

        const first = await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send(payload);
        expect(first.status).toBe(201);
        expect(first.body.transaction.points).toBe(25);

        const duplicate = await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send(payload);
        expect(duplicate.status).toBe(409);

        const balance = await get(member, `/api/gamification/community/${communityId}/points`);
        expect(balance.status).toBe(200);
        expect(balance.body.points).toBe(25);

        const history = await get(member, `/api/gamification/community/${communityId}/points/history`);
        expect(history.status).toBe(200);
        expect(history.body.transactions).toHaveLength(1);
        expect(history.body.pagination.total).toBe(1);
    });

    it("prevents ordinary members from awarding points or badges", async () => {
        const admin = await createUser("permission-admin");
        const member = await createUser("permission-member");
        const recipient = await createUser("permission-recipient");
        const communityId = await createCommunity(admin);
        await addMember(communityId, member.id);
        await addMember(communityId, recipient.id);
        const badgeId = await createBadge();

        expect((await post(member, `/api/gamification/community/${communityId}/points/award`)
            .send({ userId: recipient.id, points: 10, reason: "ADMIN_ADJUSTMENT" })).status)
            .toBe(403);

        expect((await post(member, `/api/gamification/community/${communityId}/badges/award`)
            .send({ userId: recipient.id, badgeId })).status).toBe(403);
    });

    it("rejects invalid point awards and inactive recipients", async () => {
        const admin = await createUser("invalid-award-admin");
        const recipient = await createUser("inactive-recipient");
        const communityId = await createCommunity(admin);
        await addMember(communityId, recipient.id, "MEMBER", "BANNED");

        const invalid = await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send({ userId: recipient.id, points: 0, reason: "ADMIN_ADJUSTMENT" });
        expect(invalid.status).toBe(400);

        const inactive = await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send({ userId: recipient.id, points: 10, reason: "ADMIN_ADJUSTMENT" });
        expect(inactive.status).toBe(404);
    });

    it("ranks active members by points and then display name", async () => {
        const admin = await createUser("leaderboard-admin");
        const memberA = await createUser("leaderboard-a");
        const memberB = await createUser("leaderboard-b");
        const communityId = await createCommunity(admin);
        await addMember(communityId, memberA.id);
        await addMember(communityId, memberB.id);

        await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send({ userId: memberA.id, points: 40, reason: "ADMIN_ADJUSTMENT" });
        await post(admin, `/api/gamification/community/${communityId}/points/award`)
            .send({ userId: memberB.id, points: 10, reason: "ADMIN_ADJUSTMENT" });

        const response = await get(admin, `/api/gamification/community/${communityId}/leaderboard`);
        expect(response.status).toBe(200);
        expect(response.body.leaderboard[0]).toMatchObject({ userId: memberA.id, points: 40, rank: 1 });
        expect(response.body.leaderboard[1]).toMatchObject({ userId: memberB.id, points: 10, rank: 2 });
    });

    it("awards a badge once and lists the current user's awards", async () => {
        const admin = await createUser("badge-admin");
        const member = await createUser("badge-member");
        const communityId = await createCommunity(admin);
        await addMember(communityId, member.id);
        const badgeId = await createBadge();

        const payload = { userId: member.id, badgeId, reason: "Completed test milestone" };
        const first = await post(admin, `/api/gamification/community/${communityId}/badges/award`)
            .send(payload);
        expect(first.status).toBe(201);

        const duplicate = await post(admin, `/api/gamification/community/${communityId}/badges/award`)
            .send(payload);
        expect(duplicate.status).toBe(409);

        const awards = await get(member, `/api/gamification/community/${communityId}/badges`);
        expect(awards.status).toBe(200);
        expect(awards.body.awards).toHaveLength(1);
        expect(awards.body.awards[0].badge.id).toBe(badgeId);
    });

    it("validates IDs and pagination limits", async () => {
        const user = await createUser("bad-params");
        const communityId = await createCommunity(user);

        expect((await get(user, "/api/gamification/community/not-a-uuid/leaderboard")).status)
            .toBe(400);
        expect((await get(user, `/api/gamification/community/${communityId}/leaderboard?limit=101`)).status)
            .toBe(400);
        expect((await get(user, `/api/gamification/community/${communityId}/points/history?limit=0`)).status)
            .toBe(400);
    });
});