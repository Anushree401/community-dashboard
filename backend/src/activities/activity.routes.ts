
import { Router, type Response } from "express";
import { z } from "zod";
import {
    ActivityType,
    MembershipStatus,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const router = Router();
router.use(requireAuth);

const uuid = z.string().uuid();

const createActivitySchema = z.object({
    communityId: uuid,
    eventType: z.nativeEnum(ActivityType),
    postId: uuid.optional(),
    commentId: uuid.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).refine(
    (value) => !(value.postId && value.commentId),
    { message: "Provide either postId or commentId, not both" },
);

function errorResponse(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuid.safeParse(value).success;
}

async function hasActiveMembership(communityId: string, userId: string) {
    const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: {
            createdById: true,
            memberships: {
                where: {
                    userId,
                    status: MembershipStatus.ACTIVE,
                },
                select: { userId: true },
                take: 1,
            },
        },
    });

    if (!community) return false;

    return (
        community.createdById === userId ||
        community.memberships.length > 0
    );
}

/**
 * GET /api/activities/community/:communityId
 * Paginated activity feed for active community members.
 */
router.get("/community/:communityId", async (req, res) => {
    const { communityId } = req.params;

    if (!validId(communityId)) {
        return errorResponse(res, 400, "Invalid community ID");
    }

    if (!(await hasActiveMembership(communityId, req.auth.userId))) {
        return errorResponse(res, 403, "Active community membership required");
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
        return errorResponse(res, 400, "Invalid pagination parameters");
    }

    const where = { communityId };

    const [activities, total] = await prisma.$transaction([
        prisma.activity.findMany({
            where,
            orderBy: { occurredAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                communityId: true,
                userId: true,
                eventType: true,
                postId: true,
                commentId: true,
                occurredAt: true,
                metadata: true,
                user: {
                    select: {
                        id: true,
                        displayName: true,
                        avatarUrl: true,
                    },
                },
            },
        }),
        prisma.activity.count({ where }),
    ]);

    return res.json({
        activities,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * GET /api/activities/me?communityId=<uuid>
 * Activity history for the current user.
 */
router.get("/me", async (req, res) => {
    const communityId = req.query.communityId;

    if (typeof communityId !== "string" || !validId(communityId)) {
        return errorResponse(res, 400, "A valid communityId query parameter is required");
    }

    if (!(await hasActiveMembership(communityId, req.auth.userId))) {
        return errorResponse(res, 403, "Active community membership required");
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
        return errorResponse(res, 400, "Invalid pagination parameters");
    }

    const where = {
        communityId,
        userId: req.auth.userId,
    };

    const [activities, total] = await prisma.$transaction([
        prisma.activity.findMany({
            where,
            orderBy: { occurredAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                communityId: true,
                eventType: true,
                postId: true,
                commentId: true,
                occurredAt: true,
                metadata: true,
            },
        }),
        prisma.activity.count({ where }),
    ]);

    return res.json({
        activities,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * POST /api/activities
 * Record an activity for the authenticated user.
 */
router.post("/", async (req, res) => {
    const parsed = createActivitySchema.safeParse(req.body);

    if (!parsed.success) {
        return errorResponse(res, 400, "Invalid activity data");
    }

    const {
        communityId,
        eventType,
        postId,
        commentId,
        metadata,
    } = parsed.data;

    if (!(await hasActiveMembership(communityId, req.auth.userId))) {
        return errorResponse(res, 403, "Active community membership required");
    }

    if (postId) {
        const post = await prisma.post.findFirst({
            where: {
                id: postId,
                communityId,
            },
            select: { id: true },
        });

        if (!post) {
            return errorResponse(res, 400, "Post does not belong to this community");
        }
    }

    if (commentId) {
        const comment = await prisma.comment.findFirst({
            where: {
                id: commentId,
                post: { communityId },
            },
            select: { id: true },
        });

        if (!comment) {
            return errorResponse(res, 400, "Comment does not belong to this community");
        }
    }

    const activity = await prisma.activity.create({
        data: {
            communityId,
            userId: req.auth.userId,
            eventType,
            postId,
            commentId,
            metadata: metadata as import("@prisma/client").Prisma.InputJsonValue | undefined,
        },
        select: {
            id: true,
            communityId: true,
            userId: true,
            eventType: true,
            postId: true,
            commentId: true,
            occurredAt: true,
            metadata: true,
        },
    });

    return res.status(201).json({ activity });
});

export default router;
