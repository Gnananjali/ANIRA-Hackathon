import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlanStep } from '../src/types';
import { buildDemoPlan, derivePlanConstraints } from '../src/demoData';

const READ_TOOLS = new Set(['filesystem.read', 'report.compose', 'evidence.collect']);
const WRITE_TOOLS = new Set(['workspace.patch']);
const EXECUTE_TOOLS = new Set(['checks.run']);
const ALL_TOOLS = new Set([...READ_TOOLS, ...WRITE_TOOLS, ...EXECUTE_TOOLS]);

const kinds = (plan: PlanStep[]) => plan.map((step) => step.kind);
const tools = (plan: PlanStep[]) => plan.map((step) => step.tool);

describe('read-only briefs', () => {
  it('plans only read steps when edits and execution are forbidden', () => {
    const plan = buildDemoPlan(
      'List all files in the repository. Do not edit anything or run any commands.',
    );

    assert.ok(plan.length > 0);
    assert.deepEqual(new Set(kinds(plan)), new Set(['read']));
    assert.equal(plan.some((step) => step.kind === 'write'), false);
    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(tools(plan).includes('workspace.patch'), false);
    assert.equal(tools(plan).includes('checks.run'), false);
    for (const tool of tools(plan)) {
      assert.ok(READ_TOOLS.has(tool), `unexpected tool in read-only plan: ${tool}`);
    }
  });

  it('honours the phrase "read-only"', () => {
    const plan = buildDemoPlan('Read-only review of the config folder.');

    assert.ok(plan.length > 0);
    assert.equal(plan.every((step) => step.kind === 'read'), true);

    const constraints = derivePlanConstraints('Read-only review of the config folder.');
    assert.equal(constraints.readOnly, true);
    assert.equal(constraints.forbidEdits, true);
    assert.equal(constraints.forbidExecution, true);
  });

  it('treats "no changes" as a write ban', () => {
    const plan = buildDemoPlan('List the files in src. No changes.');

    assert.equal(plan.some((step) => step.kind === 'write'), false);
    assert.ok(plan.every((step) => step.kind === 'read'));
  });

  it('keeps audit-style briefs read-only', () => {
    const plan = buildDemoPlan('Audit dependencies for risky versions');

    assert.ok(plan.every((step) => step.kind === 'read'));
  });

  it('does not plan a deletion when deleting is ruled out', () => {
    const plan = buildDemoPlan('Do not delete anything. Just show me what is there.');

    assert.equal(plan.some((step) => step.kind === 'write'), false);
  });
});

describe('partial constraints', () => {
  it('allows checks but no writes when only edits are forbidden', () => {
    const plan = buildDemoPlan('Do not edit any files, but run the tests.');

    assert.equal(plan.some((step) => step.kind === 'write'), false);
    assert.equal(plan.some((step) => step.kind === 'execute'), true);
  });

  it('allows writes but no execution when only commands are forbidden', () => {
    const plan = buildDemoPlan('Refactor the auth module, but do not run any commands.');

    assert.equal(plan.some((step) => step.kind === 'write'), true);
    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(tools(plan).includes('checks.run'), false);
  });
});

describe('write briefs', () => {
  it('includes write and execute steps for a change request', () => {
    const plan = buildDemoPlan('Refactor the auth module and run the tests.');

    assert.deepEqual(kinds(plan), ['read', 'write', 'execute', 'read', 'read']);
    assert.deepEqual(tools(plan), [
      'filesystem.read',
      'workspace.patch',
      'checks.run',
      'report.compose',
      'evidence.collect',
    ]);
  });

  it('raises the risk for destructive briefs', () => {
    const plan = buildDemoPlan('Delete the temporary build files.');

    const write = plan.find((step) => step.kind === 'write');
    assert.ok(write);
    assert.equal(write.risk, 'high');

    const ordinary = buildDemoPlan('Refactor the auth module.');
    const ordinaryWrite = ordinary.find((step) => step.kind === 'write');
    assert.equal(ordinaryWrite?.risk, 'medium');
  });
});

describe('checks are opt-in', () => {
  it('omits the checks step for a write brief that never mentions tests', () => {
    const plan = buildDemoPlan('Refactor the auth module.');

    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(tools(plan).includes('checks.run'), false);
    assert.deepEqual(kinds(plan), ['read', 'write', 'read', 'read']);
  });

  it('omits the checks step for a destructive brief that never mentions tests', () => {
    const plan = buildDemoPlan('Delete the temporary build files.');

    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(tools(plan).includes('checks.run'), false);
  });

  it('omits the checks step for briefs that only run things without naming tests', () => {
    const plan = buildDemoPlan('Run the deployment script.');

    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(tools(plan).includes('checks.run'), false);
  });

  it('adds the checks step when the brief asks for tests', () => {
    const plan = buildDemoPlan('Refactor the auth module and run the tests.');

    assert.equal(plan.some((step) => step.kind === 'execute'), true);
    assert.equal(tools(plan).includes('checks.run'), true);
  });

  it('adds the checks step when the brief asks for checks explicitly', () => {
    const plan = buildDemoPlan('Review the config and run the checks.');

    assert.equal(plan.some((step) => step.kind === 'execute'), true);
    assert.equal(tools(plan).includes('checks.run'), true);
  });

  it('adds the checks step for a lint or typecheck request', () => {
    assert.equal(
      buildDemoPlan('Lint the client folder.').some((step) => step.kind === 'execute'),
      true,
    );
    assert.equal(
      buildDemoPlan('Typecheck the server.').some((step) => step.kind === 'execute'),
      true,
    );
  });

  it('does not add checks when tests are requested but execution is forbidden', () => {
    const plan = buildDemoPlan('Read-only review. Do not run the tests.');

    assert.equal(plan.some((step) => step.kind === 'execute'), false);
    assert.equal(plan.every((step) => step.kind === 'read'), true);
  });
});

describe('destructive risk', () => {
  it('keeps destructive write steps at high risk', () => {
    for (const brief of [
      'Delete the temporary build files.',
      'Remove the stale cache folder.',
      'Overwrite the generated manifest.',
    ]) {
      const write = buildDemoPlan(brief).find((step) => step.kind === 'write');
      assert.ok(write, `expected a write step for "${brief}"`);
      assert.equal(write.risk, 'high', `expected high risk for "${brief}"`);
      assert.equal(write.tool, 'workspace.patch');
    }
  });

  it('keeps non-destructive write steps at medium risk', () => {
    for (const brief of ['Refactor the auth module.', 'Update the README examples.']) {
      const write = buildDemoPlan(brief).find((step) => step.kind === 'write');
      assert.ok(write, `expected a write step for "${brief}"`);
      assert.equal(write.risk, 'medium');
    }
  });
});

describe('determinism and safety', () => {
  it('returns identical plans for identical briefs', () => {
    const brief = 'Refactor the auth module and run the tests.';
    assert.deepEqual(buildDemoPlan(brief), buildDemoPlan(brief));
  });

  it('normalizes whitespace without changing the outcome', () => {
    assert.deepEqual(
      buildDemoPlan('  Audit   dependencies  for risky versions '),
      buildDemoPlan('Audit dependencies for risky versions'),
    );
  });

  it('returns an empty plan for an empty brief', () => {
    assert.deepEqual(buildDemoPlan(''), []);
    assert.deepEqual(buildDemoPlan('   '), []);
  });

  it('numbers steps from 1 and marks every step proposed', () => {
    const plan = buildDemoPlan('Refactor the auth module and run the tests.');

    plan.forEach((step, index) => {
      assert.equal(step.id, `step-${index + 1}`);
      assert.equal(step.status, 'proposed');
    });
  });

  it('only emits tools from the known allowlist', () => {
    const briefs = [
      'List the files in src',
      'Audit dependencies for risky versions',
      'Refactor the auth module and run the tests',
      'Delete the temporary build files',
      'Do not edit anything or run any commands',
    ];

    for (const brief of briefs) {
      for (const tool of tools(buildDemoPlan(brief))) {
        assert.ok(ALL_TOOLS.has(tool), `unexpected tool "${tool}" for brief "${brief}"`);
      }
    }
  });

  it('treats path-like text as text only', () => {
    const pathLike = 'C:\\does\\not\\exist\\project';
    const plan = buildDemoPlan(`List files in ${pathLike}. No changes.`);

    assert.ok(plan.length > 0);
    assert.ok(plan.every((step) => step.kind === 'read'));
    assert.equal(plan[0]?.detail.includes(pathLike), true);
  });

  it('does not mutate the caller input', () => {
    const brief = 'Refactor the auth module';
    const copy = String(brief);
    buildDemoPlan(brief);
    assert.equal(brief, copy);
  });
});