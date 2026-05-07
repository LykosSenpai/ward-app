import session from "express-session";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

declare module "express-session" {
  interface SessionData {
    user?: AuthUser;
  }
}

export const sessionMiddleware = session({
  name: "ward.sid",
  secret: process.env.SESSION_SECRET ?? "ward-local-dev-session-secret-change-before-hosting",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
});
