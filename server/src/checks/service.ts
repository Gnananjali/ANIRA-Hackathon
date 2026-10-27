import { createApprovalStore } from './approvals';
import {
  CheckError,
  findCheck,
  inspectTestScript,
  resolveCheckRoot,
  type CheckDefinition,
} from './catalog';
import { failureInput, recordEvidence } from '../evidence/recorder';
import type { EvidenceRecorder } from '../evidence/schema';
import {
  resolveNpmRunner,
  type NpmLookup,
  type NpmRunner,
} from './npm';
import {
  CheckStartError,
  runNpmTest,
  type RunOptions,
  type RunResult,
} from './runner';

export interface PrepareResult {
  approvalId: string;
  expiresAt: string;
  root: string;
  check: CheckDefinition;
}

export type RunResponse = RunResult & {
  checkId: string;
  command: string;
};

export type CommandRunner = (
  runner: NpmRunner,
  cwd: string,
  options: RunOptions,
) => Promise<RunResult>;

export interface CheckServiceOptions {
  approvalTtlMs?: number;
  timeoutMs?: number;
  maxOutputBytes?: number;
  now?: () => number;
  npm?: NpmLookup;
  runner?: CommandRunner;
  evidence?: EvidenceRecorder;
}

export function createCheckService(options: CheckServiceOptions = {}) {
  const store = createApprovalStore(
    options.approvalTtlMs ?? 120_000,
    options.now,
  );
  const evidence = options.evidence;
  const runOptions: RunOptions = {
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 128 * 1024,
  };
  const runCommand = options.runner ?? runNpmTest;

  let npmLookup: NpmLookup | undefined = options.npm;
  let active = false;

  function getNpm(): NpmLookup {
    npmLookup ??= resolveNpmRunner();
    return npmLookup;
  }

  return {
    async prepare(input: {
      root: unknown;
      checkId: unknown;
      sessionId?: string;
    }): Promise<PrepareResult> {
      const sessionId = input.sessionId ?? 'anonymous';

      try {
        const check = findCheck(input.checkId);
        const root = await resolveCheckRoot(input.root);

        const npm = getNpm();
        if (!npm.ok) {
          throw new CheckError('check_unavailable', 409, npm.reason);
        }

        const scriptState = await inspectTestScript(root);
        if (scriptState !== 'ready') {
          throw new CheckError('check_unavailable', 409, scriptState);
        }

        const approval = store.create(root, check.id, check.command);

        recordEvidence(evidence, sessionId, {
          type: 'approval',
          outcome: 'planned',
          operation: 'checks.prepare',
          evidence: {
            kind: 'approval',
            target: 'check',
            checkId: check.id,
            command: check.command,
          },
        });

        return {
          approvalId: approval.id,
          expiresAt: new Date(approval.expiresAt).toISOString(),
          root,
          check,
        };
      } catch (error) {
        if (error instanceof CheckError) {
          recordEvidence(
            evidence,
            sessionId,
            failureInput(
              'checks.prepare',
              error.status === 409 ? 'blocked' : 'failed',
              error.reason ?? error.code,
            ),
          );
        }

        throw error;
      }
    },

    async run(
      approvalId: unknown,
      sessionId = 'anonymous',
    ): Promise<RunResponse> {
      if (active) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput('checks.run', 'blocked', 'run_in_progress'),
        );
        throw new CheckError('run_in_progress', 409);
      }

      const consumed = store.consume(approvalId);
      if (!consumed.ok) {
        const reason =
          consumed.reason === 'expired' ? 'approval_expired' : 'approval_invalid';
        recordEvidence(
          evidence,
          sessionId,
          failureInput('checks.run', 'blocked', reason),
        );
        throw consumed.reason === 'expired'
          ? new CheckError('approval_expired', 410)
          : new CheckError('approval_invalid', 400);
      }

      const npm = getNpm();
      if (!npm.ok) {
        recordEvidence(
          evidence,
          sessionId,
          failureInput(
            'checks.run',
            'blocked',
            npm.reason ?? 'check_unavailable',
          ),
        );
        throw new CheckError('check_unavailable', 409, npm.reason);
      }

      active = true;

      recordEvidence(evidence, sessionId, {
        type: 'approval',
        outcome: 'approved',
        operation: 'checks.run',
        evidence: {
          kind: 'approval',
          target: 'check',
          checkId: consumed.approval.checkId,
          command: consumed.approval.command,
        },
      });

      try {
        const result = await runCommand(npm.runner, consumed.approval.root, runOptions);
        const verified = !result.timedOut && result.exitCode === 0;

        recordEvidence(evidence, sessionId, {
          type: 'verification',
          outcome: verified ? 'verified' : 'failed',
          operation: 'checks.run',
          ...(verified
            ? {}
            : {
                reason: result.timedOut
                  ? 'timed_out'
                  : result.exitCode === null
                    ? 'no_exit_code'
                    : 'nonzero_exit',
              }),
          evidence: {
            kind: 'verification',
            checkId: consumed.approval.checkId,
            command: consumed.approval.command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
            truncated: result.truncated,
            stdout: result.stdout,
            stderr: result.stderr,
            coversPlanSteps: false,
          },
        });

        return {
          checkId: consumed.approval.checkId,
          command: consumed.approval.command,
          ...result,
        };
      } catch (error) {
        if (error instanceof CheckStartError) {
          recordEvidence(
            evidence,
            sessionId,
            failureInput('checks.run', 'failed', 'check_failed_to_start'),
          );
          throw new CheckError('check_failed_to_start', 500);
        }
        throw error;
      } finally {
        active = false;
      }
    },
  };
}

export type CheckService = ReturnType<typeof createCheckService>;