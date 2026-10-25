import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM;

if (!host || !user || !pass || !from) {
    throw new Error("Missing required SMTP configuration in backend/.env");
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid port number");
}

const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
});

export async function sendVerificationOtp(
    recipient: string,
    otp: string,
): Promise<void> {
    await transporter.sendMail({
        from,
        to: recipient,
        subject: "Verify your Community Engagement Hub account",
        text: [
            `Your verification code is: ${otp}`,
            "",
            "This code expires in 10 minutes.",
            "If you did not request this code, you can ignore this email.",
        ].join("\n"),
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
                <h2>Verify your email address</h2>
                <p>Enter this code to verify your Community Engagement Hub account:</p>
                <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">
                    ${otp}
                </p>
                <p>This code expires in 10 minutes.</p>
                <p>If you did not request this code, you can ignore this email.</p>
            </div>
        `,
    });
}

export async function verifySmtpConnection(): Promise<void> {
    await transporter.verify();
}

export async function sendPasswordResetEmail(
    recipient: string,
    token: string,
): Promise<void> {
    const resetUrl = new URL(
        "/reset-password",
        process.env.FRONTEND_URL || "http://localhost:5173",
    );

    resetUrl.searchParams.set("email", recipient);
    resetUrl.searchParams.set("token", token);

    await transporter.sendMail({
        from,
        to: recipient,
        subject: "Reset your Community Engagement Hub password",
        text: [
            "We received a request to reset your password.",
            "",
            `Use this link to reset it: ${resetUrl.toString()}`,
            "",
            "This link expires in 30 minutes and can only be used once.",
            "If you did not request a password reset, ignore this email.",
        ].join("\n"),
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
                <h2>Reset your password</h2>
                <p>We received a request to reset your Community Engagement Hub password.</p>
                <p>
                    <a href="${resetUrl.toString()}"
                       style="display:inline-block;padding:12px 18px;background:#7900d9;color:#fff;text-decoration:none;border-radius:8px;">
                        Reset password
                    </a>
                </p>
                <p>This link expires in 30 minutes and can only be used once.</p>
                <p>If you did not request this, you can ignore this email.</p>
            </div>
        `,
    });
}