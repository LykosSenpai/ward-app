import { createHash, createHmac } from "node:crypto";

export type CardImageBucketUrlStyle = "virtual-hosted" | "path";

export type CardImageBucketConfig = {
  bucketName: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
  urlStyle: CardImageBucketUrlStyle;
  presignedUrlTtlSeconds: number;
  redirectCacheSeconds: number;
};

export type CardImageBucketRouteConfig = {
  routePrefix: string;
  bucket: CardImageBucketConfig;
};

export type CardImageBucketRoutingConfig = {
  defaultBucket: CardImageBucketConfig | null;
  routes: CardImageBucketRouteConfig[];
};

export type CardImageBucketObject = {
  bucket: CardImageBucketConfig;
  objectKey: string;
};

const DEFAULT_REGION = "auto";
const DEFAULT_KEY_PREFIX = "card-images";
const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 60 * 60 * 24;
const MAX_PRESIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_REDIRECT_CACHE_SECONDS = 300;
const IMAGE_OBJECT_EXTENSION_PATTERN = /\.(?:webp|png|jpe?g)$/i;

function readEnv(env: NodeJS.ProcessEnv, ...keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }

  return "";
}

function readEnvForPrefix(env: NodeJS.ProcessEnv, prefix: string, key: string, commonKey = ""): string {
  return readEnv(
    env,
    `${prefix}_${key}`,
    commonKey
  );
}

function isEnabledEnvFlag(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isDisabledEnvFlag(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "false" || normalized === "0" || normalized === "no";
}

function parsePositiveInteger(value: string, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.includes("://") ? value : `https://${value}`;
  const parsed = new URL(endpoint);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeKeyPrefix(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function parseUrlStyle(value: string): CardImageBucketUrlStyle {
  const normalized = value.trim().toLowerCase();
  return normalized === "path" || normalized === "path-style" ? "path" : "virtual-hosted";
}

function createCardImageBucketConfigFromValues(args: {
  bucketName: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
  urlStyle: string;
  presignedUrlTtlSeconds: string;
  redirectCacheSeconds: string;
}): CardImageBucketConfig {
  return {
    bucketName: args.bucketName,
    endpoint: normalizeEndpoint(args.endpoint),
    region: args.region || DEFAULT_REGION,
    accessKeyId: args.accessKeyId,
    secretAccessKey: args.secretAccessKey,
    keyPrefix: normalizeKeyPrefix(args.keyPrefix),
    urlStyle: parseUrlStyle(args.urlStyle || "virtual-hosted"),
    presignedUrlTtlSeconds: parsePositiveInteger(
      args.presignedUrlTtlSeconds,
      DEFAULT_PRESIGNED_URL_TTL_SECONDS,
      MAX_PRESIGNED_URL_TTL_SECONDS
    ),
    redirectCacheSeconds: parsePositiveInteger(
      args.redirectCacheSeconds,
      DEFAULT_REDIRECT_CACHE_SECONDS,
      MAX_PRESIGNED_URL_TTL_SECONDS
    )
  };
}

function getDefaultCardImageBucketConfigFromEnv(env: NodeJS.ProcessEnv, enabled: boolean): CardImageBucketConfig | null {
  const bucketName = readEnv(env, "CARD_IMAGE_BUCKET_NAME", "BUCKET");
  const endpoint = readEnv(env, "CARD_IMAGE_BUCKET_ENDPOINT", "ENDPOINT");
  const accessKeyId = readEnv(env, "CARD_IMAGE_BUCKET_ACCESS_KEY_ID", "ACCESS_KEY_ID");
  const secretAccessKey = readEnv(env, "CARD_IMAGE_BUCKET_SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY");
  const hasAnyValue = Boolean(bucketName || endpoint || accessKeyId || secretAccessKey);

  if (!hasAnyValue) return null;

  const missing = [
    ["CARD_IMAGE_BUCKET_NAME", bucketName],
    ["CARD_IMAGE_BUCKET_ENDPOINT", endpoint],
    ["CARD_IMAGE_BUCKET_ACCESS_KEY_ID", accessKeyId],
    ["CARD_IMAGE_BUCKET_SECRET_ACCESS_KEY", secretAccessKey]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    if (enabled || hasAnyValue) {
      throw new Error(`CARD_IMAGE_BUCKET_ENABLED is true but these bucket settings are missing: ${missing.map(([key]) => key).join(", ")}`);
    }

    return null;
  }

  return createCardImageBucketConfigFromValues({
    bucketName,
    endpoint,
    region: readEnv(env, "CARD_IMAGE_BUCKET_REGION", "REGION") || DEFAULT_REGION,
    accessKeyId,
    secretAccessKey,
    keyPrefix: readEnv(env, "CARD_IMAGE_BUCKET_KEY_PREFIX") || DEFAULT_KEY_PREFIX,
    urlStyle: readEnv(env, "CARD_IMAGE_BUCKET_URL_STYLE") || "virtual-hosted",
    presignedUrlTtlSeconds: readEnv(env, "CARD_IMAGE_BUCKET_PRESIGN_TTL_SECONDS"),
    redirectCacheSeconds: readEnv(env, "CARD_IMAGE_BUCKET_REDIRECT_CACHE_SECONDS")
  });
}

function getRouteCardImageBucketConfigFromEnv(env: NodeJS.ProcessEnv, prefix: string): CardImageBucketConfig | null {
  const bucketName = readEnvForPrefix(env, prefix, "BUCKET_NAME") || readEnvForPrefix(env, prefix, "BUCKET");
  const endpoint = readEnvForPrefix(env, prefix, "ENDPOINT", "CARD_IMAGE_BUCKET_ENDPOINT");
  const accessKeyId = readEnvForPrefix(env, prefix, "ACCESS_KEY_ID");
  const secretAccessKey = readEnvForPrefix(env, prefix, "SECRET_ACCESS_KEY");

  if (!bucketName && !endpoint && !accessKeyId && !secretAccessKey) return null;

  const missing = [
    [`${prefix}_BUCKET_NAME`, bucketName],
    [`${prefix}_ENDPOINT`, endpoint],
    [`${prefix}_ACCESS_KEY_ID`, accessKeyId],
    [`${prefix}_SECRET_ACCESS_KEY`, secretAccessKey]
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Card image bucket route ${prefix} is incomplete. Missing: ${missing.map(([key]) => key).join(", ")}`);
  }

  return createCardImageBucketConfigFromValues({
    bucketName,
    endpoint,
    region: readEnvForPrefix(env, prefix, "REGION", "CARD_IMAGE_BUCKET_REGION") || DEFAULT_REGION,
    accessKeyId,
    secretAccessKey,
    keyPrefix: readEnvForPrefix(env, prefix, "KEY_PREFIX"),
    urlStyle: readEnvForPrefix(env, prefix, "URL_STYLE", "CARD_IMAGE_BUCKET_URL_STYLE") || "virtual-hosted",
    presignedUrlTtlSeconds: readEnv(env, `${prefix}_PRESIGN_TTL_SECONDS`, "CARD_IMAGE_BUCKET_PRESIGN_TTL_SECONDS"),
    redirectCacheSeconds: readEnv(env, `${prefix}_REDIRECT_CACHE_SECONDS`, "CARD_IMAGE_BUCKET_REDIRECT_CACHE_SECONDS")
  });
}

export function getCardImageBucketRoutingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CardImageBucketRoutingConfig | null {
  if (isDisabledEnvFlag(env.CARD_IMAGE_BUCKET_ENABLED)) return null;

  const enabled = isEnabledEnvFlag(env.CARD_IMAGE_BUCKET_ENABLED);
  const defaultBucket = getDefaultCardImageBucketConfigFromEnv(env, enabled);
  const routes = [
    ["gen1", "CARD_IMAGE_GEN1"],
    ["gen2", "CARD_IMAGE_GEN2"],
    ["gen3", "CARD_IMAGE_GEN3"],
    ["promo", "CARD_IMAGE_PROMO"],
    ["promos", "CARD_IMAGE_PROMO"]
  ].flatMap(([routePrefix, envPrefix]) => {
    const bucket = getRouteCardImageBucketConfigFromEnv(env, envPrefix);
    return bucket ? [{ routePrefix, bucket }] : [];
  });

  if (!defaultBucket && routes.length === 0) {
    if (enabled) {
      throw new Error("CARD_IMAGE_BUCKET_ENABLED is true but no card image bucket settings were found.");
    }

    return null;
  }

  return {
    defaultBucket,
    routes
  };
}

export function normalizeCardImageObjectPath(value: string): string | null {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .join("/");

  if (!normalized || normalized.includes("\0")) return null;

  const segments = normalized.split("/");
  if (segments.some(segment => segment === "." || segment === "..")) return null;

  if (normalized !== "manifest.json" && !IMAGE_OBJECT_EXTENSION_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function buildCardImageBucketObjectKey(config: CardImageBucketConfig, requestPath: string): string {
  return [config.keyPrefix, requestPath].filter(Boolean).join("/");
}

function getCardImageRoutePrefixFromFileName(fileName: string): string | null {
  const normalized = fileName.toLowerCase();
  const generationMatch = normalized.match(/^gen([0-9]+)_/);

  if (generationMatch) return `gen${generationMatch[1]}`;
  if (normalized.startsWith("promo_")) return "promos";

  return null;
}

export function resolveCardImageBucketObject(
  routingConfig: CardImageBucketRoutingConfig,
  requestPath: string
): CardImageBucketObject | null {
  const segments = requestPath.split("/");
  const firstSegment = segments[0]?.toLowerCase() ?? "";
  const matchingRoute = routingConfig.routes.find(route => route.routePrefix === firstSegment);

  if (matchingRoute) {
    const objectPath = segments.slice(1).join("/");
    if (!objectPath) return null;

    return {
      bucket: matchingRoute.bucket,
      objectKey: buildCardImageBucketObjectKey(matchingRoute.bucket, objectPath)
    };
  }

  const inferredRoutePrefix = getCardImageRoutePrefixFromFileName(segments.at(-1) ?? requestPath);
  const inferredRoute = routingConfig.routes.find(route => route.routePrefix === inferredRoutePrefix);

  if (inferredRoute) {
    return {
      bucket: inferredRoute.bucket,
      objectKey: buildCardImageBucketObjectKey(inferredRoute.bucket, requestPath)
    };
  }

  if (routingConfig.defaultBucket) {
    return {
      bucket: routingConfig.defaultBucket,
      objectKey: buildCardImageBucketObjectKey(routingConfig.defaultBucket, requestPath)
    };
  }

  return null;
}

export function describeCardImageBucketRoutingConfig(routingConfig: CardImageBucketRoutingConfig): string {
  const routes = routingConfig.routes.map(route => `${route.routePrefix}->${route.bucket.bucketName}`).join(", ");
  const defaultRoute = routingConfig.defaultBucket ? `default->${routingConfig.defaultBucket.bucketName}` : "";

  return [routes, defaultRoute].filter(Boolean).join(", ");
}

function formatAmzDate(date: Date): { dateStamp: string; amzDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso
  };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeS3Path(value: string): string {
  return value.split("/").map(encodeRfc3986).join("/");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const dateRegionKey = hmac(dateKey, region);
  const dateRegionServiceKey = hmac(dateRegionKey, "s3");
  return hmac(dateRegionServiceKey, "aws4_request");
}

function getCanonicalQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    )
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
}

function buildRequestTarget(config: CardImageBucketConfig, objectKey: string): { host: string; path: string; origin: string } {
  const endpointUrl = new URL(config.endpoint);
  const endpointPath = endpointUrl.pathname.replace(/\/+$/, "");
  const encodedObjectKey = encodeS3Path(objectKey);

  if (config.urlStyle === "path") {
    return {
      host: endpointUrl.host,
      path: `${endpointPath}/${encodeRfc3986(config.bucketName)}/${encodedObjectKey}`.replace(/\/{2,}/g, "/"),
      origin: `${endpointUrl.protocol}//${endpointUrl.host}`
    };
  }

  const host = `${config.bucketName}.${endpointUrl.host}`;

  return {
    host,
    path: `${endpointPath}/${encodedObjectKey}`.replace(/\/{2,}/g, "/"),
    origin: `${endpointUrl.protocol}//${host}`
  };
}

export function createCardImageBucketPresignedGetUrl(
  config: CardImageBucketConfig,
  objectKey: string,
  now = new Date()
): string {
  const { dateStamp, amzDate } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const { host, path: requestPath, origin } = buildRequestTarget(config, objectKey);
  const signedHeaders = "host";

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(config.presignedUrlTtlSeconds),
    "X-Amz-SignedHeaders": signedHeaders
  };

  const canonicalQueryString = getCanonicalQueryString(queryParams);
  const canonicalRequest = [
    "GET",
    requestPath || "/",
    canonicalQueryString,
    `host:${host}`,
    "",
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = createHmac("sha256", getSigningKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${origin}${requestPath}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
