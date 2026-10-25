import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import type { AuthMode, AuthUser } from "../../types/auth";

type Props = {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  onAuthenticated: (user: AuthUser) => void;
};

export default function AuthPage({
  mode,
  setMode,
  onAuthenticated,
}: Props) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const emailFromUrl = params.get("email");

    if (
      window.location.pathname === "/reset-password" &&
      token &&
      emailFromUrl
    ) {
      setEmail(emailFromUrl);
      setResetToken(token);
      setMode("reset");
    }
  }, [setMode]);

  const isRegister = mode === "register";
  const isVerify = mode === "verify";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  const passwordChecks = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "One uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "One lowercase letter", valid: /[a-z]/.test(password) },
    { label: "One number", valid: /[0-9]/.test(password) },
    {
      label: "One special character",
      valid: /[^A-Za-z0-9]/.test(password),
    },
  ];

  const passwordStrong = passwordChecks.every((check) => check.valid);

  function changeMode(next: AuthMode) {
    setError("");
    setNotice("");
    setMode(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      if (isRegister) {
        if (!passwordStrong) {
          throw new Error("Please meet every password requirement.");
        }

        const result = await apiRequest<{ message?: string }>(
          "/api/auth/register",
          {
            method: "POST",
            body: JSON.stringify({
              displayName: displayName.trim(),
              email: email.trim(),
              password,
            }),
          },
        );

        setNotice(
          result.message || "Check your email for the verification code.",
        );
        setMode("verify");
      } else if (isVerify) {
        const result = await apiRequest<{ message?: string }>(
          "/api/auth/verify-email",
          {
            method: "POST",
            body: JSON.stringify({
              email: email.trim(),
              otp: otp.trim(),
            }),
          },
        );

        setNotice(result.message || "Email verified. You can now sign in.");
        setPassword("");
        setOtp("");
        setMode("login");
      } else if (isForgot) {
        const result = await apiRequest<{ message?: string }>(
          "/api/auth/forgot-password",
          {
            method: "POST",
            body: JSON.stringify({ email: email.trim() }),
          },
        );

        setNotice(
          result.message ||
            "If an eligible account exists, password reset instructions will be sent.",
        );
      } else if (isReset) {
        if (!passwordStrong) {
          throw new Error("Please meet every password requirement.");
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const result = await apiRequest<{ message?: string }>(
          "/api/auth/reset-password",
          {
            method: "POST",
            body: JSON.stringify({
              email: email.trim(),
              token: resetToken.trim(),
              password,
            }),
          },
        );

        setPassword("");
        setConfirmPassword("");
        setResetToken("");
        setNotice(result.message || "Password reset successfully. Please sign in.");
        window.history.replaceState({}, "", "/");
        setMode("login");
      } else {
        const result = await apiRequest<{
          user: AuthUser;
          token: string;
        }>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            password,
          }),
        });

        sessionStorage.setItem("ceh_session_token", result.token);
        onAuthenticated(result.user);
      }
    } catch (cause) {
      const authError = cause as Error & { code?: string };
      setError(authError.message || "Something went wrong.");

      if (mode === "login" && authError.code === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const result = await apiRequest<{ message?: string }>(
        "/api/auth/resend-otp",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim() }),
        },
      );

      setNotice(
        result.message || "If eligible, a new verification code will be sent.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not request a new code.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">
            <span /><span /><span /><span />
          </div>
          <div>
            <div className="brand-name">gather<span>.</span></div>
            <div className="brand-caption">COMMUNITY HUB</div>
          </div>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">COMMUNITY ENGINE</span>
          <h1>
            {isRegister
              ? "Create your account"
              : isVerify
                ? "Verify your email"
                : isForgot
                  ? "Forgot password?"
                  : isReset
                    ? "Choose a new password"
                    : "Welcome back"}
          </h1>
          <p>
            {isRegister
              ? "Create an account to join your communities."
              : isVerify
                ? "Enter the six-digit code sent to your email."
                : isForgot
                  ? "Enter your email address to receive password reset instructions."
                  : isReset
                    ? "Enter your reset token and choose a new password."
                    : "Sign in to continue to your community workspace."}
          </p>
        </div>

        {error && (
          <div className="auth-message auth-error" role="alert">
            {error}
          </div>
        )}

        {notice && (
          <div className="auth-message auth-notice" role="status">
            {notice}
          </div>
        )}

        <form className="auth-form" onSubmit={submit}>
          {isRegister && (
            <label>
              Display name
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
              />
            </label>
          )}

          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={320}
              required
            />
          </label>

          {!isVerify && !isForgot && (
            <label>
              {isReset ? "New password" : "Password"}
              <input
                type="password"
                autoComplete={
                  isRegister || isReset ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={isRegister || isReset ? 12 : 1}
                maxLength={128}
                required
              />
              {(isRegister || isReset) && (
                <small>Meet all the requirements below.</small>
              )}
            </label>
          )}

          {(isRegister || isReset) && (
            <div className="password-checklist" aria-live="polite">
              {passwordChecks.map((check) => (
                <div
                  className={`password-check ${check.valid ? "valid" : ""}`}
                  key={check.label}
                >
                  <span className="password-check-icon">
                    {check.valid ? "✓" : "○"}
                  </span>
                  <span>{check.label}</span>
                </div>
              ))}
            </div>
          )}

          {isReset && (
            <>
              <label>
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  maxLength={128}
                  required
                />
              </label>
              {!resetToken && (
                <label>
                  Password reset token
                  <input
                    value={resetToken}
                    onChange={(event) => setResetToken(event.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </label>
              )}
            </>
          )}

          {isVerify && (
            <label>
              Verification code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                placeholder="000000"
                required
              />
            </label>
          )}

          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={
              busy ||
              ((isRegister || isReset) && !passwordStrong) ||
              (isReset &&
                (password !== confirmPassword || !resetToken.trim()))
            }
          >
            {busy
              ? "Please wait…"
              : isRegister
                ? "Create account"
                : isVerify
                  ? "Verify email"
                  : isForgot
                    ? "Send reset instructions"
                    : isReset
                      ? "Reset password"
                      : "Sign in"}
          </button>
        </form>

        {isVerify && (
          <button
            className="auth-text-button"
            type="button"
            onClick={() => void resendCode()}
            disabled={busy}
          >
            Resend verification code
          </button>
        )}

        {!isRegister && !isVerify && !isForgot && !isReset && (
          <button
            className="auth-text-button forgot-link"
            type="button"
            onClick={() => changeMode("forgot")}
          >
            Forgot password?
          </button>
        )}

        <div className="auth-switch">
          {isRegister ? (
            <>
              Already registered?{" "}
              <button type="button" onClick={() => changeMode("login")}>
                Sign in
              </button>
            </>
          ) : isVerify ? (
            <>
              Already verified?{" "}
              <button type="button" onClick={() => changeMode("login")}>
                Back to sign in
              </button>
            </>
          ) : isForgot || isReset ? (
            <>
              Remembered your password?{" "}
              <button type="button" onClick={() => changeMode("login")}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New to the community?{" "}
              <button type="button" onClick={() => changeMode("register")}>
                Create an account
              </button>
            </>
          )}
        </div>

        <p className="auth-footnote">
          Your session is kept for this browser tab and checked with the backend
          when the app loads.
        </p>
      </section>
    </main>
  );
}
