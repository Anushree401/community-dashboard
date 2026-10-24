import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { hash } from "@node-rs/argon2";
import app from "../app.js";
import prisma from "../lib/prisma.js";

const runId = randomUUID().replaceAll("-", "");
const users: string[] = [];
const communities: string[] = [];
const announcements: string[] = [];
const notifications: string[] = [];

type TestUser = { id: string; token: string };

async function createUser(name: string): Promise<TestUser> {
  const token = randomBytes(32).toString("base64url");
  const user = await prisma.user.create({
    data: {
      email: `ceh-ann-${name}-${runId}@example.test`,
      displayName: `Announcement Test ${name}`,
      passwordHash: await hash("AnnouncementTestPassword#2026"),
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
  users.push(user.id);
  return { id: user.id, token };
}

function call(
  user: TestUser,
  method: "get" | "post" | "patch" | "delete",
  path: string,
) {
  return request(app)[method](path).set("Authorization", `Bearer ${user.token}`);
}

async function createCommunity(
  creator: TestUser,
  visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
) {
  const response = await call(creator, "post", "/api/communities").send({
    name: `Announcement Test ${randomUUID().slice(0, 8)}`,
    description: "Integration fixture",
    visibility,
  });
  expect(response.status).toBe(201);
  communities.push(response.body.community.id);
  return response.body.community as { id: string; visibility: string };
}

async function membership(
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

async function createAnnouncement(
  author: TestUser,
  communityId: string,
  status: "DRAFT" | "PUBLISHED" = "DRAFT",
) {
  const response = await call(
    author,
    "post",
    `/api/announcements/community/${communityId}`,
  ).send({
    title: `Announcement ${randomUUID().slice(0, 8)}`,
    body: "Announcement integration test body",
    status,
  });
  expect(response.status).toBe(201);
  announcements.push(response.body.announcement.id);
  return response.body.announcement as {
    id: string;
    title: string;
    status: string;
    publishedAt: string | null;
  };
}

async function createNotification(userId: string, communityId?: string) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      communityId,
      type: "TEST",
      title: "Integration notification",
      body: "Notification test body",
    },
  });
  notifications.push(notification.id);
  return notification;
}

beforeAll(() => {
  if (new URL(process.env.DATABASE_URL!).pathname !== "/ceh_test_db") {
    throw new Error("Announcement/notification tests require ceh_test_db.");
  }
});

afterAll(async () => {
  if (announcements.length) {
    await prisma.announcementRead.deleteMany({
      where: { announcementId: { in: announcements } },
    });
    await prisma.announcement.deleteMany({
      where: { id: { in: announcements } },
    });
  }

  if (notifications.length) {
    await prisma.notification.deleteMany({
      where: { id: { in: notifications } },
    });
  }

  if (communities.length) {
    await prisma.community.deleteMany({
      where: { id: { in: communities } },
    });
  }

  if (users.length) {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }

  await prisma.$disconnect();
});

describe("Announcement HTTP integration", () => {
  it("requires authentication to list announcements", async () => {
    const response = await request(app).get(
      `/api/announcements/community/${randomUUID()}`,
    );
    expect(response.status).toBe(401);
  });

  it("rejects invalid community IDs", async () => {
    const user = await createUser("bad-community");
    const response = await call(
      user,
      "get",
      "/api/announcements/community/not-a-uuid",
    );
    expect(response.status).toBe(400);
  });

  it("allows admins to create a draft announcement", async () => {
    const admin = await createUser("create-draft");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(admin, community.id);

    expect(announcement.status).toBe("DRAFT");
    expect(announcement.publishedAt).toBeNull();
  });

  it("sets publishedAt when creating a published announcement", async () => {
    const admin = await createUser("create-published");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(
      admin,
      community.id,
      "PUBLISHED",
    );

    expect(announcement.status).toBe("PUBLISHED");
    expect(announcement.publishedAt).toBeTruthy();
  });

  it("rejects invalid announcement data", async () => {
    const admin = await createUser("bad-data");
    const community = await createCommunity(admin);
    const response = await call(
      admin,
      "post",
      `/api/announcements/community/${community.id}`,
    ).send({ title: " ", body: "" });

    expect(response.status).toBe(400);
  });

  it("prevents ordinary members from creating announcements", async () => {
    const admin = await createUser("member-create-admin");
    const member = await createUser("member-create");
    const community = await createCommunity(admin);
    await membership(community.id, member.id);

    const response = await call(
      member,
      "post",
      `/api/announcements/community/${community.id}`,
    ).send({ title: "Member announcement", body: "Should be forbidden" });

    expect(response.status).toBe(403);
  });

  it("allows moderators to create announcements", async () => {
    const admin = await createUser("mod-create-admin");
    const moderator = await createUser("mod-create");
    const community = await createCommunity(admin);
    await membership(community.id, moderator.id, "MODERATOR");

    const response = await call(
      moderator,
      "post",
      `/api/announcements/community/${community.id}`,
    ).send({ title: "Moderator announcement", body: "Allowed" });

    expect(response.status).toBe(201);
    announcements.push(response.body.announcement.id);
  });

  it("shows drafts to admins but not ordinary members", async () => {
    const admin = await createUser("draft-visibility-admin");
    const member = await createUser("draft-visibility-member");
    const community = await createCommunity(admin);
    await membership(community.id, member.id);
    const draft = await createAnnouncement(admin, community.id, "DRAFT");

    const adminList = await call(
      admin,
      "get",
      `/api/announcements/community/${community.id}`,
    );
    const memberList = await call(
      member,
      "get",
      `/api/announcements/community/${community.id}`,
    );

    expect(adminList.status).toBe(200);
    expect(adminList.body.announcements).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: draft.id })]),
    );
    expect(memberList.status).toBe(200);
    expect(memberList.body.announcements).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: draft.id })]),
    );
  });

  it("allows admins to edit announcements", async () => {
    const admin = await createUser("edit-announcement");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(admin, community.id);

    const response = await call(
      admin,
      "patch",
      `/api/announcements/${announcement.id}`,
    ).send({ title: "Updated announcement" });

    expect(response.status).toBe(200);
    expect(response.body.announcement.title).toBe("Updated announcement");
  });

  it("prevents ordinary members from editing announcements", async () => {
    const admin = await createUser("member-edit-admin");
    const member = await createUser("member-edit");
    const community = await createCommunity(admin);
    await membership(community.id, member.id);
    const announcement = await createAnnouncement(admin, community.id);

    const response = await call(
      member,
      "patch",
      `/api/announcements/${announcement.id}`,
    ).send({ title: "Unauthorized edit" });

    expect(response.status).toBe(403);
  });

  it("rejects empty announcement updates", async () => {
    const admin = await createUser("empty-update");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(admin, community.id);

    const response = await call(
      admin,
      "patch",
      `/api/announcements/${announcement.id}`,
    ).send({});

    expect(response.status).toBe(400);
  });

  it("publishes a draft announcement", async () => {
    const admin = await createUser("publish-draft");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(admin, community.id);

    const response = await call(
      admin,
      "post",
      `/api/announcements/${announcement.id}/publish`,
    );

    expect(response.status).toBe(200);
    expect(response.body.announcement.status).toBe("PUBLISHED");
    expect(response.body.announcement.publishedAt).toBeTruthy();
  });

  it("archives an announcement", async () => {
    const admin = await createUser("archive");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(
      admin,
      community.id,
      "PUBLISHED",
    );

    const response = await call(
      admin,
      "post",
      `/api/announcements/${announcement.id}/archive`,
    );

    expect(response.status).toBe(200);
    expect(response.body.announcement.status).toBe("ARCHIVED");
  });

  it("does not allow archived announcements to be republished", async () => {
    const admin = await createUser("archive-republish");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(
      admin,
      community.id,
      "PUBLISHED",
    );

    const archive = await call(
      admin,
      "post",
      `/api/announcements/${announcement.id}/archive`,
    );
    expect(archive.status).toBe(200);

    const publish = await call(
      admin,
      "post",
      `/api/announcements/${announcement.id}/publish`,
    );
    expect(publish.status).toBe(409);
  });

  it("marks a published announcement as read", async () => {
    const admin = await createUser("mark-read-admin");
    const member = await createUser("mark-read-member");
    const community = await createCommunity(admin);
    await membership(community.id, member.id);
    const announcement = await createAnnouncement(
      admin,
      community.id,
      "PUBLISHED",
    );

    const response = await call(
      member,
      "post",
      `/api/announcements/${announcement.id}/read`,
    );

    expect(response.status).toBe(200);
    expect(response.body.read).toBe(true);

    const saved = await prisma.announcementRead.findUnique({
      where: {
        announcementId_userId: {
          announcementId: announcement.id,
          userId: member.id,
        },
      },
    });
    expect(saved).not.toBeNull();
  });

  it("rejects marking a draft announcement as read", async () => {
    const admin = await createUser("draft-read");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(admin, community.id);

    const response = await call(
      admin,
      "post",
      `/api/announcements/${announcement.id}/read`,
    );

    expect(response.status).toBe(404);
  });

  it("requires active membership to mark a public announcement as read", async () => {
    const admin = await createUser("nonmember-read-admin");
    const visitor = await createUser("nonmember-read");
    const community = await createCommunity(admin);
    const announcement = await createAnnouncement(
      admin,
      community.id,
      "PUBLISHED",
    );

    const response = await call(
      visitor,
      "post",
      `/api/announcements/${announcement.id}/read`,
    );

    expect(response.status).toBe(403);
  });

  it("rejects invalid announcement pagination", async () => {
    const admin = await createUser("bad-ann-page");
    const community = await createCommunity(admin);

    const response = await call(
      admin,
      "get",
      `/api/announcements/community/${community.id}?page=0&limit=101`,
    );

    expect(response.status).toBe(400);
  });
});

describe("Notification HTTP integration", () => {
  it("requires authentication to list notifications", async () => {
    const response = await request(app).get("/api/notifications");
    expect(response.status).toBe(401);
  });

  it("lists only the current user's notifications and counts unread", async () => {
    const user = await createUser("list-notifications");
    const other = await createUser("other-notifications");
    const first = await createNotification(user.id);
    await createNotification(other.id);

    const response = await call(user, "get", "/api/notifications");

    expect(response.status).toBe(200);
    expect(response.body.notifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: first.id })]),
    );
    expect(
      response.body.notifications.every(
        (item: { userId: string }) => item.userId === user.id,
      ),
    ).toBe(true);
    expect(response.body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects invalid notification pagination", async () => {
    const user = await createUser("bad-notification-page");
    const response = await call(
      user,
      "get",
      "/api/notifications?page=0&limit=101",
    );
    expect(response.status).toBe(400);
  });

  it("marks a notification as read", async () => {
    const user = await createUser("mark-notification-read");
    const notification = await createNotification(user.id);

    const response = await call(
      user,
      "patch",
      `/api/notifications/${notification.id}/read`,
    );
    expect(response.status).toBe(200);

    const saved = await prisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(saved?.readAt).toBeTruthy();
  });

  it("treats marking an already-read notification as successful", async () => {
    const user = await createUser("already-read");
    const notification = await createNotification(user.id);
    await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });

    const response = await call(
      user,
      "patch",
      `/api/notifications/${notification.id}/read`,
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("Notification already read");
  });

  it("does not allow users to mark another user's notification as read", async () => {
    const owner = await createUser("notification-owner");
    const other = await createUser("notification-other");
    const notification = await createNotification(owner.id);

    const response = await call(
      other,
      "patch",
      `/api/notifications/${notification.id}/read`,
    );

    expect(response.status).toBe(404);
    const saved = await prisma.notification.findUnique({
      where: { id: notification.id },
    });
    expect(saved?.readAt).toBeNull();
  });

  it("marks all of the current user's unread notifications as read", async () => {
    const user = await createUser("read-all");
    const first = await createNotification(user.id);
    const second = await createNotification(user.id);
    const other = await createUser("read-all-other");
    const otherNotification = await createNotification(other.id);

    const response = await call(user, "patch", "/api/notifications/read-all");

    expect(response.status).toBe(200);
    expect(response.body.updatedCount).toBeGreaterThanOrEqual(2);

    const saved = await prisma.notification.findMany({
      where: { id: { in: [first.id, second.id, otherNotification.id] } },
    });
    expect(saved.find((n) => n.id === first.id)?.readAt).toBeTruthy();
    expect(saved.find((n) => n.id === second.id)?.readAt).toBeTruthy();
    expect(saved.find((n) => n.id === otherNotification.id)?.readAt).toBeNull();
  });

  it("deletes a notification owned by the current user", async () => {
    const user = await createUser("delete-notification");
    const notification = await createNotification(user.id);

    const response = await call(
      user,
      "delete",
      `/api/notifications/${notification.id}`,
    );

    expect(response.status).toBe(204);
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).toBeNull();
  });

  it("does not allow deleting another user's notification", async () => {
    const owner = await createUser("delete-notification-owner");
    const other = await createUser("delete-notification-other");
    const notification = await createNotification(owner.id);

    const response = await call(
      other,
      "delete",
      `/api/notifications/${notification.id}`,
    );

    expect(response.status).toBe(404);
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).not.toBeNull();
  });

  it("rejects malformed notification IDs", async () => {
    const user = await createUser("bad-notification-id");
    const response = await call(
      user,
      "patch",
      "/api/notifications/not-a-uuid/read",
    );
    expect(response.status).toBe(400);
  });
});
