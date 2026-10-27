import type { EvidenceInput } from './schema';

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHARS_EXCEPT_NEWLINES =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BEARER_SECRET = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_VALUE_SECRET =
  /\b(api[_-]?key|access[_-]?token|token|secret|password|passwd|authorization)\b\s*[:=]\s*[^\s,;]+/gi;
const PREFIXED_SECRET = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g;

export interface SanitizeOptions {
  maxOutputBytes: number;
  secrets: readonly string[];
}

function bound(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function redactSecrets(
  value: string,
  secrets: readonly string[],
): string {
  let output = value;

  for (const secret of secrets) {
    if (secret.length >= 6) {
      output = output.split(secret).join('[redacted]');
    }
  }

  return output
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARS_EXCEPT_NEWLINES, '')
    .replace(PREFIXED_SECRET, '[redacted]')
    .replace(BEARER_SECRET, '$1 [redacted]')
    .replace(KEY_VALUE_SECRET, '$1=[redacted]');
}

function capUtf8(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) {
    return { text: value, truncated: false };
  }

  return {
    text: bytes.subarray(0, Math.max(0, maxBytes)).toString('utf8').replace(/\uFFFD+$/, ''),
    truncated: true,
  };
}

export function sanitizeOutput(
  value: string,
  maxBytes: number,
  secrets: readonly string[],
): { text: string; truncated: boolean } {
  return capUtf8(redactSecrets(value, secrets), maxBytes);
}

/** Captures secret-like environment values once per store instance. */
export function environmentSecretValues(): string[] {
  const values = new Set<string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (
      value &&
      value.length >= 8 &&
      /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(key)
    ) {
      values.add(value);
    }
  }

  return [...values];
}

/**
 * Copies, redacts, and bounds caller-supplied evidence before it is validated
 * and stored. Nothing here trusts the UI.
 */
export function sanitizeEvidenceInput(
  input: EvidenceInput,
  options: SanitizeOptions,
): EvidenceInput {
  const copy = structuredClone(input);
  copy.operation = bound(copy.operation, 120);
  if (copy.reason !== undefined) {
    copy.reason = bound(copy.reason, 120);
  }

  if (copy.type === 'inspection') {
    copy.evidence.repoName = bound(copy.evidence.repoName, 200);
    copy.evidence.ignoredFolders = copy.evidence.ignoredFolders
      .slice(0, 8)
      .map((folder) => bound(folder, 80));
    copy.evidence.stack = copy.evidence.stack
      .slice(0, 12)
      .map((signal) => bound(signal, 120));
    copy.evidence.languages = copy.evidence.languages
      .slice(0, 6)
      .map((language) => ({
        name: bound(language.name, 80),
        files: language.files,
      }));
  }

  if (copy.type === 'planning') {
    if (copy.evidence.model !== undefined) {
      copy.evidence.model = bound(copy.evidence.model, 128);
    }
    if (copy.evidence.fallbackReason !== undefined) {
      copy.evidence.fallbackReason = bound(copy.evidence.fallbackReason, 80);
    }
    copy.evidence.steps = copy.evidence.steps.slice(0, 10).map((step) => ({
      id: bound(step.id, 64),
      action: bound(step.action, 40),
      risk: bound(step.risk, 16),
    }));
  }

  if (copy.type === 'approval') {
    if (copy.evidence.checkId !== undefined) {
      copy.evidence.checkId = bound(copy.evidence.checkId, 64);
    }
    if (copy.evidence.command !== undefined) {
      copy.evidence.command = bound(copy.evidence.command, 120);
    }
    if (copy.evidence.path !== undefined) {
      copy.evidence.path = bound(copy.evidence.path, 512);
    }
  }

  if (copy.type === 'edit') {
    copy.evidence.path = bound(copy.evidence.path, 512);
  }

  if (copy.type === 'verification') {
    copy.evidence.checkId = bound(copy.evidence.checkId, 64);
    copy.evidence.command = bound(copy.evidence.command, 120);
    const stdout = sanitizeOutput(
      copy.evidence.stdout,
      options.maxOutputBytes,
      options.secrets,
    );
    const stderr = sanitizeOutput(
      copy.evidence.stderr,
      options.maxOutputBytes,
      options.secrets,
    );
    copy.evidence.stdout = stdout.text;
    copy.evidence.stderr = stderr.text;
    copy.evidence.truncated =
      copy.evidence.truncated || stdout.truncated || stderr.truncated;
  }

  if (copy.type === 'recovery') {
    copy.evidence.path = bound(copy.evidence.path, 512);
  }

  if (copy.type === 'failure') {
    copy.evidence.operation = bound(copy.evidence.operation, 120);
    copy.evidence.reason = bound(copy.evidence.reason, 120);
  }

  return copy;
}