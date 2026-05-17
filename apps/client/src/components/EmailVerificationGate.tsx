import { useState } from "react";
import { hasCompletedEmailVerification } from "../authVerification";
import type { AuthUser } from "../clientTypes";
import { API_BASE_URL } from "../config";

type EmailVerificationGateProps = {
  user: AuthUser;
  onVerified: (user: AuthUser) => void;
  onLogout: () => void;
};

type AuthMeResponse = {
  user?: AuthUser | null;
  message?: string;
};

export function EmailVerificationGate({ onLogout, onVerified, user }: EmailVerificationGateProps) {
  const [busyAction, setBusyAction] = useState<"check" | "resend" | null>(null);
  const [message, setMessage] = useState("We sent a verification link. Open it, then come back here.");
  const [error, setError] = useState("");
  const emailLabel = user.email?.trim() || "your account email";

  async function resendVerification() {
    setBusyAction("resend");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/email-verification/send`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json().catch(() => ({})) as AuthMeResponse;

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to send verification email.");
      }

      setMessage("Verification email sent. Check your inbox, then come back here.");
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : "Unable to send verification email.");
    } finally {
      setBusyAction(null);
    }
  }

  async function checkVerification() {
    setBusyAction("check");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        credentials: "include"
      });
      const data = await response.json().catch(() => ({})) as AuthMeResponse;

      if (!response.ok || !data.user) {
        throw new Error(data.message ?? "Your login session expired. Log in again to continue.");
      }

      if (hasCompletedEmailVerification(data.user)) {
        onVerified(data.user);
        return;
      }

      setMessage("Still waiting on email verification. Open the link from your inbox, then check again.");
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Unable to check verification status.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="login-page email-verification-page">
      <section className="login-panel email-verification-panel">
        <div className="login-title">
          <span>Ward Nexus</span>
          <h1>Verify your email</h1>
        </div>

        <p className="email-verification-copy">
          A verification link was sent to <strong>{emailLabel}</strong>. Email verification needs to finish before the app opens.
        </p>

        {error && <p className="login-error">{error}</p>}
        {message && <p className="login-success">{message}</p>}

        <div className="email-verification-actions">
          <button disabled={busyAction !== null} onClick={() => void checkVerification()}>
            {busyAction === "check" ? "Checking..." : "I Verified, Continue"}
          </button>
          <button
            className="login-mode-toggle"
            disabled={busyAction !== null}
            onClick={() => void resendVerification()}
          >
            {busyAction === "resend" ? "Sending..." : "Resend Verification Email"}
          </button>
        </div>

        <button className="email-verification-logout" disabled={busyAction !== null} onClick={onLogout}>
          Log Out
        </button>
      </section>
    </main>
  );
}
