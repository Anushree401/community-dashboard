import { Router, type Response } from "express";
import { z } from "zod";
import {
    CommunityVisibility,
    MembershipRole,
    MembershipStatus,
    Prisma,
} from "@prisma/client";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const communityAdminRouter = Router();

communityAdminRouter.use(requireAuth);

const idSchema = z.string().uuid();

const updateCommunitySchema = z
    .object({
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        visibility: z.nativeEnum(CommunityVisibility).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided",
    });

const updateRoleSchema = z.object({
    role: z.nativeEnum(MembershipRole),
});

const inviteSchema = z.object({
    email: z.string().trim().email().max(320).transform((v) => v.toLowerCase()),
});

const acceptInvitationSchema = z.object({
    invitationId: z.string().uuid(),
});

function sendError(
    res: Response,
    status: number,
    message: string,
) {
    return res.status(status).json({ error: message });
}

function isUuid(value: string): boolean {
    return idSchema.safeParse(value).success;
}

function isUniqueConstraintError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
    );
}

function isForeignKeyError(error: unknown): boolean {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2003"
    );
}

/**
 * Returns the actor's active membership and community creator.
 * An absent or inactive membership is not authorized.
 */
async function getCommunityAccess(communityId: string, userId: string) {
    return prisma.community.findUnique({
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
}

async function requireCommunityAdmin(
    communityId: string,
    userId: string,
) {
    const community = await getCommunityAccess(communityId, userId);

    if (!community) {
        return { error: "Community not found" as const };
    }

    const membership = community.memberships[0];

    if (
        community.createdById !== userId &&
        membership?.role !== MembershipRole.COMMUNITY_ADMIN
    ) {
        return { error: "Community admin access required" as const };
    }

    return { community };
}

/**
 * PATCH /api/communities/:id
 * Update community settings. Only an active community admin or creator.
 */
communityAdminRouter.patch("/:id", async (req, res) => {
    const { id } = req.params;
    const parsed = updateCommunitySchema.safeParse(req.body);

    if (!isUuid(id)) {
        return sendError(res, 400, "Invalid community ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "Invalid community update");
    }

    const access = await requireCommunityAdmin(id, req.auth.userId);

    if ("error" in access && typeof access.error === "string") {
        return sendError(
            res,
            access.error === "Community not found" ? 404 : 403,
            access.error,
        );
    }

    const updated = await prisma.community.update({
        where: { id },
        data: parsed.data,
        select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            visibility: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return res.json({ community: updated });
});

/**
 * DELETE /api/communities/:id
 * Only the original creator may delete a community.
 */
communityAdminRouter.delete("/:id", async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
        return sendError(res, 400, "Invalid community ID");
    }

    const community = await prisma.community.findUnique({
        where: { id },
        select: { id: true, createdById: true },
    });

    if (!community) {
        return sendError(res, 404, "Community not found");
    }

    if (community.createdById !== req.auth.userId) {
        return sendError(res, 403, "Only the community creator can delete it");
    }

    try {
        await prisma.community.delete({ where: { id } });
        return res.status(204).send();
    } catch (error) {
        if (isForeignKeyError(error)) {
            return sendError(
                res,
                409,
                "This community has retained content or records that prevent deletion",
            );
        }

        throw error;
    }
});

/**
 * GET /api/communities/:id/members?page=1&limit=20
 * Active members only. Private community membership is required.
 */
communityAdminRouter.get("/:id/members", async (req, res) => {
    const { id } = req.params;

    if (!isUuid(id)) {
        return sendError(res, 400, "Invalid community ID");
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

    const community = await getCommunityAccess(id, req.auth.userId);

    if (!community) {
        return sendError(res, 404, "Community not found");
    }

    const membership = community.memberships[0];

    if (
        community.createdById !== req.auth.userId &&
        !membership
    ) {
        return sendError(res, 403, "Active community membership required");
    }

    const where = {
        communityId: id,
        status: MembershipStatus.ACTIVE,
    };

    const [members, total] = await prisma.$transaction([
        prisma.communityMembership.findMany({
            where,
            orderBy: { joinedAt: "asc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                role: true,
                joinedAt: true,
                user: {
                    select: {
                        id: true,
                        displayName: true,
                        avatarUrl: true,
                        bio: true,
                    },
                },
            },
        }),
        prisma.communityMembership.count({ where }),
    ]);

    return res.json({
        members,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * PATCH /api/communities/:id/members/:userId/role
 * Admins can assign MEMBER or MODERATOR.
 * Only the creator can grant or revoke COMMUNITY_ADMIN.
 */
communityAdminRouter.patch(
    "/:id/members/:userId/role",
    async (req, res) => {
        const { id, userId } = req.params;
        const parsed = updateRoleSchema.safeParse(req.body);

        if (!isUuid(id) || !isUuid(userId)) {
            return sendError(res, 400, "Invalid community or user ID");
        }

        if (!parsed.success) {
            return sendError(res, 400, "Invalid membership role");
        }

        const access = await requireCommunityAdmin(id, req.auth.userId);

        if ("error" in access && typeof access.error === "string") {
            return sendError(
                res,
                access.error === "Community not found" ? 404 : 403,
                access.error,
            );
        }

        const actorIsCreator =
            access.community.createdById === req.auth.userId;

        if (userId === access.community.createdById) {
            return sendError(res, 403, "The creator's role cannot be changed");
        }

        if (
            parsed.data.role === MembershipRole.COMMUNITY_ADMIN &&
            !actorIsCreator
        ) {
            return sendError(
                res,
                403,
                "Only the community creator can assign admin privileges",
            );
        }

        const target = await prisma.communityMembership.findUnique({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
            select: { status: true },
        });

        if (!target || target.status !== MembershipStatus.ACTIVE) {
            return sendError(res, 404, "Active membership not found");
        }

        const updated = await prisma.communityMembership.update({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
            data: { role: parsed.data.role },
            select: {
                communityId: true,
                userId: true,
                role: true,
                status: true,
            },
        });

        return res.json({ membership: updated });
    },
);

/**
 * DELETE /api/communities/:id/members/:userId
 * Admins can remove members and moderators, but not other admins.
 * Moderators can remove ordinary members only.
 */
communityAdminRouter.delete(
    "/:id/members/:userId",
    async (req, res) => {
        const { id, userId } = req.params;

        if (!isUuid(id) || !isUuid(userId)) {
            return sendError(res, 400, "Invalid community or user ID");
        }

        const community = await getCommunityAccess(id, req.auth.userId);

        if (!community) {
            return sendError(res, 404, "Community not found");
        }

        if (userId === community.createdById) {
            return sendError(res, 403, "The community creator cannot be removed");
        }

        const actorMembership = community.memberships[0];
        const actorIsCreator = community.createdById === req.auth.userId;
        const actorIsAdmin =
            actorMembership?.role === MembershipRole.COMMUNITY_ADMIN;
        const actorIsModerator =
            actorMembership?.role === MembershipRole.MODERATOR;

        if (!actorIsCreator && !actorIsAdmin && !actorIsModerator) {
            return sendError(res, 403, "Insufficient community permissions");
        }

        const target = await prisma.communityMembership.findUnique({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
            select: { role: true, status: true },
        });

        if (!target || target.status !== MembershipStatus.ACTIVE) {
            return sendError(res, 404, "Active membership not found");
        }

        if (
            target.role === MembershipRole.COMMUNITY_ADMIN &&
            !actorIsCreator
        ) {
            return sendError(
                res,
                403,
                "Only the creator can remove another community admin",
            );
        }

        if (
            target.role === MembershipRole.MODERATOR &&
            !actorIsCreator &&
            !actorIsAdmin
        ) {
            return sendError(
                res,
                403,
                "Moderators cannot remove other moderators",
            );
        }

        await prisma.communityMembership.update({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
            data: {
                status: MembershipStatus.BANNED,
            },
        });

        return res.status(204).send();
    },
);

/**
 * POST /api/communities/:id/invitations
 * Invite an existing registered user by email.
 */
communityAdminRouter.post("/:id/invitations", async (req, res) => {
    const { id } = req.params;
    const parsed = inviteSchema.safeParse(req.body);

    if (!isUuid(id)) {
        return sendError(res, 400, "Invalid community ID");
    }

    if (!parsed.success) {
        return sendError(res, 400, "A valid email address is required");
    }

    const access = await requireCommunityAdmin(id, req.auth.userId);

    if ("error" in access && typeof access.error === "string") {
        return sendError(
            res,
            access.error === "Community not found" ? 404 : 403,
            access.error,
        );
    }

    const invitee = await prisma.user.findUnique({
        where: { email: parsed.data.email },
        select: { id: true, status: true },
    });

    if (!invitee || invitee.status !== "ACTIVE") {
        return sendError(res, 404, "An active registered user with that email was not found");
    }

    if (invitee.id === req.auth.userId) {
        return sendError(res, 400, "You cannot invite yourself");
    }

    const existingMembership = await prisma.communityMembership.findUnique({
        where: {
            communityId_userId: {
                communityId: id,
                userId: invitee.id,
            },
        },
        select: { status: true },
    });

    if (existingMembership?.status === MembershipStatus.ACTIVE) {
        return sendError(res, 409, "That user is already an active member");
    }

    const now = new Date();

    const existingInvitation = await prisma.communityInvitation.findFirst({
        where: {
            communityId: id,
            inviteeId: invitee.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
        },
        select: { id: true },
    });

    if (existingInvitation) {
        return sendError(res, 409, "A valid invitation already exists");
    }

    const invitation = await prisma.communityInvitation.create({
        data: {
            communityId: id,
            invitedById: req.auth.userId,
            inviteeId: invitee.id,
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
        select: {
            id: true,
            communityId: true,
            inviteeId: true,
            expiresAt: true,
            createdAt: true,
        },
    });

    // Email delivery can be added later; the invitation is currently
    // stored in the database and can be accepted by its recipient.
    return res.status(201).json({ invitation });
});

/**
 * POST /api/communities/:id/invitations/accept
 * Body: { "invitationId": "..." }
 * Only the intended recipient can accept the invitation.
 */
communityAdminRouter.post(
    "/:id/invitations/accept",
    async (req, res) => {
        const { id } = req.params;
        const parsed = acceptInvitationSchema.safeParse(req.body);

        if (!isUuid(id)) {
            return sendError(res, 400, "Invalid community ID");
        }

        if (!parsed.success) {
            return sendError(res, 400, "A valid invitation ID is required");
        }

        const now = new Date();

        const result = await prisma.$transaction(async (tx) => {
            const invitation = await tx.communityInvitation.findFirst({
                where: {
                    id: parsed.data.invitationId,
                    communityId: id,
                    inviteeId: req.auth.userId,
                    acceptedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
            });

            if (!invitation) {
                return { error: "Invitation not found, expired, or already used" as const };
            }

            const existingMembership = await tx.communityMembership.findUnique({
                where: {
                    communityId_userId: {
                        communityId: id,
                        userId: req.auth.userId,
                    },
                },
                select: { status: true },
            });

            if (existingMembership?.status === MembershipStatus.BANNED) {
                return { error: "You are banned from this community" as const };
            }

            await tx.communityMembership.upsert({
                where: {
                    communityId_userId: {
                        communityId: id,
                        userId: req.auth.userId,
                    },
                },
                create: {
                    communityId: id,
                    userId: req.auth.userId,
                    role: MembershipRole.MEMBER,
                    status: MembershipStatus.ACTIVE,
                },
                update: {
                    role: MembershipRole.MEMBER,
                    status: MembershipStatus.ACTIVE,
                },
            });

            const accepted = await tx.communityInvitation.updateMany({
                where: {
                    id: invitation.id,
                    acceptedAt: null,
                    revokedAt: null,
                    expiresAt: { gt: now },
                },
                data: { acceptedAt: now },
            });

            if (accepted.count !== 1) {
                throw new Error("INVITATION_ALREADY_USED");
            }

            return { communityId: id };
        });

        if (
            "error" in result &&
            typeof result.error === "string"
        ) {
            return sendError(
                res,
                result.error === "You are banned from this community" ? 403 : 404,
                result.error,
            );
        }

        return res.json({
            message: "Invitation accepted",
            communityId: result.communityId,
        });
    },
);

export default communityAdminRouter;
