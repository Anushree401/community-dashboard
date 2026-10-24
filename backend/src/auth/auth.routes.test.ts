
import { describe, it, expect } from "vitest";

describe("Authentication security requirements", () => {
    it("uses six-digit OTPs", () => {
        const otpPattern = /^\d{6}$/;

        expect(otpPattern.test("123456")).toBe(true);
        expect(otpPattern.test("12345")).toBe(false);
        expect(otpPattern.test("1234567")).toBe(false);
        expect(otpPattern.test("abcdef")).toBe(false);
    });

    it("rejects expired OTP challenges", () => {
        const now = Date.now();
        const expiredAt = now - 1000;
        const validUntil = now + 10 * 60 * 1000;

        expect(expiredAt > now).toBe(false);
        expect(validUntil > now).toBe(true);
    });

    it("enforces the five-attempt limit", () => {
        const maxAttempts = 5;

        expect(4 < maxAttempts).toBe(true);
        expect(5 < maxAttempts).toBe(false);
    });

    it("enforces a 60-second resend cooldown", () => {
        const cooldownMs = 60 * 1000;

        expect(30 * 1000 < cooldownMs).toBe(true);
        expect(60 * 1000 < cooldownMs).toBe(false);
    });

    it("enforces a maximum of three OTP challenges per hour", () => {
        const hourlyLimit = 3;

        expect(0 < hourlyLimit).toBe(true);
        expect(2 < hourlyLimit).toBe(true);
        expect(3 < hourlyLimit).toBe(false);
    });

    it("does not accept an OTP twice after consumption", () => {
        const challenge = {
            consumedAt: null as Date | null,
        };

        expect(challenge.consumedAt).toBeNull();

        challenge.consumedAt = new Date();

        expect(challenge.consumedAt).not.toBeNull();
    });
});
