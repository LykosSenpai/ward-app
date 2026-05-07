import { useState } from "react";
import type { AuthUser } from "../clientTypes";

type LoginPageProps = {
  onAuthenticated: (user: AuthUser) => void;
};

type AuthMode = "login" | "register";

const API_BASE_URL = "http://localhost:3001";

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login,
          username,
          email,
          password,
          displayName
        })
      });

      const data = await response.json() as { user?: AuthUser; message?: string };

      if (!response.ok || !data.user) {
        throw new Error(data.message ?? "Authentication failed.");
      }

      onAuthenticated(data.user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-title">
          <span>WARD</span>
          <h1>{mode === "login" ? "Login" : "Create Account"}</h1>
        </div>

        <form className="login-form" onSubmit={submitAuth}>
          <label>
            {mode === "login" ? "Username or Email" : "Username"}
            <input
              value={mode === "login" ? login : username}
              onChange={event => {
                if (mode === "login") {
                  setLogin(event.target.value);
                } else {
                  setUsername(event.target.value);
                }
              }}
              autoComplete="username"
              placeholder={mode === "login" ? "player_name or player@email.com" : "player_name"}
            />
          </label>

          {mode === "register" && (
            <>
              <label>
                Email
                <input
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="player@email.com"
                  type="email"
                />
              </label>

              <label>
                Display Name
                <input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  autoComplete="nickname"
                  placeholder="Player Name"
                />
              </label>
            </>
          )}

          <label>
            Password
            <input
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              type="password"
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button disabled={busy}>
            {busy ? "Working..." : mode === "login" ? "Login" : "Create Account"}
          </button>
        </form>

        <button
          className="login-mode-toggle"
          onClick={() => {
            setMode(current => current === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Need an account?" : "Already have an account?"}
        </button>
      </section>
    </main>
  );
}
