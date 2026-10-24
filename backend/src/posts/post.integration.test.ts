import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const createdUserIds: string[] = [];
const createdCommunityIds: string[] = [];
const createdPostIds: string[] = [];
const createdCommentIds: string[] = [];
const createdTopicIds: string[] = [];

type TestUser = { id: string; token: string };

async function createUser(name: string): Promise<TestUser> {
  const token = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({
    data: {
      email: `ceh-post-${name}-${runId}@example.test`,
      displayName: `Post Test ${name}`,
      passwordHash: await hash("PostTestPassword#2026"),
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
  createdUserIds.push(user.id);
  return { id: user.id, token };
}

function auth(user: TestUser, method: "get" | "post" | "patch" | "put" | "delete", path: string) {
  return request(app)[method](path).set("Authorization", `Bearer ${user.token}`);
}

async function createCommunity(creator: TestUser, visibility: "PUBLIC" | "PRIVATE" = "PUBLIC") {
  const response = await auth(creator, "post", "/api/communities").send({
    name: `Post Test ${randomUUID().slice(0, 8)}`,
    description: "Post integration fixture",
    visibility,
  });
  expect(response.status).toBe(201);
  const community = response.body.community;
  createdCommunityIds.push(community.id);
  return community as { id: string; visibility: "PUBLIC" | "PRIVATE" };
}

async function addMembership(
  communityId: string,
  userId: string,
  role: "MEMBER" | "MODERATOR" | "COMMUNITY_ADMIN" = "MEMBER",
  status: "ACTIVE" | "PENDING" | "BANNED" = "ACTIVE",
) {
  return prisma.communityMembership.upsert({
    where: { communityId_userId: { communityId, userId } },
    create: { communityId, userId, role, status },
    update: { role, status },
  });
}

async function createPost(author: TestUser, communityId: string, title = "Integration post") {
  const response = await auth(author, "post", `/api/posts/community/${communityId}`).send({
    title,
    body: "Integration test post body",
  });
  expect(response.status).toBe(201);
  createdPostIds.push(response.body.post.id);
  return response.body.post as { id: string; title: string; status: string };
}

async function createComment(author: TestUser, postId: string, body = "Integration comment") {
  const response = await auth(author, "post", `/api/posts/${postId}/comments`).send({ body });
  expect(response.status).toBe(201);
  createdCommentIds.push(response.body.comment.id);
  return response.body.comment as { id: string; body: string };
}

beforeAll(() => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/ceh_test_db") {
    throw new Error("Post integration tests require ceh_test_db.");
  }
});

afterAll(async () => {
  // Remove test-owned records only. Preserve the development database.
  if (createdCommentIds.length) {
    await prisma.comment.deleteMany({ where: { id: { in: createdCommentIds } } });
  }

  if (createdPostIds.length) {
    await prisma.postReaction.deleteMany({ where: { postId: { in: createdPostIds } } });
    await prisma.comment.deleteMany({ where: { postId: { in: createdPostIds } } });
    await prisma.post.deleteMany({ where: { id: { in: createdPostIds } } });
  }

  if (createdTopicIds.length) {
    await prisma.topic.deleteMany({ where: { id: { in: createdTopicIds } } });
  }

  if (createdCommunityIds.length) {
    await prisma.community.deleteMany({ where: { id: { in: createdCommunityIds } } });
  }

  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await prisma.$disconnect();
});

describe("Post, comment, and reaction HTTP integration", () => {
  it("requires authentication for post routes", async () => {
    const response = await request(app).get("/api/posts/community/not-a-uuid");
    expect(response.status).toBe(401);
  });

  it("rejects an invalid community ID", async () => {
    const user = await createUser("invalid-community-id");
    const response = await auth(user, "post", "/api/posts/community/not-a-uuid")
      .send({ title: "Title", body: "Body" });
    expect(response.status).toBe(400);
  });

  it("rejects invalid post data", async () => {
    const user = await createUser("invalid-post");
    const community = await createCommunity(user);
    const response = await auth(user, "post", `/api/posts/community/${community.id}`)
      .send({ title: " ", body: "" });
    expect(response.status).toBe(400);
  });

  it("requires active membership to create a post", async () => {
    const owner = await createUser("nonmember-owner");
    const visitor = await createUser("nonmember-visitor");
    const community = await createCommunity(owner);
    const response = await auth(visitor, "post", `/api/posts/community/${community.id}`)
      .send({ title: "Blocked post", body: "Should not be created" });
    expect(response.status).toBe(403);
  });

  it("creates and retrieves a post", async () => {
    const owner = await createUser("create-retrieve");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id, "Created post");
    const response = await auth(owner, "get", `/api/posts/${post.id}`);
    expect(response.status).toBe(200);
    expect(response.body.post).toMatchObject({
      id: post.id,
      title: "Created post",
      authorId: owner.id,
      communityId: community.id,
      status: "PUBLISHED",
    });
  });

  it("lists published posts with pagination", async () => {
    const owner = await createUser("list-posts");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id, "Listed post");
    const response = await auth(owner, "get", `/api/posts/community/${community.id}?page=1&limit=5`);
    expect(response.status).toBe(200);
    expect(response.body.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: post.id, title: "Listed post" }),
    ]));
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 5 });
  });

  it("rejects invalid post pagination", async () => {
    const owner = await createUser("bad-post-pagination");
    const community = await createCommunity(owner);
    const response = await auth(owner, "get", `/api/posts/community/${community.id}?page=0&limit=101`);
    expect(response.status).toBe(400);
  });

  it("rejects a topic from a different community", async () => {
    const owner = await createUser("foreign-topic");
    const communityA = await createCommunity(owner);
    const communityB = await createCommunity(owner);
    const topic = await prisma.topic.create({
      data: { communityId: communityB.id, name: `Foreign ${runId}`, createdById: owner.id },
      select: { id: true },
    });
    createdTopicIds.push(topic.id);

    const response = await auth(owner, "post", `/api/posts/community/${communityA.id}`)
      .send({ title: "Bad topic", body: "Body", topicId: topic.id });
    expect(response.status).toBe(400);
  });

  it("allows the author to edit a post and records editedAt", async () => {
    const owner = await createUser("edit-post");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);
    const response = await auth(owner, "patch", `/api/posts/${post.id}`)
      .send({ title: "Updated title" });

    expect(response.status).toBe(200);
    expect(response.body.post.title).toBe("Updated title");
    expect(response.body.post.editedAt).toBeTruthy();
  });

  it("does not allow another member to edit a post", async () => {
    const owner = await createUser("edit-owner");
    const member = await createUser("edit-member");
    const community = await createCommunity(owner);
    await addMembership(community.id, member.id);
    const post = await createPost(owner, community.id);

    const response = await auth(member, "patch", `/api/posts/${post.id}`)
      .send({ title: "Unauthorized edit" });
    expect(response.status).toBe(403);
  });

  it("rejects empty post updates", async () => {
    const owner = await createUser("empty-update");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);
    const response = await auth(owner, "patch", `/api/posts/${post.id}`).send({});
    expect(response.status).toBe(400);
  });

  it("soft-deletes an author's post", async () => {
    const owner = await createUser("delete-own-post");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const response = await auth(owner, "delete", `/api/posts/${post.id}`);
    expect(response.status).toBe(204);

    const saved = await prisma.post.findUnique({ where: { id: post.id } });
    expect(saved?.status).toBe("DELETED");
    expect(saved?.deletedAt).toBeTruthy();

    const read = await auth(owner, "get", `/api/posts/${post.id}`);
    expect(read.status).toBe(404);
  });

  it("allows a moderator to soft-delete another member's post", async () => {
    const owner = await createUser("moderated-post-owner");
    const moderator = await createUser("post-moderator");
    const community = await createCommunity(owner);
    await addMembership(community.id, moderator.id, "MODERATOR");
    const post = await createPost(owner, community.id);

    const response = await auth(moderator, "delete", `/api/posts/${post.id}`);
    expect(response.status).toBe(204);
  });

  it("requires membership to comment on a public-community post", async () => {
    const owner = await createUser("comment-owner");
    const visitor = await createUser("comment-visitor");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const response = await auth(visitor, "post", `/api/posts/${post.id}/comments`)
      .send({ body: "I am not a member" });
    expect(response.status).toBe(403);
  });

  it("creates, lists, and edits a comment by its author", async () => {
    const owner = await createUser("comment-crud");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);
    const comment = await createComment(owner, post.id);

    const list = await auth(owner, "get", `/api/posts/${post.id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body.comments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: comment.id, body: "Integration comment" }),
    ]));

    const update = await auth(owner, "patch", `/api/posts/comments/${comment.id}`)
      .send({ body: "Edited comment" });
    expect(update.status).toBe(200);
    expect(update.body.comment.body).toBe("Edited comment");
  });

  it("does not allow a different user to edit a comment", async () => {
    const owner = await createUser("comment-edit-owner");
    const member = await createUser("comment-edit-member");
    const community = await createCommunity(owner);
    await addMembership(community.id, member.id);
    const post = await createPost(owner, community.id);
    const comment = await createComment(owner, post.id);

    const response = await auth(member, "patch", `/api/posts/comments/${comment.id}`)
      .send({ body: "Unauthorized edit" });
    expect(response.status).toBe(403);
  });

  it("allows a moderator to delete another user's comment", async () => {
    const owner = await createUser("comment-mod-owner");
    const moderator = await createUser("comment-mod");
    const community = await createCommunity(owner);
    await addMembership(community.id, moderator.id, "MODERATOR");
    const post = await createPost(owner, community.id);
    const comment = await createComment(owner, post.id);

    const response = await auth(moderator, "delete", `/api/posts/comments/${comment.id}`);
    expect(response.status).toBe(204);
  });

  it("rejects invalid comment content", async () => {
    const owner = await createUser("invalid-comment");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const response = await auth(owner, "post", `/api/posts/${post.id}/comments`)
      .send({ body: " " });
    expect(response.status).toBe(400);
  });

  it("adds a reaction and makes repeating the same reaction idempotent", async () => {
    const owner = await createUser("reaction-owner");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const first = await auth(owner, "put", `/api/posts/${post.id}/reaction`)
      .send({ reactionType: "LIKE" });
    expect(first.status).toBe(200);
    expect(first.body.reaction).toMatchObject({
      postId: post.id,
      userId: owner.id,
      reactionType: "LIKE",
    });

    const second = await auth(owner, "put", `/api/posts/${post.id}/reaction`)
      .send({ reactionType: "LIKE" });
    expect(second.status).toBe(200);

    const count = await prisma.postReaction.count({
      where: { postId: post.id, userId: owner.id, reactionType: "LIKE" },
    });
    expect(count).toBe(1);
  });

  it("removes the current user's reaction", async () => {
    const owner = await createUser("remove-reaction");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    await auth(owner, "put", `/api/posts/${post.id}/reaction`).send({ reactionType: "LIKE" });
    const response = await auth(owner, "delete", `/api/posts/${post.id}/reaction?reactionType=LIKE`);
    expect(response.status).toBe(204);

    const count = await prisma.postReaction.count({
      where: { postId: post.id, userId: owner.id, reactionType: "LIKE" },
    });
    expect(count).toBe(0);
  });

  it("returns 404 when removing a reaction that does not exist", async () => {
    const owner = await createUser("missing-reaction");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const response = await auth(owner, "delete", `/api/posts/${post.id}/reaction?reactionType=LIKE`);
    expect(response.status).toBe(404);
  });

  it("requires membership to react to a post", async () => {
    const owner = await createUser("react-owner");
    const visitor = await createUser("react-visitor");
    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);

    const response = await auth(visitor, "put", `/api/posts/${post.id}/reaction`)
      .send({ reactionType: "LIKE" });
    expect(response.status).toBe(403);
  });

  it("rejects malformed post and reaction IDs/types", async () => {
    const owner = await createUser("bad-reaction");
    const badId = await auth(owner, "put", "/api/posts/not-a-uuid/reaction")
      .send({ reactionType: "LIKE" });
    expect(badId.status).toBe(400);

    const community = await createCommunity(owner);
    const post = await createPost(owner, community.id);
    const badType = await auth(owner, "put", `/api/posts/${post.id}/reaction`)
      .send({ reactionType: "LOVE" });
    expect(badType.status).toBe(400);
  });
});
