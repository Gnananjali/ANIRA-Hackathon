import type { PlannerProvider } from './plannerClient';

export const CONSENT_KEY = 'anira.planner.external-consent';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function hasExternalConsent(storage: StorageLike | null): boolean {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(CONSENT_KEY) === 'granted';
  } catch {
    return false;
  }
}

export function grantExternalConsent(storage: StorageLike | null): void {
  try {
    storage?.setItem(CONSENT_KEY, 'granted');
  } catch {
    // Storage can be unavailable in private modes; consent then lasts one call.
  }
}

export function clearExternalConsent(storage: StorageLike | null): void {
  try {
    storage?.removeItem(CONSENT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/** Only external providers require consent; local Ollama and deterministic mode do not. */
export function consentRequired(
  provider: PlannerProvider,
  storage: StorageLike | null,
): boolean {
  return provider === 'external' && !hasExternalConsent(storage);
}