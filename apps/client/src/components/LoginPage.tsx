import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { AuthUser, CardLibraryCardSummary } from "../clientTypes";
import { API_BASE_URL } from "../config";
import { getImageCandidates } from "./CardImagePreview";
import { HolographicCardImage } from "./HolographicCardImage";

type LoginPageProps = {
  onAuthenticated: (user: AuthUser) => void;
};

type AuthMode = "login" | "register";

type AuthResponse = {
  user?: AuthUser;
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
  }
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
  const [cardLibrary, setCardLibrary] = useState<CardLibraryCardSummary[]>(FALLBACK_SHOWCASE_CARDS);

  useEffect(() => {
    let alive = true;

    async function loadCardLibrary() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/cards/library`, {
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

  const showcaseSelections = useMemo(
    () => buildLoginShowcaseSelections(cardLibrary),
    [cardLibrary]
  );
  const backgroundSelection = showcaseSelections[0] ?? buildLoginShowcaseSelections(FALLBACK_SHOWCASE_CARDS)[0];
  const displaySelections = showcaseSelections.slice(1, 4);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
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

      const data = await readAuthResponse(response);

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
          {backgroundSelection && (
            <LoginShowcaseCard
              className="login-background-card"
              selection={backgroundSelection}
            />
          )}

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

function LoginShowcaseCard({ className, selection }: { className: string; selection: LoginShowcaseSelection }) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const imageCandidates = useMemo(() => getImageCandidates(selection.card, "default"), [selection.card]);
  const imageCandidate = imageCandidates[candidateIndex] ?? imageCandidates[0];

  useEffect(() => {
    setCandidateIndex(0);
  }, [selection.card.id]);

  if (!imageCandidate) {
    return null;
  }

  return (
    <HolographicCardImage
      alt=""
      className={className}
      enabled={selection.artVariant === "holo"}
      intensity={className.includes("login-background-card") ? 0.46 : 0.68}
      key={`${selection.card.id}:${selection.artVariant}:${imageCandidate.url}`}
      seed={`login:${selection.card.packId}:${selection.card.id}:${selection.artVariant}`}
      src={imageCandidate.url}
      onError={() => setCandidateIndex(current => current + 1)}
    />
  );
}

function buildLoginShowcaseSelections(cards: CardLibraryCardSummary[]): LoginShowcaseSelection[] {
  const displayableCards = cards.filter(isDisplayableCard);
  const selectedCards = shuffleCards(displayableCards).slice(0, 4);
  const fallbackCards = FALLBACK_SHOWCASE_CARDS.filter(card => !selectedCards.some(selected => selected.id === card.id));
  const completeCards = [...selectedCards, ...fallbackCards].slice(0, 4);
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
