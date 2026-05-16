import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { getDbPool } from "../db/pool.js";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: "PLAYER" | "HOST" | "DEVELOPER" | "ADMIN";
  canAccessDevTools: boolean;
  devToolsEnabled: boolean;
  discord?: {
    userId: string;
    username: string;
    globalName?: string;
    avatar?: string;
    linkedAt?: string;
  };
};

declare module "express-session" {
  interface SessionData {
    user?: AuthUser;
    embedContext?: {
      parentOrigin: string;
      matchId?: string;
      view?: string;
      expiresAt: number;
    };
    discordOAuthState?: {
      state: string;
      mode: "login" | "link";
      createdAt: number;
      clientOrigin?: string;
    };
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET ?? "";
const PgSessionStore = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";

type SessionCookieSameSite = "lax" | "strict" | "none";

function getSessionCookieSameSite(): SessionCookieSameSite {
  const configuredValue = process.env.SESSION_COOKIE_SAMESITE?.trim().toLowerCase();

  if (
    configuredValue === "lax" ||
    configuredValue === "strict" ||
    configuredValue === "none"
  ) {
    return configuredValue;
  }

  return "lax";
}

if (isProduction && SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters in production.");
}

export const sessionMiddleware = session({
  name: "ward.sid",
  secret: SESSION_SECRET || "ward-local-dev-session-secret-change-before-hosting",
  store: new PgSessionStore({
    pool: getDbPool(),
    tableName: "user_sessions"
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: getSessionCookieSameSite(),
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});
