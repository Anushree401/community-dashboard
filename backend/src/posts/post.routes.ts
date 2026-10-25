
import { Router, type Response } from "express";
import { z } from "zod";
import {
    ActivityType,
    ContentStatus,
    MembershipRole,
    MembershipStatus,
    Prisma,
    ReactionType,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const postRouter = Router();

postRouter.use(requireAuth);

const uuidSchema = z.string().uuid();

const createPostSchema = z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20000),
    topicId: z.string().uuid().nullable().optional(),
});

const updatePostSchema = z
    .object({
        title: z.string().trim().min(1).max(200).optional(),
        body: z.string().trim().min(1).max(20000).optional(),
        topicId: z.string().uuid().nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
        message: "Provide at least one field to update",
    });

const createCommentSchema = z.object({
    body: z.string().trim().min(1).max(10000),
});

const updateCommentSchema = z.object({
    body: z.string().trim().min(1).max(10000),
});

const reactionSchema = z.object({
    reactionType: z.nativeEnum(ReactionType),
});

function sendError(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuidSchema.safeParse(value).success;
}

function isUniqueError(error: unknown) {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
    );
}

type CommunityAccess = {
    role: MembershipRole;
    createdById: string;
};

async function getActiveCommunityAccess(
    communityId: string,
    userId: string,
): Promise<CommunityAccess | null> {
    const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: {
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

    // The creator retains community access even if their membership record
    // is inconsistent. Normal creation should create an active admin record.
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

function canModerate(access: CommunityAccess, userId: string) {
    return (
        access.createdById === userId ||
        access.role === MembershipRole.COMMUNITY_ADMIN ||
        access.role === MembershipRole.MODERATOR
    );
}

/**
 * GET /api/posts/community/:communityId
 * List published posts in a community.
 */
postRouter.get("/community/:communityId", async (req, res) => {
    const { communityId } = req.params;

    if (!validId(communityId)) {
        return sendError(res, 400, "Invalid community ID");
    }

    const access = await getActiveCommunityAccess(
        communityId,
        req.auth.userId,
    );

    const community = await prisma.community.findUnique({
        where: { id: communityId },
        select: { id: true, visibility: true },
    });

    if (!community) {
        return sendError(res, 404, "Community not found");
    }

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

    const where = {
        communityId,
        status: ContentStatus.PUBLISHED,
    };

    const [posts, total] = await prisma.$transaction([
        prisma.post.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                communityId: true,
                authorId: true,
                topicId: true,
                title: true,
                body: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                editedAt: true,
                author: {
                    select: {
                        id: true,
                        displayName: true,
                        avatarUrl: true,
                    },
                },
                topic: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                _count: {
                    select: {
                        comments: true,
                        reactions: true,
                    },
                },
            },
        }),
        prisma.post.count({ where }),
    ]);

    return res.json({
        posts,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * POST /api/posts/community/:communityId
 * Create a post. Requires active community membership.
 */
postRouter.post("/community/:communityId", async (req, res) => {
    const { communityId } = req.params;
    const parsed = createPostSchema.safeParse(req.body);

    if (!validId(communityId)) {
        return sendError(res, 400, "Invalid community ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid post data");
    }

    const access = await getActiveCommunityAccess(
        communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    if (parsed.data.topicId) {
        const topic = await prisma.topic.findFirst({
            where: {
                id: parsed.data.topicId,
                communityId,
            },
            select: { id: true },
        });

        if (!topic) {
            return sendError(res, 400, "Topic does not belong to this community");
        }
    }

    const post = await prisma.post.create({
        data: {
            communityId,
            authorId: req.auth.userId,
            title: parsed.data.title,
            body: parsed.data.body,
            topicId: parsed.data.topicId ?? null,
        },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            topicId: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    await prisma.activity.create({
        data: {
            communityId,
            userId: req.auth.userId,
            eventType: ActivityType.POST_CREATED,
            postId: post.id,
        },
    });
    return res.status(201).json({ post });
});

/**
 * GET /api/posts/:postId
 * Read a published post.
 */
postRouter.get("/:postId", async (req, res) => {
    const { postId } = req.params;

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            topicId: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            editedAt: true,
            deletedAt: true,
            author: {
                select: {
                    id: true,
                    displayName: true,
                    avatarUrl: true,
                },
            },
            topic: {
                select: { id: true, name: true },
            },
            community: {
                select: { id: true, visibility: true },
            },
            _count: {
                select: {
                    comments: true,
                    reactions: true,
                },
            },
        },
    });

    if (!post || post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    if (post.community.visibility === "PRIVATE") {
        const access = await getActiveCommunityAccess(
            post.communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }
    }

    return res.json({ post });
});

/**
 * PATCH /api/posts/:postId
 * Only the author can edit their post.
 */
postRouter.patch("/:postId", async (req, res) => {
    const { postId } = req.params;
    const parsed = updatePostSchema.safeParse(req.body);

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid post update");
    }

    const existing = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            status: true,
        },
    });

    if (!existing || existing.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    if (existing.authorId !== req.auth.userId) {
        return sendError(res, 403, "Only the post author can edit this post");
    }

    const access = await getActiveCommunityAccess(
        existing.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    if (parsed.data.topicId) {
        const topic = await prisma.topic.findFirst({
            where: {
                id: parsed.data.topicId,
                communityId: existing.communityId,
            },
            select: { id: true },
        });

        if (!topic) {
            return sendError(res, 400, "Topic does not belong to this community");
        }
    }

    const post = await prisma.post.update({
        where: { id: postId },
        data: {
            ...parsed.data,
            editedAt: new Date(),
        },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            topicId: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            editedAt: true,
        },
    });

    return res.json({ post });
});

/**
 * DELETE /api/posts/:postId
 * Authors may delete their own posts. Moderators/admins may moderate posts.
 * Deletion is soft: the post remains in the database.
 */
postRouter.delete("/:postId", async (req, res) => {
    const { postId } = req.params;

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    const existing = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            authorId: true,
            status: true,
        },
    });

    if (!existing || existing.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    const access = await getActiveCommunityAccess(
        existing.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    const isAuthor = existing.authorId === req.auth.userId;

    if (!isAuthor && !canModerate(access, req.auth.userId)) {
        return sendError(res, 403, "Insufficient permissions to delete this post");
    }

    await prisma.post.update({
        where: { id: postId },
        data: {
            status: ContentStatus.DELETED,
            deletedAt: new Date(),
            deletedById: req.auth.userId,
        },
    });

    return res.status(204).send();
});

/**
 * POST /api/posts/:postId/comments
 * Add a comment to a published post.
 */
postRouter.post("/:postId/comments", async (req, res) => {
    const { postId } = req.params;
    const parsed = createCommentSchema.safeParse(req.body);

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid comment data");
    }

    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            status: true,
            community: { select: { visibility: true } },
        },
    });

    if (!post || post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    const access = await getActiveCommunityAccess(
        post.communityId,
        req.auth.userId,
    );

    if (post.community.visibility === "PRIVATE" && !access) {
        return sendError(res, 403, "Active community membership required");
    }

    if (!access) {
        return sendError(
            res,
            403,
            "Join the community before commenting",
        );
    }

    const comment = await prisma.comment.create({
        data: {
            postId,
            authorId: req.auth.userId,
            body: parsed.data.body,
        },
        select: {
            id: true,
            postId: true,
            authorId: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            author: {
                select: {
                    id: true,
                    displayName: true,
                    avatarUrl: true,
                },
            },
        },
    });
    await prisma.activity.create({
        data: {
            communityId: post.communityId,
            userId: req.auth.userId,
            eventType: ActivityType.COMMENT_CREATED,
            postId: post.id,
            commentId: comment.id,
        },
    });
    return res.status(201).json({ comment });
});

/**
 * GET /api/posts/:postId/comments?page=1&limit=20
 * List comments for a published post.
 */
postRouter.get("/:postId/comments", async (req, res) => {
    const { postId } = req.params;

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
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

    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            status: true,
            community: { select: { visibility: true } },
        },
    });

    if (!post || post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    if (post.community.visibility === "PRIVATE") {
        const access = await getActiveCommunityAccess(
            post.communityId,
            req.auth.userId,
        );

        if (!access) {
            return sendError(res, 403, "Active community membership required");
        }
    }

    const where = { postId };

    const [comments, total] = await prisma.$transaction([
        prisma.comment.findMany({
            where,
            orderBy: { createdAt: "asc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                postId: true,
                authorId: true,
                body: true,
                createdAt: true,
                updatedAt: true,
                author: {
                    select: {
                        id: true,
                        displayName: true,
                        avatarUrl: true,
                    },
                },
            },
        }),
        prisma.comment.count({ where }),
    ]);

    return res.json({
        comments,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * PATCH /api/posts/comments/:commentId
 * Only the comment author can edit a comment.
 */
postRouter.patch("/comments/:commentId", async (req, res) => {
    const { commentId } = req.params;
    const parsed = updateCommentSchema.safeParse(req.body);

    if (!validId(commentId)) {
        return sendError(res, 400, "Invalid comment ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid comment data");
    }

    const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            authorId: true,
            post: {
                select: {
                    communityId: true,
                    status: true,
                },
            },
        },
    });

    if (!comment || comment.post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Comment not found");
    }

    if (comment.authorId !== req.auth.userId) {
        return sendError(res, 403, "Only the comment author can edit it");
    }

    const access = await getActiveCommunityAccess(
        comment.post.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    const updated = await prisma.comment.update({
        where: { id: commentId },
        data: { body: parsed.data.body },
        select: {
            id: true,
            postId: true,
            authorId: true,
            body: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return res.json({ comment: updated });
});

/**
 * DELETE /api/posts/comments/:commentId
 * Comment author or community moderator/admin may delete a comment.
 */
postRouter.delete("/comments/:commentId", async (req, res) => {
    const { commentId } = req.params;

    if (!validId(commentId)) {
        return sendError(res, 400, "Invalid comment ID");
    }

    const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            authorId: true,
            post: {
                select: {
                    communityId: true,
                    status: true,
                },
            },
        },
    });

    if (!comment || comment.post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Comment not found");
    }

    const access = await getActiveCommunityAccess(
        comment.post.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    const isAuthor = comment.authorId === req.auth.userId;

    if (!isAuthor && !canModerate(access, req.auth.userId)) {
        return sendError(res, 403, "Insufficient permissions to delete this comment");
    }

    await prisma.comment.delete({ where: { id: commentId } });

    return res.status(204).send();
});

/**
 * PUT /api/posts/:postId/reaction
 * Set or change the current user's reaction.
 */
postRouter.put("/:postId/reaction", async (req, res) => {
    const { postId } = req.params;
    const parsed = reactionSchema.safeParse(req.body);

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid reaction type");
    }

    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            status: true,
        },
    });

    if (!post || post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    const access = await getActiveCommunityAccess(
        post.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }
    const existingReaction = await prisma.postReaction.findUnique({
        where: {
            postId_userId_reactionType: {
                postId,
                userId: req.auth.userId,
                reactionType: parsed.data.reactionType,
            },
        },
        select: { postId: true },
    });
    const reaction = await prisma.postReaction.upsert({
        where: {
            postId_userId_reactionType: {
                postId,
                userId: req.auth.userId,
                reactionType: parsed.data.reactionType,
            },
        },
        create: {
            postId,
            userId: req.auth.userId,
            reactionType: parsed.data.reactionType,
        },
        update: {},
        select: {
            postId: true,
            userId: true,
            reactionType: true,
            createdAt: true,
        },
    });
    if (!existingReaction) {
        await prisma.activity.create({
            data: {
                communityId: post.communityId,
                userId: req.auth.userId,
                eventType: ActivityType.REACTION_ADDED,
                postId: post.id,
            },
        });
    }
    return res.json({ reaction });
});

/**
 * DELETE /api/posts/:postId/reaction
 * Remove the current user's reaction.
 */
postRouter.delete("/:postId/reaction", async (req, res) => {
    const { postId } = req.params;
    const parsed = z.nativeEnum(ReactionType).safeParse(req.query.reactionType);

    if (!validId(postId)) {
        return sendError(res, 400, "Invalid post ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "A valid reactionType query parameter is required");
    }

    const post = await prisma.post.findUnique({
        where: { id: postId },
        select: {
            id: true,
            communityId: true,
            status: true,
        },
    });

    if (!post || post.status !== ContentStatus.PUBLISHED) {
        return sendError(res, 404, "Post not found");
    }

    const access = await getActiveCommunityAccess(
        post.communityId,
        req.auth.userId,
    );

    if (!access) {
        return sendError(res, 403, "Active community membership required");
    }

    const result = await prisma.postReaction.deleteMany({
        where: {
            postId,
            userId: req.auth.userId,
            reactionType: parsed.data,
        },
    });

    if (result.count === 0) {
        return sendError(res, 404, "Reaction not found");
    }

    return res.status(204).send();
});


export default postRouter;