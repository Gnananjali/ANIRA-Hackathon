import { createApprovalStore } from './approvals';
import {
  CheckError,
  findCheck,
  inspectTestScript,
  resolveCheckRoot,
  type CheckDefinition,
} from './catalog';
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
}

export function createCheckService(options: CheckServiceOptions = {}) {
  const store = createApprovalStore(
    options.approvalTtlMs ?? 120_000,
    options.now,
  );
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
    }): Promise<PrepareResult> {
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

      return {
        approvalId: approval.id,
        expiresAt: new Date(approval.expiresAt).toISOString(),
        root,
        check,
      };
    },

    async run(approvalId: unknown): Promise<RunResponse> {
      if (active) {
        throw new CheckError('run_in_progress', 409);
      }

      const consumed = store.consume(approvalId);
      if (!consumed.ok) {
        throw consumed.reason === 'expired'
          ? new CheckError('approval_expired', 410)
          : new CheckError('approval_invalid', 400);
      }

      const npm = getNpm();
      if (!npm.ok) {
        throw new CheckError('check_unavailable', 409, npm.reason);
      }

      active = true;

      try {
        const result = await runCommand(npm.runner, consumed.approval.root, runOptions);

        return {
          checkId: consumed.approval.checkId,
          command: consumed.approval.command,
          ...result,
        };
      } catch (error) {
        if (error instanceof CheckStartError) {
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