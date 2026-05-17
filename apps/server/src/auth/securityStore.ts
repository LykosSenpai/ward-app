import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Request, Response } from "express";

import { getDbPool } from "../db/pool.js";
import { createQrCodeDataUrl } from "./qrCode.js";

export type LoginChallengeType = "TOTP" | "NEW_DEVICE_EMAIL";
export type SecurityTokenPurpose = "PASSWORD_RESET" | "EMAIL_VERIFY";

export type SecurityTokenResult = {
  userId: string;
  targetEmail?: string;
};

export type LoginChallenge = {
  id: string;
  userId: string;
  type: LoginChallengeType;
  codeHash?: string | null;
  expiresAt: string;
  attempts: number;
};

export type TotpSetup = {
  secret: string;
  qrCodeDataUrl: string;
};

const TRUSTED_DEVICE_COOKIE_NAME = "ward.device";
const TRUSTED_DEVICE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOKEN_BYTES = 32;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_LABEL_USERNAME_MAX_LENGTH = 64;

type LoginChallengeRow = {
  id: string;
  user_id: string;
  type: LoginChallengeType;
  code_hash?: string | null;
  expires_at: Date | string;
  attempts: number;
};

type SecuritySettingsRow = {
  totp_secret_ciphertext?: string | null;
  totp_enabled_at?: Date | string | null;
  totp_pending_secret_ciphertext?: string | null;
};

export function createSecurityTokenValue(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function createEmailCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (!name || !domain) return email;
  const visible = name.length <= 2 ? name[0] : `${name[0]}${name[name.length - 1]}`;
  return `${visible}${"*".repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

export async function createSecurityToken(args: {
  userId: string;
  purpose: SecurityTokenPurpose;
  targetEmail?: string;
  ttlMs: number;
}): Promise<string> {
  const token = createSecurityTokenValue();
  const tokenHash = hashToken(token);

  await getDbPool().query(
    `
      insert into auth_security_tokens (user_id, purpose, token_hash, target_email, expires_at)
      values ($1, $2, $3, $4, now() + ($5::text || ' milliseconds')::interval)
    `,
    [args.userId, args.purpose, tokenHash, args.targetEmail ?? null, args.ttlMs]
  );

  return token;
}

export async function consumeSecurityToken(token: string, purpose: SecurityTokenPurpose): Promise<SecurityTokenResult | null> {
  const result = await getDbPool().query<{ user_id: string; target_email?: string | null }>(
    `
      update auth_security_tokens
      set consumed_at = now()
      where token_hash = $1
        and purpose = $2
        and consumed_at is null
        and expires_at > now()
      returning user_id, target_email
    `,
    [hashToken(token), purpose]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    targetEmail: row.target_email ?? undefined
  };
}

export async function createLoginChallenge(args: {
  userId: string;
  type: LoginChallengeType;
  code?: string;
  ttlMs: number;
}): Promise<LoginChallenge> {
  const codeHash = args.code ? await bcrypt.hash(args.code, 12) : null;
  const result = await getDbPool().query<LoginChallengeRow>(
    `
      insert into auth_login_challenges (user_id, type, code_hash, expires_at)
      values ($1, $2, $3, now() + ($4::text || ' milliseconds')::interval)
      returning id, user_id, type, code_hash, expires_at, attempts
    `,
    [args.userId, args.type, codeHash, args.ttlMs]
  );

  return toLoginChallenge(result.rows[0]);
}

export async function getActiveLoginChallenge(challengeId: string): Promise<LoginChallenge | null> {
  const result = await getDbPool().query<LoginChallengeRow>(
    `
      select id, user_id, type, code_hash, expires_at, attempts
      from auth_login_challenges
      where id = $1 and consumed_at is null and expires_at > now()
    `,
    [challengeId]
  );

  const row = result.rows[0];
  return row ? toLoginChallenge(row) : null;
}

export async function addLoginChallengeAttempt(challengeId: string): Promise<number> {
  const result = await getDbPool().query<{ attempts: number }>(
    `
      update auth_login_challenges
      set attempts = attempts + 1
      where id = $1
      returning attempts
    `,
    [challengeId]
  );

  return result.rows[0]?.attempts ?? 0;
}

export async function consumeLoginChallenge(challengeId: string): Promise<void> {
  await getDbPool().query(
    "update auth_login_challenges set consumed_at = now() where id = $1",
    [challengeId]
  );
}

export async function verifyLoginChallengeCode(challenge: LoginChallenge, code: string): Promise<boolean> {
  if (!challenge.codeHash) return false;
  return bcrypt.compare(code.trim(), challenge.codeHash);
}

export async function beginTotpSetup(userId: string, username: string): Promise<TotpSetup> {
  const secret = generateTotpSecret();

  await getDbPool().query(
    `
      insert into user_security_settings (user_id, totp_pending_secret_ciphertext, totp_pending_created_at, updated_at)
      values ($1, $2, now(), now())
      on conflict (user_id) do update
      set totp_pending_secret_ciphertext = excluded.totp_pending_secret_ciphertext,
          totp_pending_created_at = now(),
          updated_at = now()
    `,
    [userId, encryptSecret(secret)]
  );

  const label = `Ward Nexus:${formatTotpLabelUsername(username)}`;
  const authenticatorUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent("Ward Nexus")}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
  const qrCodeDataUrl = createQrCodeDataUrl(authenticatorUri);

  return { secret, qrCodeDataUrl };
}

function formatTotpLabelUsername(username: string): string {
  const value = username.trim() || "account";
  return value.length > TOTP_LABEL_USERNAME_MAX_LENGTH
    ? `${value.slice(0, TOTP_LABEL_USERNAME_MAX_LENGTH - 3)}...`
    : value;
}

export async function enableTotp(userId: string, code: string): Promise<string[]> {
  const settings = await getSecuritySettings(userId);
  const pendingSecret = settings?.totp_pending_secret_ciphertext
    ? decryptSecret(settings.totp_pending_secret_ciphertext)
    : "";

  if (!pendingSecret || !verifyTotpCode(pendingSecret, code)) {
    throw new Error("Invalid authenticator code.");
  }

  const recoveryCodes = createRecoveryCodes();
  const recoveryHashes = await Promise.all(recoveryCodes.map(recoveryCode => bcrypt.hash(normalizeRecoveryCode(recoveryCode), 12)));
  const client = await getDbPool().connect();

  try {
    await client.query("begin");
    await client.query(
      `
        update user_security_settings
        set totp_secret_ciphertext = totp_pending_secret_ciphertext,
            totp_enabled_at = now(),
            totp_pending_secret_ciphertext = null,
            totp_pending_created_at = null,
            updated_at = now()
        where user_id = $1
      `,
      [userId]
    );
    await client.query("delete from user_recovery_codes where user_id = $1", [userId]);

    for (const hash of recoveryHashes) {
      await client.query(
        "insert into user_recovery_codes (user_id, code_hash) values ($1, $2)",
        [userId, hash]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return recoveryCodes;
}

export async function disableTotp(userId: string): Promise<void> {
  await getDbPool().query(
    `
      update user_security_settings
      set totp_secret_ciphertext = null,
          totp_enabled_at = null,
          totp_pending_secret_ciphertext = null,
          totp_pending_created_at = null,
          updated_at = now()
      where user_id = $1
    `,
    [userId]
  );

  await getDbPool().query("delete from user_recovery_codes where user_id = $1", [userId]);
}

export async function isTotpEnabled(userId: string): Promise<boolean> {
  const settings = await getSecuritySettings(userId);
  return Boolean(settings?.totp_enabled_at && settings.totp_secret_ciphertext);
}

export async function verifyTotpOrRecoveryCode(userId: string, codeValue: string): Promise<boolean> {
  const code = codeValue.trim();
  const settings = await getSecuritySettings(userId);

  if (!settings?.totp_secret_ciphertext || !settings.totp_enabled_at) {
    return true;
  }

  const secret = decryptSecret(settings.totp_secret_ciphertext);

  if (/^\d{6}$/.test(code) && verifyTotpCode(secret, code)) {
    return true;
  }

  return consumeRecoveryCode(userId, code);
}

export async function isTrustedDevice(userId: string, req: Request): Promise<boolean> {
  const token = getCookie(req, TRUSTED_DEVICE_COOKIE_NAME);
  if (!token) return false;

  const result = await getDbPool().query<{ id: string }>(
    `
      update auth_trusted_devices
      set last_seen_at = now()
      where user_id = $1 and token_hash = $2 and expires_at > now()
      returning id
    `,
    [userId, hashToken(token)]
  );

  return Boolean(result.rows[0]);
}

export async function trustDevice(userId: string, req: Request, res: Response): Promise<void> {
  const token = createSecurityTokenValue();
  await getDbPool().query(
    `
      insert into auth_trusted_devices (user_id, token_hash, user_agent, expires_at)
      values ($1, $2, $3, now() + interval '180 days')
    `,
    [userId, hashToken(token), String(req.headers["user-agent"] ?? "").slice(0, 500)]
  );

  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TRUSTED_DEVICE_MAX_AGE_MS
  });
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getEncryptionKey(): Buffer {
  const secret = process.env.SECURITY_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "ward-local-security-key-change-before-hosting";
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map(part => part.toString("base64url")).join(".");
}

function decryptSecret(value: string): string {
  const [ivValue, tagValue, ciphertextValue] = value.split(".");

  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid encrypted security secret.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function verifyTotpCode(secret: string, codeValue: string): boolean {
  const code = codeValue.trim();
  if (!/^\d{6}$/.test(code)) return false;

  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);

  for (let offset = -1; offset <= 1; offset += 1) {
    if (createTotpCode(secret, nowCounter + offset) === code) {
      return true;
    }
  }

  return false;
}

function createTotpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(value: string): Buffer {
  const input = value.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of input) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    current = (current << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

async function getSecuritySettings(userId: string): Promise<SecuritySettingsRow | null> {
  const result = await getDbPool().query<SecuritySettingsRow>(
    `
      select totp_secret_ciphertext, totp_enabled_at, totp_pending_secret_ciphertext
      from user_security_settings
      where user_id = $1
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const value = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (!/^[A-Z2-7]{10}$/.test(normalized)) return false;

  const result = await getDbPool().query<{ id: string; code_hash: string }>(
    `
      select id, code_hash
      from user_recovery_codes
      where user_id = $1 and used_at is null
      order by created_at asc
    `,
    [userId]
  );

  for (const row of result.rows) {
    if (await bcrypt.compare(normalized, row.code_hash)) {
      await getDbPool().query(
        "update user_recovery_codes set used_at = now() where id = $1",
        [row.id]
      );
      return true;
    }
  }

  return false;
}

function getCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return undefined;
}

function toLoginChallenge(row: LoginChallengeRow): LoginChallenge {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    codeHash: row.code_hash ?? undefined,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    attempts: Number(row.attempts ?? 0)
  };
}
