import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { API_BASE_URL } from "../config";
import { useTargetedCardImageCandidates } from "./CardImagePreview";
import { HolographicCardImage } from "./HolographicCardImage";
import { PasswordInput } from "./ui/PasswordInput";

type LoginPageProps = {
  onAuthenticated: (user: AuthUser) => void;
  discordAuthEnabled: boolean;
  serverRestartNotice?: string;
  onDismissServerRestartNotice?: () => void;
};

type AuthMode = "login" | "register" | "forgot" | "reset";

type LoginChallenge = {
  challengeId: string;
  type: "TOTP" | "NEW_DEVICE_EMAIL";
  destination?: string;
};

type AuthResponse = {
  user?: AuthUser;
  challenge?: LoginChallenge;
  message?: string;
};

type CardLibraryResponse = {
  cards?: CardLibraryCardSummary[];
};

type LoginArtVariant = "default" | "holo";

type LoginShowcaseSelection = {
  artVariant: LoginArtVariant;
  card: CardLibraryCardSummary;
};

const FALLBACK_SHOWCASE_CARDS: CardLibraryCardSummary[] = [
  {
    id: "gen1_001_blue_dragon",
    name: "Blue Dragon",
    packId: "ward-gen1",
    cardType: "CREATURE",
    generation: "1",
    cardNumber: "001",
    deckLimit: 3
  },
  {
    id: "gen1_018_wizard",
    name: "Wizard",
    packId: "ward-gen1",
    cardType: "CREATURE",
    generation: "1",
    cardNumber: "018",
    deckLimit: 3
  },
  {
    id: "gen1_032_council_of_the_cosmos",
    name: "Council of the Cosmos",
    packId: "ward-gen1",
    cardType: "MAGIC",
    generation: "1",
    cardNumber: "032",
    deckLimit: 3
  },
  {
    id: "gen1_003_frost_giant",
    name: "Frost Giant",
    packId: "ward-gen1",
    cardType: "CREATURE",
    generation: "1",
    cardNumber: "003",
    deckLimit: 3
  },
  {
    id: "gen1_010_red_dragon",
    name: "Red Dragon",
    packId: "ward-gen1",
    cardType: "CREATURE",
    generation: "1",
    cardNumber: "010",
    deckLimit: 3
  },
  {
    id: "gen1_020_eternal_dragon",
    name: "Eternal Dragon",
    packId: "ward-gen1",
    cardType: "CREATURE",
    generation: "1",
    cardNumber: "020",
    deckLimit: 3
  }
];

export function LoginPage({
  discordAuthEnabled,
  onAuthenticated,
  onDismissServerRestartNotice,
  serverRestartNotice
}: LoginPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmAccountPassword, setConfirmAccountPassword] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [authChallenge, setAuthChallenge] = useState<LoginChallenge | null>(null);
  const [challengeCode, setChallengeCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cardLibrary, setCardLibrary] = useState<CardLibraryCardSummary[]>(FALLBACK_SHOWCASE_CARDS);

  useEffect(() => {
    let alive = true;

    async function loadCardLibrary() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/cards/showcase`, {
          credentials: "omit"
        });

        if (!response.ok) {
          throw new Error("Unable to load card library.");
        }

        const data = await response.json() as CardLibraryResponse;
        const cards = Array.isArray(data.cards) ? data.cards.filter(isDisplayableCard) : [];

        if (alive && cards.length >= 4) {
          setCardLibrary(cards);
        }
      } catch {
        if (alive) {
          setCardLibrary(FALLBACK_SHOWCASE_CARDS);
        }
      }
    }

    void loadCardLibrary();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetTokenParam = params.get("resetToken");
    const verifyEmailToken = params.get("verifyEmailToken");
    const loginChallengeId = params.get("loginChallengeId");
    const loginChallengeType = params.get("loginChallengeType");
    const loginChallengeDestination = params.get("loginChallengeDestination") ?? undefined;

    if (resetTokenParam) {
      setResetToken(resetTokenParam);
      setMode("reset");
      params.delete("resetToken");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }

    if (
      loginChallengeId &&
      (loginChallengeType === "TOTP" || loginChallengeType === "NEW_DEVICE_EMAIL")
    ) {
      setAuthChallenge({
        challengeId: loginChallengeId,
        type: loginChallengeType,
        destination: loginChallengeDestination
      });
      params.delete("loginChallengeId");
      params.delete("loginChallengeType");
      params.delete("loginChallengeDestination");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }

    if (verifyEmailToken) {
      params.delete("verifyEmailToken");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
      void verifyEmailTokenFromLink(verifyEmailToken);
    }
  }, []);

  const showcaseSelections = useMemo(
    () => buildLoginShowcaseSelections(cardLibrary),
    [cardLibrary]
  );
  const fallbackSelections = useMemo(() => buildLoginShowcaseSelections(FALLBACK_SHOWCASE_CARDS), []);
  const backgroundSelections = (showcaseSelections.length >= 6 ? showcaseSelections : fallbackSelections).slice(0, 3);
  const displaySelections = (showcaseSelections.length >= 6 ? showcaseSelections : fallbackSelections).slice(3, 6);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (mode === "register" && password !== confirmAccountPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);

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

      const data = await readAuthResponse(response);

      if (response.status === 202 && data.challenge) {
        setAuthChallenge(data.challenge);
        setChallengeCode("");
        return;
      }

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

  async function submitLoginChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authChallenge) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login/challenge`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeId: authChallenge.challengeId,
          code: challengeCode
        })
      });
      const data = await readAuthResponse(response);

      if (response.status === 202 && data.challenge) {
        setAuthChallenge(data.challenge);
        setChallengeCode("");
        return;
      }

      if (!response.ok || !data.user) {
        throw new Error(data.message ?? "Unable to verify login.");
      }

      setAuthChallenge(null);
      onAuthenticated(data.user);
    } catch (challengeError) {
      setError(challengeError instanceof Error ? challengeError.message : "Unable to verify login.");
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/password-reset/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const data = await readAuthResponse(response);

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to send reset email.");
      }

      setMessage(data.message ?? "If that email belongs to an account, a reset link has been sent.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to send reset email.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    if (resetPassword !== resetConfirmPassword) {
      setBusy(false);
      setError("New passwords do not match.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/password-reset/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: resetToken,
          password: resetPassword
        })
      });
      const data = await readAuthResponse(response);

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to reset password.");
      }

      setResetToken("");
      setResetPassword("");
      setResetConfirmPassword("");
      setMode("login");
      setMessage("Password reset. You can log in now.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Unable to reset password.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailTokenFromLink(token: string) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/email/verify`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ token })
      });
      const data = await readAuthResponse(response);

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to verify email.");
      }

      if (data.user) {
        onAuthenticated(data.user);
        return;
      }

      setMessage("Email verified. You can log in now.");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to verify email.");
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
          <div className="login-background-card-field" aria-hidden="true">
            {backgroundSelections.map((selection, index) => (
              <LoginShowcaseCard
                className={`login-background-card background-${index + 1}`}
                key={`${selection.card.id}:${selection.artVariant}:background:${index}`}
                selection={selection}
              />
            ))}
          </div>

          <div className="login-showcase-copy">
            <span>Ward Nexus</span>
            <h1>Online Battler</h1>
            <p>Build decks, manage your collection, and play rules-assisted matches online.</p>
          </div>

          <div className="login-card-stack" aria-hidden="true">
            {displaySelections.map((selection, index) => (
              <LoginShowcaseCard
                className={`login-card-image card-${index + 1}`}
                key={`${selection.card.id}:${selection.artVariant}:${index}`}
                selection={selection}
              />
            ))}
          </div>
        </section>

        <section className="login-panel">
          <div className="login-title">
            <span>Ward Nexus</span>
            <h1>{getLoginTitle(mode, authChallenge)}</h1>
          </div>

          {serverRestartNotice && (
            <div className="login-warning">
              <span>{serverRestartNotice}</span>
              <div className="login-warning-actions">
                <button type="button" onClick={() => window.location.reload()}>
                  Reload Page
                </button>
                {onDismissServerRestartNotice ? (
                  <button type="button" onClick={onDismissServerRestartNotice}>
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {error && <p className="login-error">{error}</p>}
          {message && <p className="login-success">{message}</p>}

          {authChallenge ? (
            <form className="login-form" onSubmit={submitLoginChallenge}>
              <label>
                {authChallenge.type === "TOTP" ? "Authenticator Code" : `Email Code${authChallenge.destination ? ` (${authChallenge.destination})` : ""}`}
                <input
                  value={challengeCode}
                  onChange={event => setChallengeCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode={authChallenge.type === "NEW_DEVICE_EMAIL" ? "numeric" : "text"}
                />
              </label>

              <button disabled={busy} type="submit">
                {busy ? "Checking..." : "Verify"}
              </button>
            </form>
          ) : mode === "forgot" ? (
            <form className="login-form" onSubmit={requestPasswordReset}>
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

              <button disabled={busy} type="submit">
                {busy ? "Sending..." : "Send Reset Email"}
              </button>
            </form>
          ) : mode === "reset" ? (
            <form className="login-form" onSubmit={confirmPasswordReset}>
              <label>
                New Password
                <PasswordInput
                  value={resetPassword}
                  onChange={setResetPassword}
                  autoComplete="new-password"
                />
              </label>

              <label>
                Confirm New Password
                <PasswordInput
                  value={resetConfirmPassword}
                  onChange={setResetConfirmPassword}
                  autoComplete="new-password"
                />
              </label>

              <button disabled={busy || !resetToken} type="submit">
                {busy ? "Saving..." : "Reset Password"}
              </button>
            </form>
          ) : (
            <>
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
                  <PasswordInput
                    value={password}
                    onChange={setPassword}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                </label>

                {mode === "register" && (
                  <label>
                    Confirm Password
                    <PasswordInput
                      value={confirmAccountPassword}
                      onChange={setConfirmAccountPassword}
                      autoComplete="new-password"
                    />
                  </label>
                )}

                <button disabled={busy} type="submit">
                  {busy ? "Working..." : mode === "login" ? "Login" : "Create Account"}
                </button>
              </form>

              {discordAuthEnabled && (
                <button className="login-mode-toggle" type="button" onClick={continueWithDiscord}>
                  Continue with Discord
                </button>
              )}

              {mode === "login" && (
                <button
                  className="login-mode-toggle"
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError("");
                    setMessage("");
                  }}
                >
                  Forgot password?
                </button>
              )}

              <button
                className="login-mode-toggle"
                type="button"
                onClick={() => {
                  setMode(current => current === "login" ? "register" : "login");
                  setError("");
                  setMessage("");
                }}
              >
                {mode === "login" ? "Need an account?" : "Already have an account?"}
              </button>
            </>
          )}

          {(mode === "forgot" || mode === "reset" || authChallenge) && (
            <button
              className="login-mode-toggle"
              type="button"
              onClick={() => {
                setMode("login");
                setAuthChallenge(null);
                setChallengeCode("");
                setError("");
                setMessage("");
              }}
            >
              Back to Login
            </button>
          )}

          <p className="login-disclaimer">
            Ward Nexus is an unofficial fan-made tool and online battler for WARD TCG. It is not affiliated with, endorsed by, or sponsored by the WARD creators or rights holders. All card names, artwork, rules text, and related game materials remain the property of their respective owners.
          </p>
        </section>
      </section>
    </main>
  );
}

function getLoginTitle(mode: AuthMode, challenge: LoginChallenge | null): string {
  if (challenge?.type === "TOTP") return "Two-Factor Code";
  if (challenge?.type === "NEW_DEVICE_EMAIL") return "Email Code";
  if (mode === "register") return "Create Account";
  if (mode === "forgot") return "Forgot Password";
  if (mode === "reset") return "Reset Password";
  return "Login";
}

function LoginShowcaseCard({ className, selection }: { className: string; selection: LoginShowcaseSelection }) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const imageCandidates = useTargetedCardImageCandidates(selection.card, "default");
  const imageCandidate = imageCandidates[candidateIndex] ?? imageCandidates[0];
  const holoEnabled = selection.artVariant === "holo";

  useEffect(() => {
    setCandidateIndex(0);
  }, [selection.card.id, imageCandidates[0]?.url]);

  if (!imageCandidate) {
    return null;
  }

  return (
    <HolographicCardImage
      alt=""
      className={holoEnabled ? `${className} login-holo-card` : className}
      enabled={holoEnabled}
      intensity={className.includes("login-background-card") ? 3.4 : 5.4}
      key={`${selection.card.id}:${selection.artVariant}:${imageCandidate.url}`}
      seed={`login:${selection.card.packId}:${selection.card.id}:${selection.artVariant}`}
      src={imageCandidate.url}
      onError={() => setCandidateIndex(current => current + 1)}
    />
  );
}

function buildLoginShowcaseSelections(cards: CardLibraryCardSummary[]): LoginShowcaseSelection[] {
  const displayableCards = cards.filter(isDisplayableCard);
  const selectedCards = shuffleCards(displayableCards).slice(0, 6);
  const fallbackCards = FALLBACK_SHOWCASE_CARDS.filter(card => !selectedCards.some(selected => selected.id === card.id));
  const completeCards = [...selectedCards, ...fallbackCards].slice(0, 6);
  const selections = completeCards.map(card => ({
    artVariant: Math.random() > 0.52 ? "holo" : "default",
    card
  })) satisfies LoginShowcaseSelection[];

  const hasHolo = selections.some(selection => selection.artVariant === "holo");
  const hasDefault = selections.some(selection => selection.artVariant === "default");

  if (selections.length > 1 && !hasHolo) {
    selections[Math.floor(Math.random() * selections.length)].artVariant = "holo";
  }

  if (selections.length > 1 && !hasDefault) {
    selections[Math.floor(Math.random() * selections.length)].artVariant = "default";
  }

  const displaySelections = selections.slice(3, 6);

  if (displaySelections[1]) {
    displaySelections[1].artVariant = "holo";
  } else if (displaySelections[0]) {
    displaySelections[0].artVariant = "holo";
  }

  if (displaySelections.length > 1 && !displaySelections.some(selection => selection.artVariant === "default")) {
    displaySelections[0].artVariant = "default";
  }

  return selections;
}

function shuffleCards(cards: CardLibraryCardSummary[]): CardLibraryCardSummary[] {
  return cards
    .map(card => ({ card, sort: Math.random() }))
    .sort((left, right) => left.sort - right.sort)
    .map(item => item.card);
}

function isDisplayableCard(card: CardLibraryCardSummary): boolean {
  return Boolean(card.id && card.name && card.packId && card.cardType);
}

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const body = await response.text();

  if (!body.trim()) {
    throw new Error(
      response.ok
        ? `The auth server returned an empty response from ${response.url}.`
        : `The auth server returned ${response.status} ${response.statusText || "without a response body"} from ${response.url}.`
    );
  }

  try {
    return JSON.parse(body) as AuthResponse;
  } catch {
    throw new Error(
      `The auth request did not return JSON from ${new URL(response.url).origin}. Check that VITE_API_BASE_URL points to the Railway server service.`
    );
  }
}
