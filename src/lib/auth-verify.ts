import { jwtVerify } from "jose";

const JWT_SECRET_ENV = "SUPABASE_JWT_SECRET";
const PLACEHOLDER = "PASTE_FROM_DASHBOARD";

/**
 * The Supabase JWT secret from env, or null when unset/placeholder.
 * Server-only — never import this into a client component.
 */
export function getSupabaseJwtSecret(): string | null {
  const secret = process.env[JWT_SECRET_ENV];
  if (!secret || secret === PLACEHOLDER) return null;
  return secret;
}

/**
 * Verify a Supabase-issued user session JWT (HS256) using the project's JWT
 * secret. Throws on an invalid signature, expired token, wrong audience, or
 * missing secret — callers should treat any throw as "not authenticated".
 * Only user session tokens (aud = "authenticated") are accepted, never
 * service-role tokens.
 */
export async function verifySessionJwt(
  token: string
): Promise<{ sub: string; aud: string }> {
  const secret = getSupabaseJwtSecret();
  if (!secret) throw new Error("SUPABASE_JWT_SECRET not configured");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  if (String(payload.aud) !== "authenticated") {
    throw new Error("JWT is not a user session token");
  }
  return {
    sub: payload.sub ?? "",
    aud: String(payload.aud),
  };
}

/** Non-throwing convenience wrapper — true only for a valid, unexpired JWT. */
export async function isValidSessionJwt(token: string): Promise<boolean> {
  try {
    await verifySessionJwt(token);
    return true;
  } catch {
    return false;
  }
}
