import { useEffect, useState } from "react";
import type { AuthUser, UserProfile } from "../clientTypes";
import { API_BASE_URL } from "../config";

type ProfilePageProps = {
  onUserUpdated: (user: AuthUser) => void;
};

export function ProfilePage({ onUserUpdated }: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadProfile();
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
      setDisplayName(data.profile.displayName);
      setEmail(data.profile.email);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : "Unable to load profile.");
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          email
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

  return (
    <section className="profile-page">
      <header className="profile-header">
        <div>
          <h2>Profile</h2>
          <p>Manage your WARD account details.</p>
        </div>
        <button onClick={() => void loadProfile()}>Refresh</button>
      </header>

      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}

      <div className="profile-grid">
        <section className="profile-card">
          <h3>Account</h3>
          <div className="profile-readonly-grid">
            <span>Username</span>
            <strong>{profile?.username ?? "Loading..."}</strong>
            <span>User ID</span>
            <strong>{profile?.id ?? "Loading..."}</strong>
          </div>

          <form className="profile-form" onSubmit={saveProfile}>
            <label>
              Display Name
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} />
            </label>

            <label>
              Email
              <input value={email} onChange={event => setEmail(event.target.value)} type="email" />
            </label>

            <button disabled={busy}>{busy ? "Saving..." : "Save Profile"}</button>
          </form>
        </section>

        <section className="profile-card">
          <h3>Collection</h3>
          <div className="profile-stat-grid">
            <div>
              <span>Unique Owned</span>
              <strong>{profile?.ownedUniqueCards ?? 0}</strong>
            </div>
            <div>
              <span>Total Copies</span>
              <strong>{profile?.ownedTotalCopies ?? 0}</strong>
            </div>
          </div>
        </section>

        <section className="profile-card">
          <h3>Password</h3>
          <form className="profile-form" onSubmit={changePassword}>
            <label>
              Current Password
              <input
                value={currentPassword}
                onChange={event => setCurrentPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>

            <label>
              New Password
              <input
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>

            <label>
              Confirm New Password
              <input
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
              />
            </label>

            <button disabled={busy}>{busy ? "Saving..." : "Change Password"}</button>
          </form>
        </section>
      </div>
    </section>
  );
}
