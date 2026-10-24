import { Router, type Response } from "express";
import { z } from "zod";

import prisma from "../lib/prisma.js";
import { requireAuth } from "../auth/auth.middleware.js";

const notificationRouter = Router();

notificationRouter.use(requireAuth);

const uuidSchema = z.string().uuid();

function sendError(res: Response, status: number, error: string) {
    return res.status(status).json({ error });
}

function validId(value: string) {
    return uuidSchema.safeParse(value).success;
}

/**
 * GET /api/notifications?page=1&limit=20
 * List the authenticated user's notifications.
 */
notificationRouter.get("/", async (req, res) => {
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

    const where = { userId: req.auth.userId };

    const [notifications, total, unreadCount] = await prisma.$transaction([
        prisma.notification.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                userId: true,
                communityId: true,
                type: true,
                title: true,
                body: true,
                readAt: true,
                createdAt: true,
            },
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({
            where: {
                userId: req.auth.userId,
                readAt: null,
            },
        }),
    ]);

    return res.json({
        notifications,
        unreadCount,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    });
});

/**
 * PATCH /api/notifications/:notificationId/read
 * Mark one of the current user's notifications as read.
 */
notificationRouter.patch("/:notificationId/read", async (req, res) => {
    const { notificationId } = req.params;

    if (!validId(notificationId)) {
        return sendError(res, 400, "Invalid notification ID");
    }

    const result = await prisma.notification.updateMany({
        where: {
            id: notificationId,
            userId: req.auth.userId,
            readAt: null,
        },
        data: { readAt: new Date() },
    });

    if (result.count === 0) {
        const existing = await prisma.notification.findFirst({
            where: {
                id: notificationId,
                userId: req.auth.userId,
            },
            select: { id: true, readAt: true },
        });

        if (!existing) {
            return sendError(res, 404, "Notification not found");
        }

        return res.json({
            message: "Notification already read",
            notificationId,
        });
    }

    return res.json({
        message: "Notification marked as read",
        notificationId,
    });
});

/**
 * PATCH /api/notifications/read-all
 * Mark all unread notifications belonging to the current user as read.
 */
notificationRouter.patch("/read-all", async (req, res) => {
    const result = await prisma.notification.updateMany({
        where: {
            userId: req.auth.userId,
            readAt: null,
        },
        data: { readAt: new Date() },
    });

    return res.json({
        message: "Unread notifications marked as read",
        updatedCount: result.count,
    });
});

/**
 * DELETE /api/notifications/:notificationId
 * Delete one of the current user's notifications.
 */
notificationRouter.delete("/:notificationId", async (req, res) => {
    const { notificationId } = req.params;

    if (!validId(notificationId)) {
        return sendError(res, 400, "Invalid notification ID");
    }

    const result = await prisma.notification.deleteMany({
        where: {
            id: notificationId,
            userId: req.auth.userId,
        },
    });

    if (result.count === 0) {
        return sendError(res, 404, "Notification not found");
    }

    return res.status(204).send();
});

export default notificationRouter;