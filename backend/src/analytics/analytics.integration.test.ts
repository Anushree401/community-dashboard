import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const userIds: string[] = [];
const communityIds: string[] = [];
const postIds: string[] = [];

type TestUser = { id: string; token: string };

async function createUser(label: string): Promise<TestUser> {
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.user.create({
        data: {
            email: `ceh-analytics-${label}-${runId}@example.test`,
            displayName: `Analytics ${label}`,
            passwordHash: await hash("AnalyticsTestPassword#2026"),
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

async function createCommunity(creator: TestUser) {
    const community = await prisma.community.create({
        data: {
            name: `Analytics ${randomUUID().slice(0, 8)}`,
            slug: `analytics-${randomUUID()}`,
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

beforeAll(() => {
    if (!process.env.DATABASE_URL ||
        new URL(process.env.DATABASE_URL).pathname !== "/ceh_test_db") {
        throw new Error("Analytics integration tests require ceh_test_db.");
    }
});

afterAll(async () => {
    if (communityIds.length) {
        await prisma.community.deleteMany({ where: { id: { in: communityIds } } });
    }
    if (postIds.length) {
        await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    }
    if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
});

describe("Analytics HTTP integration", () => {
    it("requires authentication", async () => {
        expect((await request(app).get("/api/analytics/community/not-a-uuid/overview")).status)
            .toBe(401);
    });

    it("restricts analytics to admins and moderators", async () => {
        const admin = await createUser("access-admin");
        const member = await createUser("access-member");
        const moderator = await createUser("access-moderator");
        const communityId = await createCommunity(admin);
        await addMember(communityId, member.id);
        await addMember(communityId, moderator.id, "MODERATOR");

        expect((await get(member, `/api/analytics/community/${communityId}/overview`)).status)
            .toBe(403);
        expect((await get(moderator, `/api/analytics/community/${communityId}/overview`)).status)
            .toBe(200);
        expect((await get(admin, `/api/analytics/community/${communityId}/overview`)).status)
            .toBe(200);
    });

    it("returns overview metrics with the expected structure", async () => {
        const admin = await createUser("overview");
        const member = await createUser("overview-member");
        const communityId = await createCommunity(admin);
        await addMember(communityId, member.id);

        const response = await get(admin, `/api/analytics/community/${communityId}/overview`);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            communityId,
            members: { total: 1, active: 1, pending: 0 },
            content: {
                publishedPosts: 0,
                publishedAnnouncements: 0,
                comments: 0,
                reactions: 0,
            },
            gamification: { netPointsAwarded: 0 },
        });
    });

    it("returns the requested number of membership-growth days", async () => {
        const admin = await createUser("growth");
        const communityId = await createCommunity(admin);

        const response = await get(admin, `/api/analytics/community/${communityId}/membership-growth?days=7`);
        expect(response.status).toBe(200);
        expect(response.body.communityId).toBe(communityId);
        expect(response.body.days).toBe(7);
        expect(response.body.growth).toHaveLength(7);
        expect(response.body.growth.every((d: { date: string; newMembers: number }) =>
            /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.newMembers === "number",
        )).toBe(true);
    });

    it("returns daily engagement buckets", async () => {
        const admin = await createUser("engagement");
        const communityId = await createCommunity(admin);

        const response = await get(admin, `/api/analytics/community/${communityId}/engagement?days=3`);
        expect(response.status).toBe(200);
        expect(response.body.days).toBe(3);
        expect(response.body.engagement).toHaveLength(3);
        expect(response.body.engagement.every((d: {
            date: string; posts: number; comments: number; reactions: number;
        }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
        Number.isInteger(d.posts) && Number.isInteger(d.comments) &&
            Number.isInteger(d.reactions),
        )).toBe(true);
    });

    it("rejects invalid IDs, date ranges, and top-post limits", async () => {
        const admin = await createUser("invalid-params");
        const communityId = await createCommunity(admin);

        expect((await get(admin, "/api/analytics/community/not-a-uuid/overview")).status)
            .toBe(400);
        for (const days of ["0", "366", "1.5"]) {
            expect((await get(admin, `/api/analytics/community/${communityId}/engagement?days=${days}`)).status)
                .toBe(400);
            expect((await get(admin, `/api/analytics/community/${communityId}/membership-growth?days=${days}`)).status)
                .toBe(400);
        }
        expect((await get(admin, `/api/analytics/community/${communityId}/top-posts?limit=51`)).status)
            .toBe(400);
    });

    it("returns an empty top-post list when there are no published posts", async () => {
        const admin = await createUser("top-posts");
        const communityId = await createCommunity(admin);

        const response = await get(admin, `/api/analytics/community/${communityId}/top-posts`);
        expect(response.status).toBe(200);
        expect(response.body.topPosts).toEqual([]);
    });
});