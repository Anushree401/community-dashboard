import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const userIds: string[] = [];
const communityIds: string[] = [];
const activityIds: string[] = [];
const postIds: string[] = [];
const commentIds: string[] = [];

type TestUser = { id: string; token: string };

async function createUser(label: string): Promise<TestUser> {
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.user.create({
        data: {
            email: `ceh-activity-${label}-${runId}@example.test`,
            displayName: `Activity Test ${label}`,
            passwordHash: await hash("ActivityTestPassword#2026"),
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
            name: `Activity ${randomUUID().slice(0, 8)}`,
            slug: `activity-${randomUUID()}`,
            createdById: creator.id,
        },
        select: { id: true },
    });
    communityIds.push(community.id);
    return community.id;
}

async function addMember(communityId: string, userId: string, status = "ACTIVE") {
    await prisma.communityMembership.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: {
            communityId,
            userId,
            status: status as "ACTIVE" | "PENDING" | "BANNED",
        },
        update: { status: status as "ACTIVE" | "PENDING" | "BANNED" },
    });
}

async function createPost(communityId: string, authorId: string) {
    const post = await prisma.post.create({
        data: {
            communityId,
            authorId,
            title: `Activity post ${randomUUID().slice(0, 8)}`,
            body: "Post fixture for activity integration tests.",
        },
        select: { id: true },
    });
    postIds.push(post.id);
    return post.id;
}

beforeAll(() => {
    if (!process.env.DATABASE_URL ||
        new URL(process.env.DATABASE_URL).pathname !== "/ceh_test_db") {
        throw new Error("Activity integration tests require ceh_test_db.");
    }
});

afterAll(async () => {
    if (activityIds.length) {
        await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
    }
    if (commentIds.length) {
        await prisma.comment.deleteMany({ where: { id: { in: commentIds } } });
    }
    if (postIds.length) {
        await prisma.postReaction.deleteMany({ where: { postId: { in: postIds } } });
        await prisma.post.deleteMany({ where: { id: { in: postIds } } });
    }
    if (communityIds.length) {
        await prisma.community.deleteMany({ where: { id: { in: communityIds } } });
    }
    if (userIds.length) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
});

describe("Activity HTTP integration", () => {
    it("requires authentication", async () => {
        expect((await request(app).get("/api/activities/community/not-a-uuid")).status)
            .toBe(401);
        expect((await request(app).post("/api/activities").send({})).status)
            .toBe(401);
    });

    it("rejects invalid community IDs and missing communityId on personal history", async () => {
        const user = await createUser("invalid-id");

        expect((await get(user, "/api/activities/community/not-a-uuid")).status)
            .toBe(400);
        expect((await get(user, "/api/activities/me")).status).toBe(400);
        expect((await get(user, "/api/activities/me?communityId=bad")).status)
            .toBe(400);
    });

    it("requires active membership to view a community activity feed", async () => {
        const creator = await createUser("feed-creator");
        const outsider = await createUser("feed-outsider");
        const communityId = await createCommunity(creator);

        expect((await get(outsider, `/api/activities/community/${communityId}`)).status)
            .toBe(403);
    });

    it("allows the community creator to view the feed", async () => {
        const creator = await createUser("creator-feed");
        const communityId = await createCommunity(creator);

        const response = await get(creator, `/api/activities/community/${communityId}`);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            activities: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        });
    });

    it("records an activity and returns its metadata", async () => {
        const user = await createUser("record");
        const communityId = await createCommunity(user);

        const response = await post(user, "/api/activities").send({
            communityId,
            eventType: "LOGIN",
            metadata: { source: "integration-test", attempt: 1 },
        });

        expect(response.status).toBe(201);
        expect(response.body.activity).toMatchObject({
            communityId,
            userId: user.id,
            eventType: "LOGIN",
            postId: null,
            commentId: null,
            metadata: { source: "integration-test", attempt: 1 },
        });
        activityIds.push(response.body.activity.id);
    });

    it("rejects invalid event types and invalid activity payloads", async () => {
        const user = await createUser("invalid-payload");
        const communityId = await createCommunity(user);

        for (const payload of [
            { communityId, eventType: "NOT_AN_EVENT" },
            { communityId, eventType: "LOGIN", postId: randomUUID(), commentId: randomUUID() },
            { communityId: "bad", eventType: "LOGIN" },
        ]) {
            expect((await post(user, "/api/activities").send(payload)).status).toBe(400);
        }
    });

    it("requires active membership to create an activity", async () => {
        const creator = await createUser("member-required");
        const outsider = await createUser("not-a-member");
        const communityId = await createCommunity(creator);

        const response = await post(outsider, "/api/activities").send({
            communityId,
            eventType: "LOGIN",
        });

        expect(response.status).toBe(403);
    });

    it("rejects a post that does not belong to the specified community", async () => {
        const creator = await createUser("post-owner");
        const otherCreator = await createUser("other-post-owner");
        const communityId = await createCommunity(creator);
        const otherCommunityId = await createCommunity(otherCreator);
        const postId = await createPost(otherCommunityId, otherCreator.id);

        const response = await post(creator, "/api/activities").send({
            communityId,
            eventType: "POST_CREATED",
            postId,
        });

        expect(response.status).toBe(400);
    });

    it("returns paginated activities and isolates personal history", async () => {
        const user = await createUser("history");
        const other = await createUser("other-history");
        const communityId = await createCommunity(user);
        await addMember(communityId, other.id);

        for (const eventType of ["LOGIN", "POST_CREATED", "COMMENT_CREATED"] as const) {
            const response = await post(user, "/api/activities").send({
                communityId,
                eventType,
            });
            expect(response.status).toBe(201);
            activityIds.push(response.body.activity.id);
        }

        const otherResponse = await post(other, "/api/activities").send({
            communityId,
            eventType: "LOGIN",
        });
        expect(otherResponse.status).toBe(201);
        activityIds.push(otherResponse.body.activity.id);

        const feed = await get(user, `/api/activities/community/${communityId}?page=1&limit=2`);
        expect(feed.status).toBe(200);
        expect(feed.body.activities).toHaveLength(2);
        expect(feed.body.pagination).toMatchObject({
            page: 1, limit: 2, total: 4, totalPages: 2,
        });

        const history = await get(user, `/api/activities/me?communityId=${communityId}`);
        expect(history.status).toBe(200);
        expect(history.body.activities).toHaveLength(3);
        expect(history.body.activities.every((a: { userId?: string }) => !a.userId))
            .toBe(true);
    });

    it("rejects invalid pagination parameters", async () => {
        const user = await createUser("pagination");
        const communityId = await createCommunity(user);

        for (const query of ["page=0", "page=1.5", "limit=0", "limit=101"]) {
            expect((await get(user, `/api/activities/community/${communityId}?${query}`)).status)
                .toBe(400);
            expect((await get(user, `/api/activities/me?communityId=${communityId}&${query}`)).status)
                .toBe(400);
        }
    });
});