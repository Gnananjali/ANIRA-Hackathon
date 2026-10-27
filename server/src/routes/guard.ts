const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export type GuardResult = { ok: true } | { ok: false; code: string };

export function passesOriginGuard(origin: string | undefined): GuardResult {
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return { ok: false, code: 'origin_not_allowed' };
  }

  return { ok: true };
}

/**
 * The custom header forces a CORS preflight for browser callers, so a
 * cross-site page cannot trigger a mutation with a simple form POST. The
 * explicit origin check covers non-preflighted cases.
 */
export function passesApprovalGuard(
  origin: string | undefined,
  header: string | undefined,
): GuardResult {
  if (header !== '1') {
    return { ok: false, code: 'approval_header_required' };
  }

  return passesOriginGuard(origin);
}