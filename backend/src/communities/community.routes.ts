import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { requireAuth } from "../auth/auth.middleware.js";

const communityRouter = Router();

const createCommunitySchema = z.object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
});

const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});

function slugify(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 140)
        .replace(/-+$/g, "");
}

function isUniqueConstraintError(error: unknown) {
    return (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
    );
}

function validId(value: string) {
    return z.string().uuid().safeParse(value).success;
}

async function getActiveMembership(communityId: string, userId: string) {
    return prisma.communityMembership.findFirst({
        where: {
            communityId,
            userId,
            status: "ACTIVE",
        },
        select: {
            role: true,
            status: true,
        },
    });
}

// All community endpoints require authentication.
communityRouter.use(requireAuth);

// POST /api/communities
communityRouter.post("/", async (req, res) => {
    const parsed = createCommunitySchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid community data",
            details: parsed.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            })),
        });
    }

    const { name, description, visibility } = parsed.data;
    const slug = slugify(name);

    if (!slug) {
        return res.status(400).json({
            error: "Community name must contain letters or numbers",
        });
    }

    try {
        const community = await prisma.$transaction(async (tx) => {
            const created = await tx.community.create({
                data: {
                    name,
                    slug,
                    description,
                    visibility,
                    createdById: req.auth!.user.id,
                },
            });

            await tx.communityMembership.create({
                data: {
                    communityId: created.id,
                    userId: req.auth!.user.id,
                    role: "COMMUNITY_ADMIN",
                    status: "ACTIVE",
                },
            });

            return created;
        });

        return res.status(201).json({
            community,
            membership: {
                role: "COMMUNITY_ADMIN",
                status: "ACTIVE",
            },
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return res.status(409).json({
                error: "A community with this slug already exists. Choose a different name.",
            });
        }

        console.error("Community creation failed:", error);

        return res.status(500).json({
            error: "Unable to create community",
        });
    }
});

// GET /api/communities?page=1&limit=20
// Public communities only, with pagination.
communityRouter.get("/", async (req, res) => {
    const parsed = paginationSchema.safeParse(req.query);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid pagination parameters",
        });
    }

    const { page, limit } = parsed.data;

    try {
        const [communities, total] = await prisma.$transaction([
            prisma.community.findMany({
                where: { visibility: "PUBLIC" },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    description: true,
                    visibility: true,
                    createdAt: true,
                    creator: {
                        select: {
                            id: true,
                            displayName: true,
                        },
                    },
                    _count: {
                        select: {
                            memberships: {
                                where: { status: "ACTIVE" },
                            },
                        },
                    },
                },
            }),
            prisma.community.count({
                where: { visibility: "PUBLIC" },
            }),
        ]);

        return res.json({
            data: communities,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error("Community listing failed:", error);

        return res.status(500).json({
            error: "Unable to list communities",
        });
    }
});

// GET /api/communities/mine
// Return the authenticated user's active community memberships.
communityRouter.get("/mine", async (req, res) => {
    try {
        const memberships = await prisma.communityMembership.findMany({
            where: {
                userId: req.auth!.user.id,
                status: "ACTIVE",
            },
            orderBy: {
                joinedAt: "desc",
            },
            select: {
                community: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        description: true,
                        visibility: true,
                        createdAt: true,
                        updatedAt: true,
                        createdById: true,
                        creator: {
                            select: {
                                id: true,
                                displayName: true,
                            },
                        },
                        _count: {
                            select: {
                                memberships: {
                                    where: { status: "ACTIVE" },
                                },
                            },
                        },
                    },
                },
            },
        });

        return res.json({
            data: memberships.map((membership) => membership.community),
        });
    } catch (error) {
        console.error("My communities listing failed:", error);

        return res.status(500).json({
            error: "Unable to load your communities",
        });
    }
});

// GET /api/communities/:id
communityRouter.get("/:id", async (req, res) => {
    const { id } = req.params;
    const userId = req.auth!.user.id;

    if (!validId(id)) {
        return res.status(400).json({
            error: "Invalid community ID",
        });
    }

    try {
        const community = await prisma.community.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                visibility: true,
                createdAt: true,
                updatedAt: true,
                createdById: true,
                creator: {
                    select: {
                        id: true,
                        displayName: true,
                    },
                },
                _count: {
                    select: {
                        memberships: {
                            where: { status: "ACTIVE" },
                        },
                    },
                },
            },
        });

        if (!community) {
            return res.status(404).json({
                error: "Community not found",
            });
        }

        const membership = await getActiveMembership(id, userId);

        if (community.visibility === "PRIVATE" && !membership) {
            return res.status(404).json({
                error: "Community not found",
            });
        }

        return res.json({
            community,
            membership,
        });
    } catch (error) {
        console.error("Community retrieval failed:", error);

        return res.status(500).json({
            error: "Unable to retrieve community",
        });
    }
});

// POST /api/communities/:id/join
communityRouter.post("/:id/join", async (req, res) => {
    const { id } = req.params;
    const userId = req.auth!.user.id;

    if (!validId(id)) {
        return res.status(400).json({
            error: "Invalid community ID",
        });
    }

    try {
        const community = await prisma.community.findUnique({
            where: { id },
            select: {
                id: true,
                visibility: true,
            },
        });

        if (!community) {
            return res.status(404).json({
                error: "Community not found",
            });
        }

        if (community.visibility === "PRIVATE") {
            return res.status(403).json({
                error: "This is a private community. Membership requires an invitation.",
            });
        }

        const existing = await prisma.communityMembership.findUnique({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
        });

        if (existing?.status === "BANNED") {
            return res.status(403).json({
                error: "You cannot join this community",
            });
        }

        if (existing?.status === "ACTIVE") {
            return res.json({
                message: "You are already a member",
                membership: existing,
            });
        }

        const membership = existing
            ? await prisma.communityMembership.update({
                where: {
                    communityId_userId: {
                        communityId: id,
                        userId,
                    },
                },
                data: {
                    status: "ACTIVE",
                    role: "MEMBER",
                    joinedAt: new Date(),
                },
            })
            : await prisma.communityMembership.create({
                data: {
                    communityId: id,
                    userId,
                    role: "MEMBER",
                    status: "ACTIVE",
                },
            });

        return res.status(201).json({
            message: "Joined community successfully",
            membership,
        });
    } catch (error) {
        console.error("Community join failed:", error);

        return res.status(500).json({
            error: "Unable to join community",
        });
    }
});

// POST /api/communities/:id/leave
communityRouter.post("/:id/leave", async (req, res) => {
    const { id } = req.params;
    const userId = req.auth!.user.id;

    if (!validId(id)) {
        return res.status(400).json({
            error: "Invalid community ID",
        });
    }

    try {
        const community = await prisma.community.findUnique({
            where: { id },
            select: {
                id: true,
                createdById: true,
            },
        });

        if (!community) {
            return res.status(404).json({
                error: "Community not found",
            });
        }

        if (community.createdById === userId) {
            return res.status(409).json({
                error: "The community creator cannot leave. Transfer ownership first.",
            });
        }

        const membership = await prisma.communityMembership.findUnique({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
        });

        if (!membership || membership.status !== "ACTIVE") {
            return res.status(404).json({
                error: "Active membership not found",
            });
        }

        await prisma.communityMembership.update({
            where: {
                communityId_userId: {
                    communityId: id,
                    userId,
                },
            },
            data: {
                status: "PENDING",
                role: "MEMBER",
            },
        });

        return res.json({
            message: "Left community successfully",
        });
    } catch (error) {
        console.error("Community leave failed:", error);

        return res.status(500).json({
            error: "Unable to leave community",
        });
    }
});

export default communityRouter;