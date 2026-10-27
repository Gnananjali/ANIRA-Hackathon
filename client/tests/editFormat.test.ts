import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeEditFailure, shortHash } from '../src/editFormat';

describe('edit formatting', () => {
  it('shortens sha256 hashes', () => {
    assert.equal(
      shortHash('sha256:0123456789abcdef0123456789abcdef'),
      '0123456789ab',
    );
    assert.equal(shortHash('not-a-hash'), 'not-a-hash');
  });

  it('maps path and match failures to plain language', () => {
    assert.match(describeEditFailure({ error: 'no_match' }), /not found/i);
    assert.match(describeEditFailure({ error: 'ambiguous_change' }), /more than once/i);
    assert.match(describeEditFailure({ error: 'file_changed' }), /preview again/i);
    assert.match(describeEditFailure({ error: 'ignored_path' }), /ignored folder/i);
  });

  it('explains unsupported files by reason', () => {
    assert.match(
      describeEditFailure({ error: 'unsupported_file', reason: 'binary' }),
      /binary/i,
    );
    assert.match(
      describeEditFailure({ error: 'unsupported_file', reason: 'invalid_utf8' }),
      /UTF-8/i,
    );
    assert.match(
      describeEditFailure({ error: 'unsupported_file', reason: 'too_large' }),
      /too large/i,
    );
  });

  it('falls back for unknown errors', () => {
    assert.equal(describeEditFailure({ error: 'surprise' }), 'The edit request failed.');
    assert.equal(describeEditFailure(null), 'The edit request failed.');
  });
});