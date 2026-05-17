import { useEffect, useState } from "react";
import { hasCompletedEmailVerification } from "../authVerification";
import type { AuthUser, UserProfile } from "../clientTypes";
import { API_BASE_URL } from "../config";
import { PasswordInput } from "./ui/PasswordInput";

type ProfilePageProps = {
  onUserUpdated: (user: AuthUser) => void;
  discordAuthEnabled: boolean;
};

type TwoFactorSetup = {
  secret: string;
  qrCodeDataUrl: string;
};

export function ProfilePage({ discordAuthEnabled, onUserUpdated }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [disableTwoFactorPassword, setDisableTwoFactorPassword] = useState("");
  const [disableTwoFactorCode, setDisableTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadProfile();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordStatus = params.get("discord");
    if (!discordStatus) return;

    if (discordStatus === "linked") {
      setMessage("Discord connected.");
    } else if (discordStatus === "signed-in") {
      setMessage("Signed in with Discord.");
    } else if (discordStatus === "error") {
      setError(params.get("message") ?? "Discord connection failed.");
    }

    params.delete("discord");
    params.delete("message");
    const nextSearch = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`);
  }, []);

  async function loadProfile() {
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile`, {
        credentials: "include"
      });
      const data = await response.json() as { profile?: UserProfile; message?: string };

      if (!response.ok || !data.profile) {
        throw new Error(data.message ?? "Unable to load profile.");
      }

      setProfile(data.profile);
      onUserUpdated(data.profile);
      setDisplayName(data.profile.displayName);
      setEmail(data.profile.email);
      setDevToolsEnabled(data.profile.devToolsEnabled);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Unable to load profile.");
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveProfileChanges();
  }

  async function saveProfileChanges() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          displayName,
          email,
          devToolsEnabled
        })
      });
      const data = await response.json() as { profile?: UserProfile; user?: AuthUser; message?: string };

      if (!response.ok || !data.profile || !data.user) {
        throw new Error(data.message ?? "Unable to save profile.");
      }

      setProfile(data.profile);
      onUserUpdated(data.user);
      setMessage("Profile saved.");
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Unable to save profile.");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      setBusy(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/change-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });
      const data = await response.json() as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to change password.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password changed.");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Unable to change password.");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailVerification() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/email-verification/send`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json() as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to send verification email.");
      }

      setMessage("Verification email sent.");
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : "Unable to send verification email.");
    } finally {
      setBusy(false);
    }
  }

  async function startTwoFactorSetup() {
    setBusy(true);
    setError("");
    setMessage("");
    setRecoveryCodes([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/security/2fa/setup`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json() as { setup?: TwoFactorSetup; message?: string };

      if (!response.ok || !data.setup) {
        throw new Error(data.message ?? "Unable to start 2FA setup.");
      }

      setTwoFactorSetup(data.setup);
      setTwoFactorCode("");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to start 2FA setup.");
    } finally {
      setBusy(false);
    }
  }

  async function enableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/security/2fa/enable`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ code: twoFactorCode })
      });
      const data = await response.json() as { profile?: UserProfile; user?: AuthUser; recoveryCodes?: string[]; message?: string };

      if (!response.ok || !data.profile || !data.user) {
        throw new Error(data.message ?? "Unable to enable 2FA.");
      }

      setProfile(data.profile);
      onUserUpdated(data.user);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      setRecoveryCodes(data.recoveryCodes ?? []);
      setMessage("Two-factor authentication enabled.");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to enable 2FA.");
    } finally {
      setBusy(false);
    }
  }

  async function disableTwoFactor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/security/2fa/disable`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword: disableTwoFactorPassword,
          code: disableTwoFactorCode
        })
      });
      const data = await response.json() as { profile?: UserProfile; user?: AuthUser; message?: string };

      if (!response.ok || !data.profile || !data.user) {
        throw new Error(data.message ?? "Unable to disable 2FA.");
      }

      setProfile(data.profile);
      onUserUpdated(data.user);
      setDisableTwoFactorPassword("");
      setDisableTwoFactorCode("");
      setRecoveryCodes([]);
      setMessage("Two-factor authentication disabled.");
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Unable to disable 2FA.");
    } finally {
      setBusy(false);
    }
  }

  async function connectDiscord() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        credentials: "include"
      });
      const data = await response.json() as { user?: AuthUser | null };

      if (!response.ok || !data.user) {
        throw new Error("Your login session is missing. Log in again, then connect Discord from your profile.");
      }

      window.location.href = `${API_BASE_URL}/api/auth/discord/link`;
    } catch (discordError) {
      setError(discordError instanceof Error ? discordError.message : "Unable to start Discord connection.");
      setBusy(false);
    }
  }

  async function unlinkDiscord() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/profile/discord/unlink`, {
        method: "POST",
        credentials: "include"
      });
      const data = await response.json() as { profile?: UserProfile; user?: AuthUser; message?: string };

      if (!response.ok || !data.profile || !data.user) {
        throw new Error(data.message ?? "Unable to unlink Discord.");
      }

      setProfile(data.profile);
      onUserUpdated(data.user);
      setMessage("Discord disconnected.");
    } catch (discordError) {
      setError(discordError instanceof Error ? discordError.message : "Unable to unlink Discord.");
    } finally {
      setBusy(false);
    }
  }

  const hasVerifiedEmail = hasCompletedEmailVerification(profile);
  const emailStatus = hasVerifiedEmail ? "Verified" : "Not verified";
  const twoFactorStatus = profile?.twoFactorEnabled ? "Enabled" : "Off";
  const discordStatus = profile?.discord ? "Connected" : discordAuthEnabled ? "Not connected" : "Disabled";
  const collectionStatus = `${profile?.ownedUniqueCards ?? 0} unique / ${profile?.ownedTotalCopies ?? 0} total`;

  return (
    <section className="profile-page">
      <header className="profile-header">
        <div>
          <h2>Profile</h2>
          <p>Manage your Ward Nexus account details.</p>
        </div>
        <button onClick={() => void loadProfile()}>Refresh</button>
      </header>

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="profile-summary-grid" aria-label="Profile summary">
        <div className="profile-summary-chip">
          <span>Account</span>
          <strong>{profile?.username ?? "Loading..."}</strong>
        </div>
        <div className={hasVerifiedEmail ? "profile-summary-chip is-good" : "profile-summary-chip is-warning"}>
          <span>Email</span>
          <strong>{emailStatus}</strong>
        </div>
        <div className={profile?.twoFactorEnabled ? "profile-summary-chip is-good" : "profile-summary-chip"}>
          <span>2FA</span>
          <strong>{twoFactorStatus}</strong>
        </div>
        <div className={profile?.discord ? "profile-summary-chip is-good" : "profile-summary-chip"}>
          <span>Discord</span>
          <strong>{discordStatus}</strong>
        </div>
        <div className="profile-summary-chip">
          <span>Collection</span>
          <strong>{collectionStatus}</strong>
        </div>
      </div>

      <div className="profile-grid">
        <div className="profile-main-stack">
          <section className="profile-card profile-card-account">
            <div className="profile-card-header">
              <h3>Account</h3>
              <span className={hasVerifiedEmail ? "profile-status-pill is-good" : "profile-status-pill is-warning"}>
                {emailStatus}
              </span>
            </div>

            <div className="profile-readonly-grid">
              <span>Username</span>
              <strong>{profile?.username ?? "Loading..."}</strong>
              <span>User ID</span>
              <strong>{profile?.id ?? "Loading..."}</strong>
            </div>

            <form className="profile-form profile-form-inline" onSubmit={saveProfile}>
              <label>
                Display Name
                <input value={displayName} onChange={event => setDisplayName(event.target.value)} />
              </label>

              <label>
                Email
                <input value={email} onChange={event => setEmail(event.target.value)} type="email" />
              </label>

              <div className="profile-action-row profile-action-row-stretch">
                <button disabled={busy}>{busy ? "Saving..." : "Save Profile"}</button>
                {!hasVerifiedEmail && (
                  <button type="button" onClick={() => void sendEmailVerification()} disabled={busy || !profile}>
                    {busy ? "Sending..." : "Send Verification Email"}
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="profile-card profile-card-security">
            <div className="profile-card-header">
              <h3>Security</h3>
              <span className={profile?.twoFactorEnabled ? "profile-status-pill is-good" : "profile-status-pill"}>
                2FA {twoFactorStatus}
              </span>
            </div>
            <div className="profile-readonly-grid">
              <span>2FA</span>
              <strong>{twoFactorStatus}</strong>
              <span>Device Check</span>
              <strong>Email code on new browser</strong>
            </div>

            {!profile?.twoFactorEnabled ? (
              <>
                {!twoFactorSetup ? (
                  <button type="button" onClick={() => void startTwoFactorSetup()} disabled={busy || !profile}>
                    {busy ? "Starting..." : "Set Up Authenticator"}
                  </button>
                ) : (
                  <form className="profile-form" onSubmit={enableTwoFactor}>
                    <div className="profile-two-factor-setup">
                      <div className="profile-two-factor-qr-frame">
                        <img
                          src={twoFactorSetup.qrCodeDataUrl}
                          alt="Authenticator app setup QR code"
                          className="profile-two-factor-qr"
                        />
                      </div>
                      <span>Scan with your authenticator app, then enter the six-digit code.</span>
                    </div>

                    <label>
                      Setup Key
                      <input value={twoFactorSetup.secret} readOnly spellCheck={false} />
                    </label>

                    <label>
                      Authenticator Code
                      <input
                        value={twoFactorCode}
                        onChange={event => setTwoFactorCode(event.target.value)}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                      />
                    </label>

                    <button disabled={busy}>{busy ? "Checking..." : "Enable 2FA"}</button>
                  </form>
                )}
              </>
            ) : (
              <form className="profile-form profile-form-inline" onSubmit={disableTwoFactor}>
                <label>
                  Current Password
                  <PasswordInput
                    value={disableTwoFactorPassword}
                    onChange={setDisableTwoFactorPassword}
                    autoComplete="current-password"
                  />
                </label>

                <label>
                  Authenticator or Recovery Code
                  <input
                    value={disableTwoFactorCode}
                    onChange={event => setDisableTwoFactorCode(event.target.value)}
                    autoComplete="one-time-code"
                  />
                </label>

                <button disabled={busy}>{busy ? "Saving..." : "Disable 2FA"}</button>
              </form>
            )}

            {recoveryCodes.length > 0 && (
              <div className="profile-recovery-code-box">
                {recoveryCodes.map(code => <code key={code}>{code}</code>)}
              </div>
            )}
          </section>
        </div>

        <aside className="profile-side-stack">
          <section className="profile-card profile-card-discord">
            <div className="profile-card-header">
              <h3>Discord</h3>
              <span className={profile?.discord ? "profile-status-pill is-good" : "profile-status-pill"}>
                {discordStatus}
              </span>
            </div>
            {profile?.discord ? (
              <>
                <div className="profile-readonly-grid">
                  <span>Status</span>
                  <strong>Verified</strong>
                  <span>Discord</span>
                  <strong>{profile.discord.globalName || profile.discord.username}</strong>
                  <span>User ID</span>
                  <strong>{profile.discord.userId}</strong>
                </div>
                <div className="profile-action-row">
                  <a href={`https://discord.com/users/${profile.discord.userId}`} target="_blank" rel="noreferrer">Open Discord Profile</a>
                  <button type="button" onClick={() => void unlinkDiscord()} disabled={busy}>
                    {busy ? "Working..." : "Disconnect Discord"}
                  </button>
                </div>
              </>
            ) : discordAuthEnabled ? (
              <>
                <p className="muted">Connect Discord to post in the marketplace and show verified contact info.</p>
                <button type="button" onClick={() => void connectDiscord()} disabled={busy}>
                  Connect Discord
                </button>
              </>
            ) : (
              <p className="muted">Discord login and linking are temporarily disabled.</p>
            )}
          </section>

          <section className="profile-card profile-card-password">
            <h3>Password</h3>
            <form className="profile-form" onSubmit={changePassword}>
              <label>
                Current Password
                <PasswordInput
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  autoComplete="current-password"
                />
              </label>

              <label>
                New Password
                <PasswordInput
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                />
              </label>

              <label>
                Confirm New Password
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  autoComplete="new-password"
                />
              </label>

              <button disabled={busy}>{busy ? "Saving..." : "Change Password"}</button>
            </form>
          </section>

          {profile?.canAccessDevTools && (
            <section className="profile-card profile-card-developer">
              <div className="profile-card-header">
                <h3>Developer Access</h3>
                <span className="profile-status-pill">{profile.role}</span>
              </div>
              <label className="profile-toggle-row">
                <input
                  checked={devToolsEnabled}
                  onChange={event => setDevToolsEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span>Show developer tools</span>
              </label>

              <button type="button" onClick={() => void saveProfileChanges()} disabled={busy}>
                {busy ? "Saving..." : "Save Developer Tools"}
              </button>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
