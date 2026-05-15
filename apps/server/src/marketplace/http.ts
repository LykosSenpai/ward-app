export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FORBIDDEN"
  | "BAD_REQUEST";

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: ApiErrorCode, message: string): { ok: false; error: { code: ApiErrorCode; message: string } } {
  return {
    ok: false,
    error: { code, message }
  };
}
