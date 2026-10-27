import type { Request } from 'express';

import {
  EVIDENCE_SESSION_FALLBACK,
  EVIDENCE_SESSION_PATTERN,
} from './schema';

export const EVIDENCE_SESSION_HEADER = 'X-ANIRA-Session';

export function normalizeEvidenceSession(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (EVIDENCE_SESSION_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }

  return EVIDENCE_SESSION_FALLBACK;
}

export function evidenceSession(request: Request): string {
  return normalizeEvidenceSession(request.get(EVIDENCE_SESSION_HEADER));
}