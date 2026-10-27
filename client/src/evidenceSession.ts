export const EVIDENCE_SESSION_HEADER = 'X-ANIRA-Session';
export const EVIDENCE_SESSION_STORAGE_KEY = 'anira.evidence.session';

const SESSION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): SessionStorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return `session-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }
}

/**
 * A browser-session identifier used only to scope server-recorded evidence.
 * It is not a credential and does not authorize event creation.
 */
export function getEvidenceSessionId(
  storage: SessionStorageLike | null = defaultStorage(),
  generate: () => string = newSessionId,
): string {
  if (!storage) {
    return 'anonymous';
  }

  try {
    const existing = storage.getItem(EVIDENCE_SESSION_STORAGE_KEY);
    if (existing && SESSION_PATTERN.test(existing)) {
      return existing;
    }

    const candidate = generate();
    const id = SESSION_PATTERN.test(candidate) ? candidate : 'anonymous';
    storage.setItem(EVIDENCE_SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return 'anonymous';
  }
}

export function evidenceHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...headers,
    [EVIDENCE_SESSION_HEADER]: getEvidenceSessionId(),
  };
}