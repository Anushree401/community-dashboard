
import { Router, type Response } from "express";
import { z } from "zod";
import {
    MembershipRole,
    MembershipStatus,
    Prisma,
    PointReason,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const router = Router();
router.use(requireAuth);

const uuid = z.string().uuid();

const awardPointsSchema = z.object({
    userId: uuid,
    points: z.number().int().min(1).max(10000),
    reason: z.nativeEnum(PointReason),
    idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

const awardBadgeSchema = z.object({
    userId: uuid,
    badgeId: uuid,
    reason: z.string().trim().max(500).optional(),
});

function errorResponse(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuid.safeParse(value).success;
}

async function getMembership(communityId: string, userId: string) {
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

function canManage(
    membership: NonNullable<Awaited<ReturnType<typeof getMembership>>>,
) {
    return (
        membership.role === MembershipRole.COMMUNITY_ADMIN ||
        membership.role === MembershipRole.MODERATOR
    );
}

/**
 * GET /api/gamification/community/:communityId/points
 * Current user's point balance in a community.
 */
router.get("/community/:communityId/points", async (req, res) => {
    const { communityId } = req.params;

    if (!validId(communityId)) {
        return errorResponse(res, 400, "Invalid community ID");
    }

    const membership = await getMembership(communityId, req.auth.userId);

    if (!membership) {
        return errorResponse(res, 403, "Active community membership required");
    }

    const aggregate = await prisma.pointTransaction.aggregate({
        where: {
            communityId,
            userId: req.auth.userId,
        },
        _sum: { points: true },
    });

    return res.json({
        communityId,
        userId: req.auth.userId,
        points: aggregate._sum.points ?? 0,
    });
});

/**
 * GET /api/gamification/community/:communityId/points/history
 * Current user's point transaction history.
 */
router.get(
    "/community/:communityId/points/history",
    async (req, res) => {
        const { communityId } = req.params;

        if (!validId(communityId)) {
            return errorResponse(res, 400, "Invalid community ID");
        }

        const membership = await getMembership(communityId, req.auth.userId);

        if (!membership) {
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

        const [transactions, total] = await prisma.$transaction([
            prisma.pointTransaction.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    points: true,
                    reason: true,
                    activityId: true,
                    postId: true,
                    createdAt: true,
                    createdById: true,
                },
            }),
            prisma.pointTransaction.count({ where }),
        ]);

        return res.json({
            transactions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    },
);

/**
 * POST /api/gamification/community/:communityId/points/award
 * Award points to a community member.
 * Admins and moderators only.
 */
router.post(
    "/community/:communityId/points/award",
    async (req, res) => {
        const { communityId } = req.params;
        const parsed = awardPointsSchema.safeParse(req.body);

        if (!validId(communityId)) {
            return errorResponse(res, 400, "Invalid community ID");
        }

        if (!parsed.success) {
            return errorResponse(res, 400, "Invalid point award data");
        }

        const actor = await getMembership(communityId, req.auth.userId);

        if (!actor || !canManage(actor)) {
            return errorResponse(res, 403, "Point management permission required");
        }

        const recipient = await getMembership(communityId, parsed.data.userId);

        if (!recipient) {
            return errorResponse(res, 404, "Active recipient membership not found");
        }

        try {
            const transaction = await prisma.pointTransaction.create({
                data: {
                    communityId,
                    userId: parsed.data.userId,
                    points: parsed.data.points,
                    reason: parsed.data.reason,
                    createdById: req.auth.userId,
                    idempotencyKey: parsed.data.idempotencyKey,
                },
                select: {
                    id: true,
                    communityId: true,
                    userId: true,
                    points: true,
                    reason: true,
                    createdAt: true,
                    createdById: true,
                },
            });

            return res.status(201).json({ transaction });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                return errorResponse(
                    res,
                    409,
                    "This idempotency key has already been used",
                );
            }

            throw error;
        }
    },
);

/**
 * GET /api/gamification/community/:communityId/leaderboard
 * Rank active members by their net points.
 */
router.get(
    "/community/:communityId/leaderboard",
    async (req, res) => {
        const { communityId } = req.params;

        if (!validId(communityId)) {
            return errorResponse(res, 400, "Invalid community ID");
        }

        const membership = await getMembership(communityId, req.auth.userId);

        if (!membership) {
            return errorResponse(res, 403, "Active community membership required");
        }

        const limit = Number(req.query.limit ?? 20);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return errorResponse(res, 400, "Limit must be between 1 and 100");
        }

        const members = await prisma.communityMembership.findMany({
            where: {
                communityId,
                status: MembershipStatus.ACTIVE,
            },
            select: {
                userId: true,
                user: {
                    select: {
                        displayName: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        const totals = await prisma.pointTransaction.groupBy({
            by: ["userId"],
            where: { communityId },
            _sum: { points: true },
        });

        const pointsByUser = new Map(
            totals.map((entry) => [
                entry.userId,
                entry._sum.points ?? 0,
            ]),
        );

        const leaderboard = members
            .map((member) => ({
                userId: member.userId,
                displayName: member.user.displayName,
                avatarUrl: member.user.avatarUrl,
                points: pointsByUser.get(member.userId) ?? 0,
            }))
            .sort(
                (a, b) =>
                    b.points - a.points ||
                    a.displayName.localeCompare(b.displayName),
            )
            .slice(0, limit)
            .map((entry, index) => ({
                rank: index + 1,
                ...entry,
            }));

        return res.json({ leaderboard });
    },
);

/**
 * GET /api/gamification/badges
 * List active badge definitions.
 */
router.get("/badges", async (_req, res) => {
    const badges = await prisma.badge.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: {
            id: true,
            code: true,
            name: true,
            description: true,
            iconPath: true,
            criteria: true,
        },
    });

    return res.json({ badges });
});

/**
 * GET /api/gamification/community/:communityId/badges
 * List badges earned by the current user in a community.
 */
router.get(
    "/community/:communityId/badges",
    async (req, res) => {
        const { communityId } = req.params;

        if (!validId(communityId)) {
            return errorResponse(res, 400, "Invalid community ID");
        }

        const membership = await getMembership(communityId, req.auth.userId);

        if (!membership) {
            return errorResponse(res, 403, "Active community membership required");
        }

        const awards = await prisma.userBadge.findMany({
            where: {
                userId: req.auth.userId,
                communityId,
            },
            orderBy: { awardedAt: "desc" },
            select: {
                id: true,
                awardedAt: true,
                reason: true,
                badge: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        description: true,
                        iconPath: true,
                    },
                },
                awardedBy: {
                    select: {
                        id: true,
                        displayName: true,
                    },
                },
            },
        });

        return res.json({ awards });
    },
);

/**
 * POST /api/gamification/community/:communityId/badges/award
 * Award a badge to a member. Admins and moderators only.
 */
router.post(
    "/community/:communityId/badges/award",
    async (req, res) => {
        const { communityId } = req.params;
        const parsed = awardBadgeSchema.safeParse(req.body);

        if (!validId(communityId)) {
            return errorResponse(res, 400, "Invalid community ID");
        }

        if (!parsed.success) {
            return errorResponse(res, 400, "Invalid badge award data");
        }

        const actor = await getMembership(communityId, req.auth.userId);

        if (!actor || !canManage(actor)) {
            return errorResponse(res, 403, "Badge management permission required");
        }

        const recipient = await getMembership(communityId, parsed.data.userId);

        if (!recipient) {
            return errorResponse(res, 404, "Active recipient membership not found");
        }

        const badge = await prisma.badge.findFirst({
            where: {
                id: parsed.data.badgeId,
                isActive: true,
            },
            select: { id: true },
        });

        if (!badge) {
            return errorResponse(res, 404, "Active badge not found");
        }

        try {
            const award = await prisma.userBadge.create({
                data: {
                    userId: parsed.data.userId,
                    badgeId: parsed.data.badgeId,
                    communityId,
                    awardedById: req.auth.userId,
                    reason: parsed.data.reason,
                },
                select: {
                    id: true,
                    userId: true,
                    badgeId: true,
                    communityId: true,
                    awardedAt: true,
                    reason: true,
                },
            });

            return res.status(201).json({ award });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                return errorResponse(
                    res,
                    409,
                    "This user has already earned this badge in this community",
                );
            }

            throw error;
        }
    },
);

export default router;
