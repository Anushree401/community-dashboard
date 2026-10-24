import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const testEmail = (name: string) =>
  `ceh-community-${name}-${runId}@example.test`;

const createdUserIds: string[] = [];
const createdCommunityIds: string[] = [];

type TestUser = {
  id: string;
  email: string;
  token: string;
};

async function createUser(name: string): Promise<TestUser> {
  const token = randomBytes(32).toString("base64url");

  const user = await prisma.user.create({
    data: {
      email: testEmail(name),
      displayName: `Community Test ${name}`,
      passwordHash: await hash("CommunityTestPassword#2026"),
      status: "ACTIVE",
      sessions: {
        create: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    },
    select: { id: true, email: true },
  });

  createdUserIds.push(user.id);
  return { ...user, token };
}

function asUser(user: TestUser) {
  return request.agent(app);
}

function getWithAuth(user: TestUser, path: string) {
  return request(app).get(path).set("Authorization", `Bearer ${user.token}`);
}

function postWithAuth(user: TestUser, path: string) {
  return request(app).post(path).set("Authorization", `Bearer ${user.token}`);
}

function patchWithAuth(user: TestUser, path: string) {
  return request(app).patch(path).set("Authorization", `Bearer ${user.token}`);
}

function deleteWithAuth(user: TestUser, path: string) {
  return request(app).delete(path).set("Authorization", `Bearer ${user.token}`);
}

async function createCommunity(
  creator: TestUser,
  options: {
    name?: string;
    visibility?: "PUBLIC" | "PRIVATE";
  } = {},
) {
  const name = options.name ??
    `Test Community ${randomUUID().slice(0, 8)}`;

  const response = await postWithAuth(creator, "/api/communities").send({
    name,
    description: "Integration-test community",
    visibility: options.visibility ?? "PUBLIC",
  });

  expect(response.status).toBe(201);
  createdCommunityIds.push(response.body.community.id);

  return response.body.community as {
    id: string;
    name: string;
    slug: string;
    visibility: "PUBLIC" | "PRIVATE";
    createdById: string;
  };
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

beforeAll(() => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/ceh_test_db") {
    throw new Error("Community integration tests require ceh_test_db.");
  }
});

afterAll(async () => {
  // Remove only the communities and users created by this test run.
  if (createdCommunityIds.length) {
    await prisma.community.deleteMany({
      where: { id: { in: createdCommunityIds } },
    });
  }

  if (createdUserIds.length) {
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }

  await prisma.$disconnect();
});

describe("Community HTTP integration", () => {
  it("requires authentication to list communities", async () => {
    const response = await request(app).get("/api/communities");
    expect(response.status).toBe(401);
  });

  it("rejects invalid community creation data", async () => {
    const creator = await createUser("invalid-create");

    const response = await postWithAuth(creator, "/api/communities")
      .send({ name: "ab", visibility: "WORLD" });

    expect(response.status).toBe(400);
  });

  it("creates a community and automatically makes the creator an admin", async () => {
    const creator = await createUser("creator");
    const name = `Unique Community ${runId}`;

    const response = await postWithAuth(creator, "/api/communities").send({
      name,
      description: "Created by integration test",
      visibility: "PUBLIC",
    });

    expect(response.status).toBe(201);
    expect(response.body.community.name).toBe(name);
    expect(response.body.community.slug).toBe(name.toLowerCase().replace(/\s+/g, "-"));
    expect(response.body.membership).toEqual({
      role: "COMMUNITY_ADMIN",
      status: "ACTIVE",
    });

    const communityId = response.body.community.id as string;
    createdCommunityIds.push(communityId);

    const membership = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId, userId: creator.id },
      },
    });

    expect(membership?.role).toBe("COMMUNITY_ADMIN");
    expect(membership?.status).toBe("ACTIVE");
  });

  it("rejects duplicate community slugs", async () => {
    const creator = await createUser("duplicate-slug");
    const name = `Duplicate Slug ${runId}`;

    const first = await createCommunity(creator, { name });
    const second = await postWithAuth(creator, "/api/communities")
      .send({ name: first.name, visibility: "PUBLIC" });

    expect(second.status).toBe(409);
  });

  it("lists public communities with pagination", async () => {
    const creator = await createUser("listing");
    const community = await createCommunity(creator);

    const response = await getWithAuth(creator, "/api/communities?page=1&limit=5");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: community.id, visibility: "PUBLIC" }),
      ]),
    );
    expect(response.body.pagination).toMatchObject({
      page: 1,
      limit: 5,
    });
  });

  it("rejects invalid pagination", async () => {
    const user = await createUser("bad-pagination");

    const response = await getWithAuth(user, "/api/communities?page=0&limit=500");

    expect(response.status).toBe(400);
  });

  it("allows public community retrieval by an authenticated nonmember", async () => {
    const creator = await createUser("public-owner");
    const visitor = await createUser("public-visitor");
    const community = await createCommunity(creator);

    const response = await getWithAuth(visitor, `/api/communities/${community.id}`);

    expect(response.status).toBe(200);
    expect(response.body.community.id).toBe(community.id);
    expect(response.body.membership).toBeNull();
  });

  it("hides private communities from nonmembers", async () => {
    const creator = await createUser("private-owner");
    const visitor = await createUser("private-visitor");
    const community = await createCommunity(creator, { visibility: "PRIVATE" });

    const response = await getWithAuth(visitor, `/api/communities/${community.id}`);

    expect(response.status).toBe(404);
  });

  it("rejects malformed community IDs", async () => {
    const user = await createUser("invalid-id");

    const response = await getWithAuth(user, "/api/communities/not-a-uuid");

    expect(response.status).toBe(400);
  });

  it("allows a user to join a public community and persists membership", async () => {
    const creator = await createUser("join-owner");
    const member = await createUser("join-member");
    const community = await createCommunity(creator);

    const response = await postWithAuth(
      member,
      `/api/communities/${community.id}/join`,
    );

    expect(response.status).toBe(201);

    const membership = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId: community.id, userId: member.id },
      },
    });

    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.role).toBe("MEMBER");
  });

  it("handles joining an already active member without duplicating membership", async () => {
    const creator = await createUser("repeat-join-owner");
    const member = await createUser("repeat-join-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id);

    const response = await postWithAuth(
      member,
      `/api/communities/${community.id}/join`,
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("You are already a member");

    const count = await prisma.communityMembership.count({
      where: { communityId: community.id, userId: member.id },
    });
    expect(count).toBe(1);
  });

  it("prevents joining a private community through the public join endpoint", async () => {
    const creator = await createUser("private-join-owner");
    const visitor = await createUser("private-join-visitor");
    const community = await createCommunity(creator, { visibility: "PRIVATE" });

    const response = await postWithAuth(
      visitor,
      `/api/communities/${community.id}/join`,
    );

    expect(response.status).toBe(403);
  });

  it("prevents banned members from rejoining", async () => {
    const creator = await createUser("banned-owner");
    const member = await createUser("banned-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id, "MEMBER", "BANNED");

    const response = await postWithAuth(
      member,
      `/api/communities/${community.id}/join`,
    );

    expect(response.status).toBe(403);
  });

  it("allows a member to leave and changes membership to PENDING", async () => {
    const creator = await createUser("leave-owner");
    const member = await createUser("leave-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id);

    const response = await postWithAuth(
      member,
      `/api/communities/${community.id}/leave`,
    );

    expect(response.status).toBe(200);

    const membership = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId: community.id, userId: member.id },
      },
    });

    expect(membership?.status).toBe("PENDING");
    expect(membership?.role).toBe("MEMBER");
  });

  it("prevents the creator from leaving their own community", async () => {
    const creator = await createUser("creator-leave");
    const community = await createCommunity(creator);

    const response = await postWithAuth(
      creator,
      `/api/communities/${community.id}/leave`,
    );

    expect(response.status).toBe(409);
  });

  it("allows the creator to update community details", async () => {
    const creator = await createUser("update-owner");
    const community = await createCommunity(creator);

    const response = await patchWithAuth(
      creator,
      `/api/communities/${community.id}`,
    ).send({ description: "Updated description" });

    expect(response.status).toBe(200);
    expect(response.body.community.description).toBe("Updated description");

    const saved = await prisma.community.findUnique({
      where: { id: community.id },
    });

    expect(saved?.description).toBe("Updated description");
  });

  it("prevents ordinary members from updating community details", async () => {
    const creator = await createUser("update-permission-owner");
    const member = await createUser("update-permission-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id);

    const response = await patchWithAuth(
      member,
      `/api/communities/${community.id}`,
    ).send({ description: "Unauthorized change" });

    expect(response.status).toBe(403);
  });

  it("allows the creator to promote a member to moderator", async () => {
    const creator = await createUser("role-owner");
    const member = await createUser("role-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id);

    const response = await patchWithAuth(
      creator,
      `/api/communities/${community.id}/members/${member.id}/role`,
    ).send({ role: "MODERATOR" });

    expect(response.status).toBe(200);
    expect(response.body.membership.role).toBe("MODERATOR");

    const saved = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId: community.id, userId: member.id },
      },
    });

    expect(saved?.role).toBe("MODERATOR");
  });

  it("prevents a moderator from granting admin privileges", async () => {
    const creator = await createUser("admin-role-owner");
    const moderator = await createUser("admin-role-moderator");
    const member = await createUser("admin-role-member");
    const community = await createCommunity(creator);

    await addMembership(community.id, moderator.id, "MODERATOR");
    await addMembership(community.id, member.id);

    const response = await patchWithAuth(
      moderator,
      `/api/communities/${community.id}/members/${member.id}/role`,
    ).send({ role: "COMMUNITY_ADMIN" });

    expect(response.status).toBe(403);
  });

  it("allows the creator to remove a member and marks them BANNED", async () => {
    const creator = await createUser("remove-owner");
    const member = await createUser("remove-member");
    const community = await createCommunity(creator);
    await addMembership(community.id, member.id);

    const response = await deleteWithAuth(
      creator,
      `/api/communities/${community.id}/members/${member.id}`,
    );

    expect(response.status).toBe(204);

    const saved = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId: community.id, userId: member.id },
      },
    });

    expect(saved?.status).toBe("BANNED");
  });

  it("prevents ordinary members from removing other members", async () => {
    const creator = await createUser("remove-permission-owner");
    const actor = await createUser("remove-permission-actor");
    const target = await createUser("remove-permission-target");
    const community = await createCommunity(creator);

    await addMembership(community.id, actor.id);
    await addMembership(community.id, target.id);

    const response = await deleteWithAuth(
      actor,
      `/api/communities/${community.id}/members/${target.id}`,
    );

    expect(response.status).toBe(403);
  });

  it("allows an admin to create an invitation for an active registered user", async () => {
    const creator = await createUser("invite-owner");
    const invitee = await createUser("invite-recipient");
    const community = await createCommunity(creator, { visibility: "PRIVATE" });

    const response = await postWithAuth(
      creator,
      `/api/communities/${community.id}/invitations`,
    ).send({ email: invitee.email });

    expect(response.status).toBe(201);
    expect(response.body.invitation.inviteeId).toBe(invitee.id);

    const saved = await prisma.communityInvitation.findUnique({
      where: { id: response.body.invitation.id },
    });

    expect(saved?.communityId).toBe(community.id);
    expect(saved?.acceptedAt).toBeNull();
  });

  it("allows only the invited recipient to accept an invitation", async () => {
    const creator = await createUser("accept-owner");
    const invitee = await createUser("accept-recipient");
    const otherUser = await createUser("accept-other");
    const community = await createCommunity(creator, { visibility: "PRIVATE" });

    const invitation = await prisma.communityInvitation.create({
      data: {
        communityId: community.id,
        invitedById: creator.id,
        inviteeId: invitee.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const wrongUser = await postWithAuth(
      otherUser,
      `/api/communities/${community.id}/invitations/accept`,
    ).send({ invitationId: invitation.id });

    expect(wrongUser.status).toBe(404);

    const accepted = await postWithAuth(
      invitee,
      `/api/communities/${community.id}/invitations/accept`,
    ).send({ invitationId: invitation.id });

    expect(accepted.status).toBe(200);

    const membership = await prisma.communityMembership.findUnique({
      where: {
        communityId_userId: { communityId: community.id, userId: invitee.id },
      },
    });

    expect(membership?.status).toBe("ACTIVE");

    const savedInvitation = await prisma.communityInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(savedInvitation?.acceptedAt).not.toBeNull();

    const replay = await postWithAuth(
      invitee,
      `/api/communities/${community.id}/invitations/accept`,
    ).send({ invitationId: invitation.id });

    expect(replay.status).toBe(404);
  });

  it("prevents a non-creator from deleting a community", async () => {
    const creator = await createUser("delete-owner");
    const otherUser = await createUser("delete-other");
    const community = await createCommunity(creator);

    const response = await deleteWithAuth(
      otherUser,
      `/api/communities/${community.id}`,
    );

    expect(response.status).toBe(403);

    const saved = await prisma.community.findUnique({
      where: { id: community.id },
    });
    expect(saved).not.toBeNull();
  });
});
