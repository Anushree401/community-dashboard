
import { Router, type Response } from "express";
import { z } from "zod";
import {
    AnnouncementStatus,
    ContentStatus,
    MembershipRole,
    MembershipStatus,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

const uuidSchema = z.string().uuid();

function sendError(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuidSchema.safeParse(value).success;
}

async function getAnalyticsAccess(communityId: string, userId: string) {
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
            isAdmin: true,
        };
    }

    if (!membership) return null;

    return {
        role: membership.role,
        isAdmin:
            membership.role === MembershipRole.COMMUNITY_ADMIN,
    };
}

/**
 * GET /api/analytics/community/:communityId/overview
 * Summary metrics for a community.
 */
analyticsRouter.get(
    "/community/:communityId/overview",
    async (req, res) => {
        const { communityId } = req.params;

        if (!validId(communityId)) {
            return sendError(res, 400, "Invalid community ID");
        }

        const access = await getAnalyticsAccess(
            communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }

        if (
            access.role !== MembershipRole.COMMUNITY_ADMIN &&
            access.role !== MembershipRole.MODERATOR
        ) {
            return sendError(res, 403, "Analytics permission required");
        }

        const [
            totalMembers,
            activeMembers,
            pendingMembers,
            publishedPosts,
            publishedAnnouncements,
            totalComments,
            totalReactions,
            pointsAggregate,
        ] = await Promise.all([
            prisma.communityMembership.count({
                where: { communityId },
            }),
            prisma.communityMembership.count({
                where: {
                    communityId,
                    status: MembershipStatus.ACTIVE,
                },
            }),
            prisma.communityMembership.count({
                where: {
                    communityId,
                    status: MembershipStatus.PENDING,
                },
            }),
            prisma.post.count({
                where: {
                    communityId,
                    status: ContentStatus.PUBLISHED,
                },
            }),
            prisma.announcement.count({
                where: {
                    communityId,
                    status: AnnouncementStatus.PUBLISHED,
                },
            }),
            prisma.comment.count({
                where: {
                    post: {
                        communityId,
                        status: ContentStatus.PUBLISHED,
                    },
                },
            }),
            prisma.postReaction.count({
                where: {
                    post: { communityId },
                },
            }),
            prisma.pointTransaction.aggregate({
                where: { communityId },
                _sum: { points: true },
            }),
        ]);

        return res.json({
            communityId,
            members: {
                total: totalMembers,
                active: activeMembers,
                pending: pendingMembers,
            },
            content: {
                publishedPosts,
                publishedAnnouncements,
                comments: totalComments,
                reactions: totalReactions,
            },
            gamification: {
                netPointsAwarded: pointsAggregate._sum.points ?? 0,
            },
        });
    },
);

/**
 * GET /api/analytics/community/:communityId/membership-growth?days=30
 * Daily membership additions over the selected period.
 */
analyticsRouter.get(
    "/community/:communityId/membership-growth",
    async (req, res) => {
        const { communityId } = req.params;
        const days = Number(req.query.days ?? 30);

        if (!validId(communityId)) {
            return sendError(res, 400, "Invalid community ID");
        }

        if (!Number.isInteger(days) || days < 1 || days > 365) {
            return sendError(res, 400, "Days must be between 1 and 365");
        }

        const access = await getAnalyticsAccess(
            communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }

        if (
            access.role !== MembershipRole.COMMUNITY_ADMIN &&
            access.role !== MembershipRole.MODERATOR
        ) {
            return sendError(res, 403, "Analytics permission required");
        }

        const startDate = new Date();
        startDate.setUTCHours(0, 0, 0, 0);
        startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

        const memberships = await prisma.communityMembership.findMany({
            where: {
                communityId,
                joinedAt: { gte: startDate },
            },
            select: { joinedAt: true },
            orderBy: { joinedAt: "asc" },
        });

        const counts = new Map<string, number>();

        for (const membership of memberships) {
            const date = membership.joinedAt.toISOString().slice(0, 10);
            counts.set(date, (counts.get(date) ?? 0) + 1);
        }

        const growth = Array.from({ length: days }, (_, index) => {
            const date = new Date(startDate);
            date.setUTCDate(startDate.getUTCDate() + index);

            const dateKey = date.toISOString().slice(0, 10);

            return {
                date: dateKey,
                newMembers: counts.get(dateKey) ?? 0,
            };
        });

        return res.json({ communityId, days, growth });
    },
);

/**
 * GET /api/analytics/community/:communityId/engagement?days=30
 * Daily published post, comment, and reaction counts.
 */
analyticsRouter.get(
    "/community/:communityId/engagement",
    async (req, res) => {
        const { communityId } = req.params;
        const days = Number(req.query.days ?? 30);

        if (!validId(communityId)) {
            return sendError(res, 400, "Invalid community ID");
        }

        if (!Number.isInteger(days) || days < 1 || days > 365) {
            return sendError(res, 400, "Days must be between 1 and 365");
        }

        const access = await getAnalyticsAccess(
            communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }

        if (
            access.role !== MembershipRole.COMMUNITY_ADMIN &&
            access.role !== MembershipRole.MODERATOR
        ) {
            return sendError(res, 403, "Analytics permission required");
        }

        const startDate = new Date();
        startDate.setUTCHours(0, 0, 0, 0);
        startDate.setUTCDate(startDate.getUTCDate() - (days - 1));

        const [posts, comments, reactions] = await Promise.all([
            prisma.post.findMany({
                where: {
                    communityId,
                    status: ContentStatus.PUBLISHED,
                    createdAt: { gte: startDate },
                },
                select: { createdAt: true },
            }),
            prisma.comment.findMany({
                where: {
                    post: {
                        communityId,
                        status: ContentStatus.PUBLISHED,
                    },
                    createdAt: { gte: startDate },
                },
                select: { createdAt: true },
            }),
            prisma.postReaction.findMany({
                where: {
                    post: { communityId },
                    createdAt: { gte: startDate },
                },
                select: { createdAt: true },
            }),
        ]);

        const daily = new Map<
            string,
            { posts: number; comments: number; reactions: number }
        >();

        for (let i = 0; i < days; i++) {
            const date = new Date(startDate);
            date.setUTCDate(startDate.getUTCDate() + i);

            daily.set(date.toISOString().slice(0, 10), {
                posts: 0,
                comments: 0,
                reactions: 0,
            });
        }

        for (const post of posts) {
            const key = post.createdAt.toISOString().slice(0, 10);
            const entry = daily.get(key);
            if (entry) entry.posts++;
        }

        for (const comment of comments) {
            const key = comment.createdAt.toISOString().slice(0, 10);
            const entry = daily.get(key);
            if (entry) entry.comments++;
        }

        for (const reaction of reactions) {
            const key = reaction.createdAt.toISOString().slice(0, 10);
            const entry = daily.get(key);
            if (entry) entry.reactions++;
        }

        return res.json({
            communityId,
            days,
            engagement: Array.from(daily, ([date, metrics]) => ({
                date,
                ...metrics,
            })),
        });
    },
);

/**
 * GET /api/analytics/community/:communityId/top-posts?limit=10
 * Rank published posts by reaction count.
 */
analyticsRouter.get(
    "/community/:communityId/top-posts",
    async (req, res) => {
        const { communityId } = req.params;
        const limit = Number(req.query.limit ?? 10);

        if (!validId(communityId)) {
            return sendError(res, 400, "Invalid community ID");
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            return sendError(res, 400, "Limit must be between 1 and 50");
        }

        const access = await getAnalyticsAccess(
            communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }

        if (
            access.role !== MembershipRole.COMMUNITY_ADMIN &&
            access.role !== MembershipRole.MODERATOR
        ) {
            return sendError(res, 403, "Analytics permission required");
        }

        const posts = await prisma.post.findMany({
            where: {
                communityId,
                status: ContentStatus.PUBLISHED,
            },
            select: {
                id: true,
                title: true,
                authorId: true,
                createdAt: true,
                author: {
                    select: { displayName: true },
                },
                _count: {
                    select: {
                        reactions: true,
                        comments: true,
                    },
                },
            },
            take: 500,
            orderBy: { createdAt: "desc" },
        });

        const topPosts = posts
            .sort(
                (a, b) =>
                    b._count.reactions - a._count.reactions ||
                    b._count.comments - a._count.comments,
            )
            .slice(0, limit)
            .map((post) => ({
                id: post.id,
                title: post.title,
                authorId: post.authorId,
                authorName: post.author.displayName,
                createdAt: post.createdAt,
                reactionCount: post._count.reactions,
                commentCount: post._count.comments,
            }));

        return res.json({ topPosts });
    },
);

export default analyticsRouter;
