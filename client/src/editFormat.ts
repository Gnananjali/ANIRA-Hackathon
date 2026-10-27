const UNSUPPORTED_REASONS: Record<string, string> = {
  binary: 'That file looks binary. Only text files can be edited.',
  invalid_utf8: 'Only valid UTF-8 text files are supported.',
  too_large: 'That file is too large. The limit is 256 KB.',
};

const MESSAGES: Record<string, string> = {
  invalid_path: 'Use a relative file path inside the inspected folder.',
  ignored_path: 'That path is inside an ignored folder (node_modules, .git, dist, build).',
  unsafe_path: 'Symlinks and paths outside the inspected folder are not allowed.',
  not_found: 'That file was not found.',
  not_a_file: 'That path is not a regular file.',
  not_a_directory: 'The inspected root is not a folder.',
  invalid_change: 'The find or replacement text is not valid.',
  no_match: 'The text to replace was not found in that file.',
  ambiguous_change: 'That text appears more than once. Make the find text unique.',
  no_change: 'The replacement is identical to the original text.',
  approval_invalid: 'That preview is no longer valid. Preview the change again.',
  approval_expired: 'The preview expired. Preview the change again.',
  file_changed: 'The file changed after the preview. Nothing was written; preview again.',
  edit_in_progress: 'Another edit is being applied. Try again in a moment.',
  write_failed: 'The write failed. The original file was left unchanged.',
  rollback_verification_failed:
    'The restored file did not match its original SHA-256 hash. Review the file before retrying.',
  rollback_invalid: 'That undo is no longer valid.',
  rollback_expired: 'The undo window expired.',
  approval_header_required: 'Request blocked by the approval guard.',
  origin_not_allowed: 'Request blocked by the approval guard.',
};

export function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, '').slice(0, 12);
}

export function describeEditFailure(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'The edit request failed.';
  }

  const record = payload as { error?: unknown; reason?: unknown };
  const code = typeof record.error === 'string' ? record.error : '';
  const reason = typeof record.reason === 'string' ? record.reason : '';

  if (code === 'unsupported_file' && reason && UNSUPPORTED_REASONS[reason]) {
    return UNSUPPORTED_REASONS[reason];
  }

  return MESSAGES[code] ?? 'The edit request failed.';
}