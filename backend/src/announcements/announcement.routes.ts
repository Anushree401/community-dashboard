import { Router, type Response } from "express";
import { z } from "zod";
import {
    AnnouncementStatus,
    MembershipRole,
    MembershipStatus,
    Prisma,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const announcementRouter = Router();

announcementRouter.use(requireAuth);

const uuidSchema = z.string().uuid();

const createAnnouncementSchema = z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20000),
    status: z
        .enum(["DRAFT", "PUBLISHED"])
        .optional()
        .default("DRAFT"),
});

const updateAnnouncementSchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        body: z.string().trim().min(1).max(20000).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });

function sendError(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuidSchema.safeParse(value).success;
}

async function getCommunityAccess(communityId: string, userId: string) {
    const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: {
            id: true,
            createdById: true,
            memberships: {
                where: {
                    userId,
                    status: MembershipStatus.ACTIVE,
                },
                select: { role: true },
                take: 1,
            },
        },
    });

    if (!community) return null;

    const membership = community.memberships[0];

    if (community.createdById === userId) {
        return {
            role: MembershipRole.COMMUNITY_ADMIN,
            createdById: community.createdById,
        };
    }

    if (!membership) return null;

    return {
        role: membership.role,
        createdById: community.createdById,
    };
}

function canManageAnnouncements(
    access: NonNullable<Awaited<ReturnType<typeof getCommunityAccess>>>,
) {
    return (
        access.role === MembershipRole.COMMUNITY_ADMIN ||
        access.role === MembershipRole.MODERATOR
    );
}

/**
 * GET /api/announcements/community/:communityId
 * List announcements visible to the current user.
 */
announcementRouter.get("/community/:communityId", async (req, res) => {
    const { communityId } = req.params;

    if (!validId(communityId)) {
        return sendError(res, 400, "Invalid community ID");
    }

    const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, visibility: true },
    });

    if (!community) {
        return sendError(res, 404, "Community not found");
    }

    const access = await getCommunityAccess(communityId, req.auth.userId);

    if (community.visibility === "PRIVATE" && !access) {
        return sendError(res, 403, "Active community membership required");
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    if (
        !Number.isInteger(page) ||
        page < 1 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
    ) {
        return sendError(res, 400, "Invalid pagination parameters");
    }

    const canManage = access ? canManageAnnouncements(access) : false;

    const where = {
        communityId,
        ...(canManage
            ? {}
            : { status: AnnouncementStatus.PUBLISHED }),
    };

    const [announcements, total] = await prisma.$transaction([
        prisma.announcement.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                communityId: true,
                title: true,
                body: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                publishedAt: true,
                authorId: true,
                author: {
                    select: {
                        id: true,
                        displayName: true,
                        avatarUrl: true,
                    },
                },
            },
        }),
        prisma.announcement.count({ where }),
    ]);

    return res.json({
        announcements,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * POST /api/announcements/community/:communityId
 * Create an announcement. Admins/moderators only.
 */
announcementRouter.post("/community/:communityId", async (req, res) => {
    const { communityId } = req.params;
    const parsed = createAnnouncementSchema.safeParse(req.body);

    if (!validId(communityId)) {
        return sendError(res, 400, "Invalid community ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid announcement data");
    }

    const access = await getCommunityAccess(communityId, req.auth.userId);

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    if (!canManageAnnouncements(access)) {
        return sendError(res, 403, "Announcement management permission required");
    }

    const status =
        parsed.data.status === "PUBLISHED"
            ? AnnouncementStatus.PUBLISHED
            : AnnouncementStatus.DRAFT;

    const announcement = await prisma.announcement.create({
        data: {
            communityId,
            authorId: req.auth.userId,
            title: parsed.data.title,
            body: parsed.data.body,
            status,
            publishedAt: status === AnnouncementStatus.PUBLISHED ? new Date() : null,
        },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
        },
    });

    return res.status(201).json({ announcement });
});

/**
 * PATCH /api/announcements/:announcementId
 * Edit an announcement. Admins/moderators only.
 */
announcementRouter.patch("/:announcementId", async (req, res) => {
    const { announcementId } = req.params;
    const parsed = updateAnnouncementSchema.safeParse(req.body);

    if (!validId(announcementId)) {
        return sendError(res, 400, "Invalid announcement ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid announcement update");
    }

    const existing = await prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { id: true, communityId: true },
    });

    if (!existing) {
        return sendError(res, 404, "Announcement not found");
    }

    const access = await getCommunityAccess(
        existing.communityId,
        req.auth.userId,
    );

    if (!access || !canManageAnnouncements(access)) {
        return sendError(res, 403, "Announcement management permission required");
    }

    const announcement = await prisma.announcement.update({
        where: { id: announcementId },
        data: parsed.data,
        select: {
            id: true,
            communityId: true,
            authorId: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            publishedAt: true,
        },
    });

    return res.json({ announcement });
});

/**
 * POST /api/announcements/:announcementId/publish
 * Publish a draft announcement.
 */
announcementRouter.post("/:announcementId/publish", async (req, res) => {
    const { announcementId } = req.params;

    if (!validId(announcementId)) {
        return sendError(res, 400, "Invalid announcement ID");
    }

    const existing = await prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { id: true, communityId: true, status: true },
    });

    if (!existing) {
        return sendError(res, 404, "Announcement not found");
    }

    const access = await getCommunityAccess(
        existing.communityId,
        req.auth.userId,
    );

    if (!access || !canManageAnnouncements(access)) {
        return sendError(res, 403, "Announcement management permission required");
    }

    if (existing.status === AnnouncementStatus.ARCHIVED) {
        return sendError(res, 409, "Archived announcements cannot be published");
    }

    const announcement = await prisma.announcement.update({
        where: { id: announcementId },
        data: {
            status: AnnouncementStatus.PUBLISHED,
            publishedAt: new Date(),
        },
        select: {
            id: true,
            title: true,
            status: true,
            publishedAt: true,
            updatedAt: true,
        },
    });

    return res.json({ announcement });
});

/**
 * POST /api/announcements/:announcementId/archive
 * Archive an announcement.
 */
announcementRouter.post("/:announcementId/archive", async (req, res) => {
    const { announcementId } = req.params;

    if (!validId(announcementId)) {
        return sendError(res, 400, "Invalid announcement ID");
    }

    const existing = await prisma.announcement.findUnique({
        where: { id: announcementId },
        select: { id: true, communityId: true },
    });

    if (!existing) {
        return sendError(res, 404, "Announcement not found");
    }

    const access = await getCommunityAccess(
        existing.communityId,
        req.auth.userId,
    );

    if (!access || !canManageAnnouncements(access)) {
        return sendError(res, 403, "Announcement management permission required");
    }

    const announcement = await prisma.announcement.update({
        where: { id: announcementId },
        data: { status: AnnouncementStatus.ARCHIVED },
        select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
        },
    });

    return res.json({ announcement });
});

/**
 * POST /api/announcements/:announcementId/read
 * Mark a published announcement as read by the current user.
 */
announcementRouter.post("/:announcementId/read", async (req, res) => {
    const { announcementId } = req.params;

    if (!validId(announcementId)) {
        return sendError(res, 400, "Invalid announcement ID");
    }

    const announcement = await prisma.announcement.findUnique({
        where: { id: announcementId },
        select: {
            id: true,
            communityId: true,
            status: true,
            community: { select: { visibility: true } },
        },
    });

    if (
        !announcement ||
        announcement.status !== AnnouncementStatus.PUBLISHED
    ) {
        return sendError(res, 404, "Published announcement not found");
    }

    const access = await getCommunityAccess(
        announcement.communityId,
        req.auth.userId,
    );

    if (
        announcement.community.visibility === "PRIVATE" &&
        !access
    ) {
        return sendError(res, 403, "Active community membership required");
    }

    if (!access) {
        return sendError(res, 403, "Join the community to mark this as read");
    }

    const read = await prisma.announcementRead.upsert({
        where: {
            announcementId_userId: {
                announcementId,
                userId: req.auth.userId,
            },
        },
        create: {
            announcementId,
            userId: req.auth.userId,
        },
        update: {},
    });

    return res.json({ read: true, announcementId: read.announcementId });
});

export default announcementRouter;