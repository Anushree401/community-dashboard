
import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import prisma from "../lib/prisma.js";

export type AuthUser = {
    userId: string;
    email: string;
    displayName: string;
    status: string;
    user: {
        id: string;
        email: string;
        displayName: string;
        status: string;
    };
    sessionId: string;
};

declare global {
    namespace Express {
        interface Request {
            auth: AuthUser;
        }
    }
}

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const authorization = req.headers.authorization;

        if (!authorization?.startsWith("Bearer ")) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }

        const token = authorization.slice("Bearer ".length).trim();

        if (!token || token.length > 512) {
            res.status(401).json({ error: "Invalid authentication token" });
            return;
        }

        const tokenHash = createHash("sha256")
            .update(token)
            .digest("hex");

        const session = await prisma.session.findUnique({
            where: { tokenHash },
            select: {
                id: true,
                userId: true,
                expiresAt: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                        status: true,
                    },
                },
            },
        });

        if (!session || session.expiresAt <= new Date()) {
            res.status(401).json({ error: "Session expired or invalid" });
            return;
        }

        if (session.user.status !== "ACTIVE") {
            res.status(403).json({ error: "Account is not active" });
            return;
        }

        req.auth = {
            userId: session.user.id,
            email: session.user.email,
            displayName: session.user.displayName,
            status: session.user.status,
            user: {
                id: session.user.id,
                email: session.user.email,
                displayName: session.user.displayName,
                status: session.user.status,
            },
            sessionId: session.id,
        };

        // Update last-seen information without blocking the request.
        void prisma.session
            .updateMany({
                where: { id: session.id },
                data: { lastSeenAt: new Date() },
            })
            .catch((error: unknown) => {
                console.error("Failed to update session activity:", error);
            });

        next();
    } catch (error: unknown) {
        console.error("Authentication middleware error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}
