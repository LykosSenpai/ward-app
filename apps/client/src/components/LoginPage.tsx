import { useState } from "react";
import type { AuthUser } from "../clientTypes";
import { API_BASE_URL } from "../config";

type LoginPageProps = {
  onAuthenticated: (user: AuthUser) => void;
};

type AuthMode = "login" | "register";

const SHOWCASE_CARDS = [
  "/card-images/gen1_001_blue_dragon.png",
  "/card-images/gen1_018_wizard.png",
  "/card-images/gen1_032_council_of_the_cosmos.png"
];

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

  function continueWithDiscord() {
    window.location.href = `${API_BASE_URL}/api/auth/discord/start`;
  }

  return (
    <main className="login-page">
      <section className="login-entry">
        <section className="login-showcase" aria-label="Ward Nexus card artwork">
          <div className="login-showcase-copy">
            <span>Ward Nexus</span>
            <h1>Online Battler</h1>
            <p>Build decks, manage your collection, and play rules-assisted matches online.</p>
          </div>

          <div className="login-card-stack" aria-hidden="true">
            {SHOWCASE_CARDS.map((src, index) => (
              <img
                alt=""
                className={`login-card-image card-${index + 1}`}
                key={src}
                src={src}
              />
            ))}
          </div>
        </section>

        <section className="login-panel">
          <div className="login-title">
            <span>Ward Nexus</span>
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

            <button disabled={busy} type="submit">
              {busy ? "Working..." : mode === "login" ? "Login" : "Create Account"}
            </button>
          </form>

          <button className="login-mode-toggle" type="button" onClick={continueWithDiscord}>
            Continue with Discord
          </button>

          <button
            className="login-mode-toggle"
            type="button"
            onClick={() => {
              setMode(current => current === "login" ? "register" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Need an account?" : "Already have an account?"}
          </button>

          <p className="login-disclaimer">
            Ward Nexus is an unofficial fan-made tool and online battler for WARD TCG. It is not affiliated with, endorsed by, or sponsored by the WARD creators or rights holders. All card names, artwork, rules text, and related game materials remain the property of their respective owners.
          </p>
        </section>
      </section>
    </main>
  );
}
