import { Router } from "express";
import {
    createHash,
    createHmac,
    randomBytes,
    randomInt,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import prisma from "../lib/prisma";
import {
    sendVerificationOtp,
    sendPasswordResetEmail,
} from "../lib/email.js";
import { requireAuth } from "./auth.middleware.js";
import { loginSchema, registerSchema } from "./auth.schema.js";

const authRouter = Router();

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: process.env.NODE_ENV === "test"
        ? 100
        : 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Too many authentication attempts. Try again later.",
    },
});

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_DURATION_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpSecret = process.env.OTP_HASH_SECRET;

const PASSWORD_RESET_DURATION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;

const resetPasswordSchema = z.object({
    email: z.string().trim().email().max(320)
        .transform((value) => value.toLowerCase()),
    token: z.string().min(32).max(512),
    password: z.string().min(12).max(128)
        .regex(/[A-Z]/, "Password must contain an uppercase letter")
        .regex(/[a-z]/, "Password must contain a lowercase letter")
        .regex(/[0-9]/, "Password must contain a number")
        .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});

if (!otpSecret || !/^[a-fA-F0-9]{64}$/.test(otpSecret)) {
    throw new Error("OTP_HASH_SECRET must be a 64-character hexadecimal secret");
}

const emailSchema = z.object({
    email: z.string().trim().email().max(320)
        .transform((value) => value.toLowerCase()),
});

const verifyEmailSchema = emailSchema.extend({
    otp: z.string().regex(/^\d{6}$/, "OTP must contain six digits"),
});

function createSessionToken() {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256")
        .update(token)
        .digest("hex");

    return { token, tokenHash };
}

function createOtp() {
    return randomInt(0, 1_000_000)
        .toString()
        .padStart(6, "0");
}

function hashOtp(userId: string, otp: string) {
    return createHmac("sha256", otpSecret!)
        .update(`${userId}:${otp}`)
        .digest("hex");
}

function isUniqueConstraintError(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
    );
}

async function createOtpChallenge(userId: string) {
    const otp = createOtp();
    const codeHash = hashOtp(userId, otp);
    const expiresAt = new Date(Date.now() + OTP_DURATION_MS);

    const challenge = await prisma.emailVerificationChallenge.create({
        data: {
            userId,
            codeHash,
            expiresAt,
        },
    });

    return { challenge, otp };
}

authRouter.post("/forgot-password", authLimiter, async (req, res) => {
    const parsed = emailSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Provide a valid email address",
        });
    }

    const { email } = parsed.data;

    // Same response whether the account exists or not.
    const genericResponse = {
        message: "If an eligible account exists, password reset instructions will be sent.",
    };

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                status: true,
            },
        });

        if (!user || user.status !== "ACTIVE") {
            return res.json(genericResponse);
        }

        const latestToken = await prisma.passwordResetToken.findFirst({
            where: {
                userId: user.id,
                usedAt: null,
            },
            orderBy: { createdAt: "desc" },
        });

        if (
            latestToken &&
            Date.now() - latestToken.createdAt.getTime() <
            PASSWORD_RESET_RESEND_COOLDOWN_MS
        ) {
            return res.json(genericResponse);
        }

        const token = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256")
            .update(token)
            .digest("hex");

        const now = new Date();

        // Invalidate previous unused tokens before creating a replacement.
        await prisma.$transaction(async (tx) => {
            await tx.passwordResetToken.updateMany({
                where: {
                    userId: user.id,
                    usedAt: null,
                },
                data: { usedAt: now },
            });

            await tx.passwordResetToken.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt: new Date(
                        now.getTime() + PASSWORD_RESET_DURATION_MS,
                    ),
                },
            });
        });

        try {
            await sendPasswordResetEmail(user.email, token);
        } catch (emailError) {
            // Invalidate the token if delivery fails.
            await prisma.passwordResetToken.updateMany({
                where: {
                    tokenHash,
                    usedAt: null,
                },
                data: { usedAt: new Date() },
            });

            console.error("Password reset email delivery failed:", emailError);

            return res.status(503).json({
                error: "Unable to send password reset email. Please try again later.",
            });
        }

        return res.json(genericResponse);
    } catch (error) {
        console.error("Password reset request failed:", error);

        return res.status(500).json({
            error: "Unable to process password reset request",
        });
    }
});

authRouter.post("/reset-password", authLimiter, async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid password reset data",
            details: parsed.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            })),
        });
    }

    const { email, token, password } = parsed.data;

    const tokenHash = createHash("sha256")
        .update(token)
        .digest("hex");

    try {
        const now = new Date();

        // Hash the new password with the same Argon2 library used at registration.
        const passwordHash = await hash(password);

        const result = await prisma.$transaction(async (tx) => {
            const resetToken = await tx.passwordResetToken.findUnique({
                where: { tokenHash },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            status: true,
                        },
                    },
                },
            });

            if (
                !resetToken ||
                resetToken.user.email !== email ||
                resetToken.user.status !== "ACTIVE" ||
                resetToken.usedAt !== null ||
                resetToken.expiresAt <= now
            ) {
                return false;
            }

            // Conditional update prevents a token from being consumed twice.
            const consumed = await tx.passwordResetToken.updateMany({
                where: {
                    id: resetToken.id,
                    usedAt: null,
                    expiresAt: { gt: now },
                },
                data: { usedAt: now },
            });

            if (consumed.count !== 1) {
                return false;
            }

            const updatedUser = await tx.user.updateMany({
                where: {
                    id: resetToken.user.id,
                    status: "ACTIVE",
                },
                data: { passwordHash },
            });

            if (updatedUser.count !== 1) {
                throw new Error("Account status changed during password reset");
            }

            // Invalidate all existing sessions, including the current session.
            await tx.session.deleteMany({
                where: { userId: resetToken.user.id },
            });

            // Invalidate any other outstanding reset tokens.
            await tx.passwordResetToken.updateMany({
                where: {
                    userId: resetToken.user.id,
                    id: { not: resetToken.id },
                    usedAt: null,
                },
                data: { usedAt: now },
            });

            return true;
        });

        if (!result) {
            return res.status(400).json({
                error: "Invalid or expired password reset link",
            });
        }

        return res.json({
            message: "Password reset successfully. Please sign in with your new password.",
        });
    } catch (error) {
        console.error("Password reset failed:", error);

        return res.status(500).json({
            error: "Unable to reset password",
        });
    }
});

// Register a pending account and send its verification code.
authRouter.post("/register", authLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid registration data",
            details: parsed.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            })),
        });
    }

    const { email, password, displayName } = parsed.data;
    let createdUserId: string | undefined;

    try {
        const passwordHash = await hash(password);

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                displayName,
                status: "PENDING_VERIFICATION",
            },
            select: {
                id: true,
                email: true,
                displayName: true,
                status: true,
                createdAt: true,
            },
        });

        createdUserId = user.id;

        const { otp } = await createOtpChallenge(user.id);

        try {
            await sendVerificationOtp(user.email, otp);
        } catch (emailError) {
            // Remove this newly created account if email delivery fails.
            // Related challenges are removed through the database cascade.
            await prisma.user.deleteMany({
                where: {
                    id: user.id,
                    status: "PENDING_VERIFICATION",
                },
            });

            createdUserId = undefined;
            console.error("Registration email delivery failed:", emailError);

            return res.status(503).json({
                error: "Unable to send verification email. Please try again.",
            });
        }

        return res.status(201).json({
            message: "Registration received. Check your email for a verification code.",
            user: {
                email: user.email,
                displayName: user.displayName,
                status: user.status,
            },
        });
    } catch (error) {
        // Best-effort cleanup if challenge creation fails after user creation.
        if (createdUserId) {
            try {
                await prisma.user.deleteMany({
                    where: {
                        id: createdUserId,
                        status: "PENDING_VERIFICATION",
                    },
                });
            } catch (cleanupError) {
                console.error("Pending account cleanup failed:", cleanupError);
            }
        }

        if (isUniqueConstraintError(error)) {
            return res.status(409).json({
                error: "An account with these details may already exist",
            });
        }

        console.error("Registration failed:", error);

        return res.status(500).json({
            error: "Unable to complete registration",
        });
    }
});

// Verify an email address and activate the account.
authRouter.post("/verify-email", authLimiter, async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Provide a valid email address and six-digit OTP",
        });
    }

    const { email, otp } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                displayName: true,
                status: true,
            },
        });

        if (!user || user.status !== "PENDING_VERIFICATION") {
            return res.status(400).json({
                error: "Invalid or expired verification code",
            });
        }

        const challenge = await prisma.emailVerificationChallenge.findFirst({
            where: {
                userId: user.id,
                consumedAt: null,
                expiresAt: { gt: new Date() },
                attempts: { lt: OTP_MAX_ATTEMPTS },
            },
            orderBy: { createdAt: "desc" },
        });

        if (!challenge) {
            return res.status(400).json({
                error: "Invalid or expired verification code. Request a new code.",
            });
        }

        const submittedHash = hashOtp(user.id, otp);
        const codeMatches = createHash("sha256")
            .update(submittedHash)
            .digest()
            .length === createHash("sha256")
                .update(challenge.codeHash)
                .digest()
                .length
            && Buffer.from(submittedHash, "hex").length === 32
            && Buffer.from(challenge.codeHash, "hex").length === 32
            && (await import("node:crypto")).timingSafeEqual(
                Buffer.from(submittedHash, "hex"),
                Buffer.from(challenge.codeHash, "hex"),
            );

        if (!codeMatches) {
            await prisma.emailVerificationChallenge.updateMany({
                where: {
                    id: challenge.id,
                    consumedAt: null,
                    attempts: { lt: OTP_MAX_ATTEMPTS },
                },
                data: {
                    attempts: { increment: 1 },
                },
            });

            return res.status(400).json({
                error: "Invalid or expired verification code",
            });
        }

        const now = new Date();

        const activated = await prisma.$transaction(async (tx) => {
            const consumed = await tx.emailVerificationChallenge.updateMany({
                where: {
                    id: challenge.id,
                    consumedAt: null,
                    expiresAt: { gt: now },
                    attempts: { lt: OTP_MAX_ATTEMPTS },
                },
                data: { consumedAt: now },
            });

            if (consumed.count !== 1) {
                return false;
            }

            const result = await tx.user.updateMany({
                where: {
                    id: user.id,
                    status: "PENDING_VERIFICATION",
                },
                data: { status: "ACTIVE" },
            });

            if (result.count !== 1) {
                throw new Error("Account status changed during verification");
            }

            return true;
        });

        if (!activated) {
            return res.status(400).json({
                error: "Invalid or expired verification code",
            });
        }

        // No session is issued here. The user logs in after verification.
        return res.json({
            message: "Email verified successfully. You can now log in.",
        });
    } catch (error) {
        console.error("Email verification failed:", error);

        return res.status(500).json({
            error: "Unable to verify email",
        });
    }
});

// Resend an OTP, subject to a cooldown.
authRouter.post("/resend-otp", authLimiter, async (req, res) => {
    const parsed = emailSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Provide a valid email address",
        });
    }

    const { email } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                status: true,
            },
        });

        // Avoid disclosing whether an account exists or is already verified.
        const genericResponse = {
            message: "If this account needs verification, a code will be sent when eligible.",
        };

        if (!user || user.status !== "PENDING_VERIFICATION") {
            return res.json(genericResponse);
        }

        const latestChallenge =
            await prisma.emailVerificationChallenge.findFirst({
                where: { userId: user.id },
                orderBy: { createdAt: "desc" },
            });

        if (
            latestChallenge &&
            Date.now() - latestChallenge.createdAt.getTime() <
            OTP_RESEND_COOLDOWN_MS
        ) {
            return res.json(genericResponse);
        }

        const { challenge, otp } = await createOtpChallenge(user.id);

        try {
            await sendVerificationOtp(user.email, otp);
        } catch (emailError) {
            // Delete only the new challenge so a previously emailed code
            // remains available if it has not expired or been consumed.
            await prisma.emailVerificationChallenge.deleteMany({
                where: { id: challenge.id },
            });

            console.error("OTP resend delivery failed:", emailError);

            return res.status(503).json({
                error: "Unable to send verification email. Please try again later.",
            });
        }

        // Invalidate older codes only after the new email has been sent.
        await prisma.emailVerificationChallenge.updateMany({
            where: {
                userId: user.id,
                id: { not: challenge.id },
                consumedAt: null,
            },
            data: { consumedAt: new Date() },
        });

        return res.json(genericResponse);
    } catch (error) {
        console.error("OTP resend failed:", error);

        return res.status(500).json({
            error: "Unable to process verification request",
        });
    }
});

// Login: only verified, active accounts can receive sessions.
authRouter.post("/login", authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid login data",
        });
    }

    const { email, password } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        let passwordMatches = false;

        try {
            passwordMatches = await verify(user.passwordHash, password);
        } catch {
            passwordMatches = false;
        }

        if (!passwordMatches) {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        if (user.status === "PENDING_VERIFICATION") {
            return res.status(403).json({
                error: "Please verify your email before logging in",
                code: "EMAIL_NOT_VERIFIED",
            });
        }

        if (user.status !== "ACTIVE") {
            return res.status(401).json({
                error: "Invalid email or password",
            });
        }

        const { token, tokenHash } = createSessionToken();
        const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

        await prisma.$transaction([
            prisma.session.create({
                data: {
                    userId: user.id,
                    tokenHash,
                    expiresAt,
                    ipAddress: req.ip,
                    userAgent: req.get("user-agent")?.slice(0, 1000),
                },
            }),
            prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() },
            }),
        ]);

        return res.json({
            user: {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                status: user.status,
            },
            token,
            tokenType: "Bearer",
            expiresAt: expiresAt.toISOString(),
        });
    } catch (error) {
        console.error("Login failed:", error);

        return res.status(500).json({
            error: "Unable to complete login",
        });
    }
});

authRouter.get("/me", requireAuth, (req, res) => {
    return res.json({
        user: req.auth!.user,
    });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
    try {
        await prisma.session.delete({
            where: { id: req.auth!.sessionId },
        });

        return res.status(204).send();
    } catch (error) {
        console.error("Logout failed:", error);

        return res.status(500).json({
            error: "Unable to complete logout",
        });
    }
});

export default authRouter;