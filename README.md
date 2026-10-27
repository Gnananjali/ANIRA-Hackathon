# ANIRA

A JARVIS-inspired desktop assistant built around one guarded loop:

**INSPECT → PLAN → APPROVE → EXECUTE → VERIFY → RECOVER/UNDO**

This repository is the **scaffold milestone**. It ships a working dashboard, a backend health
check, read-only repository inspection, evidence-backed plan reports, **one explicitly approved
project check**, and **one explicitly approved single-file edit**. It never writes files without a
previewed, server-validated approval, and it does not execute plan steps, run arbitrary commands,
control the desktop, capture voice, or call any model.

> **Scope notice:** proposed plan steps are drafts and are never executed. Activity entries are
> real UI events from this session. A verification result is real only after you approve and run
> the single allowlisted check. A file edit is real only after you approve a server-generated
> diff; undo is in memory and expires after 10 minutes.

## Workflow status

| Stage | Status | What actually happens |
| --- | --- | --- |
| Inspect | **Implemented** | Scans an absolute folder (metadata only), skips `node_modules`, `.git`, `dist`, `build`, caps the scan, and detects stack signals from file names. |
| Plan | **Implemented, deterministic** | Keyword constraints plus scan facts produce a draft report with facts, inferences, limits, and proposed steps. No model is called. |
| Approve | **Check and edit** | Two separate single-use approvals: a 2-minute check approval, and a 2-minute edit preview bound to root, path, and before/after hashes. Plan-step approval is not implemented. |
| Execute | **Check and edit** | Runs the fixed `npm test` once, or applies one approved single-file find/replace. No shell; no plan-step execution. |
| Verify | **Check and edit** | Shows the real exit code/output for the check, or the server-generated diff and before/after hashes for an edit. The check verifies the repository test command, not every proposed plan step. |
| Recover/Undo | **Partial** | Check retry requires a new approval. An applied edit can be rolled back from an in-memory copy for 10 minutes; a server restart invalidates it. |

The six-stage strip tracks the check lane. Controlled edits use a separate approval loop in the UI
and never execute plan steps.

## Stack

- **Client:** React 19, Vite 8, TypeScript 5.9, Tailwind CSS 4
- **Server:** Node.js, Express 5, TypeScript, `tsx` for development
- **Workspace:** npm workspaces (`client`, `server`)

## Requirements

- Node.js >= 20.19 (tested on Node 24)
- npm >= 10

## Install

```bash
npm install
```

## Develop

Run both services with one command:

```bash
npm run dev
```

- Dashboard: <http://localhost:5173>
- API: <http://127.0.0.1:4000>
- Health: <http://127.0.0.1:4000/api/health>

The API binds to `127.0.0.1`. Do **not** set `HOST` to a non-loopback address: there is no
authentication, and the inspection, check, and edit endpoints can read and write local files. Use
`PORT` only if you need a different local port.

The Vite dev server proxies `/api` to `http://127.0.0.1:4000`, so the dashboard's health pill uses
the same relative URL in development.

Run them separately if you prefer:

```bash
npm run dev:server
npm run dev:client
```

## Checks and build

```bash
npm run check   # TypeScript, both packages (includes test files)
npm run build   # server to server/dist, client to client/dist
npm test        # server and client tests (node:test + tsx)
npm start       # serve the built API on :4000
```

## API error contract

Malformed and oversized request bodies return small JSON errors and never include stack traces,
file paths, or upstream messages:

| Case | Status | Body |
| --- | --- | --- |
| Unknown route | 404 | `{"error":"not_found"}` |
| Malformed JSON | 400 | `{"error":"invalid_json"}` |
| Body over 64 KB | 413 | `{"error":"payload_too_large"}` |
| Unexpected failure | 500 | `{"error":"internal_error"}` |

## Health endpoint

`GET /api/health`

```json
{
  "status": "ok",
  "service": "anira-server",
  "mode": "scaffold",
  "version": "0.1.0",
  "uptimeSeconds": 12,
  "timestamp": "2026-10-26T12:00:00.000Z",
  "capabilities": {
    "execution": false,
    "llm": false,
    "voice": false,
    "desktopControl": false
  }
}
```

## Repository inspection

`POST /api/inspect` takes an absolute folder path and returns a read-only inventory:

```json
{ "path": "C:\\dev\\my-project" }
```

It returns relative file paths, sizes, detected stack signals, and language counts. It **never**
opens file contents, writes files, or executes anything. Symbolic links are not followed,
`..` traversal is rejected, and every entry is verified to stay inside the selected root.
`node_modules`, `.git`, `dist`, and `build` are skipped. Scans stop at 2,000 files, 5,000
directories, or 12 levels deep, and set `truncated: true`.

Because the endpoint reads local paths, it is intended for the loopback-only API. Do not expose
it on a public interface.

| Case | Status | Body |
| --- | --- | --- |
| Not an absolute/local path | 400 | `{"error":"invalid_path"}` |
| Path does not exist | 404 | `{"error":"not_found"}` |
| Path is a file | 400 | `{"error":"not_a_directory"}` |
| Permission denied | 403 | `{"error":"access_denied"}` |

## Project check

The Verification panel can run exactly one command: **`npm test`** in the inspected folder. It is
Windows-only in this build. Nothing runs automatically; the flow is two explicit steps.

1. `POST /api/checks/prepare` with `{ "root": "C:\\dev\\my-project", "checkId": "node-test" }`
   validates the folder, confirms `package.json` has a `test` script, and issues a single-use
   approval that expires after **2 minutes**.
2. `POST /api/checks/run` with `{ "approvalId": "…" }` consumes that approval and runs the fixed
   command once.

Both endpoints require the `X-ANIRA-Approval: 1` header and reject unknown origins.

> **Warning:** `npm test` executes repository code and may create or modify files. The allowlist
> controls which command runs, not what the project's test script does. ANIRA itself never edits
> files or runs arbitrary commands.

> **Local-only:** the API has no authentication. It binds to `127.0.0.1` and must not be exposed
> through a tunnel, reverse proxy, or public host. Doing so would let anyone scan local folders and
> run `npm test` in them.

Safety properties:

- The request never carries a command or arguments; the server maps `node-test` to `npm test`.
- `npm` and `node` are resolved to absolute paths outside the project, and the child is spawned
  with `shell: false`, so a package-local `npm.cmd` cannot hijack the run.
- Approvals are single-use, bound to the resolved root, and expire. Only one run is active at a
  time.
- The child gets a small environment (no parent API keys or `NODE_OPTIONS`), an isolated npm cache,
  a **60 s** timeout with process-tree kill, and a **128 KB** output cap.
- Results report the real `exitCode` and `timedOut`; a non-zero or interrupted run is never shown
  as passed.

| Case | Status | Body |
| --- | --- | --- |
| Unknown check | 400 | `{"error":"check_not_found"}` |
| No `package.json` / no test script | 409 | `{"error":"check_unavailable","reason":"missing_manifest"}` |
| Expired approval | 410 | `{"error":"approval_expired"}` |
| Reused or unknown approval | 400 | `{"error":"approval_invalid"}` |
| Another run active | 409 | `{"error":"run_in_progress"}` |
| Spawn failure | 500 | `{"error":"check_failed_to_start"}` |

## Controlled edit

The Controlled edit panel changes **one existing UTF-8 text file** with **one unique
find/replace**. The client sends only the path and the two snippets; the server reads the file,
generates the diff, and stores the original bytes.

1. `POST /api/edits/prepare` with `{ "root": "C:\\dev\\my-project", "path": "README.md", "find": "old", "replace": "new" }`
   validates the real path and parent, rejects symlinks and ignored folders, requires exactly one
   match, and returns a server-generated diff plus `beforeHash`/`afterHash`. The approval expires
   after **2 minutes**.
2. `POST /api/edits/apply` with `{ "editId": "…" }` revalidates the real path and the current
   hash immediately before writing. A mismatch returns `409 file_changed`; the file is never
   overwritten. Writes go through a temporary file in the same directory and are cleaned up on
   failure.
3. `POST /api/edits/rollback` with `{ "rollbackId": "…" }` restores the original bytes only if the
   current hash still matches `afterHash`. After writing, the server re-reads the file and verifies
   its SHA-256 against the original before reporting success (`verifiedHash: true`). A mismatch
   returns `500 rollback_verification_failed` and records recovery as failed. The undo record lives
   in server memory for **10 minutes** and is single-use. **A server restart invalidates undo.**

Both endpoints require `X-ANIRA-Approval: 1` and the same Origin allowlist as the check. Only one
edit apply/rollback runs at a time.

Limits and refusals:

- One file per operation; no create, delete, rename, or multi-file changes.
- File ≤ 256 KB, valid UTF-8, no NUL bytes. Binary and invalid encodings are rejected.
- BOM and line endings are preserved byte-for-byte; only the matched bytes change.
- Paths must be relative, with no `.`/`..` segments, no drive or UNC prefix, and no
  `node_modules`, `.git`, `dist`, or `build` segment.
- Symlinked files and symlinked parent folders are rejected.
- `find` must occur exactly once; zero matches or multiple matches are refused.

| Case | Status | Body |
| --- | --- | --- |
| Bad path, traversal, ignored folder, symlink | 400 | `{"error":"invalid_path"}` / `"ignored_path"` / `"unsafe_path"` |
| Binary, invalid UTF-8, over 256 KB | 400 | `{"error":"unsupported_file","reason":"binary"}` |
| No match / multiple matches / no change | 400 | `{"error":"no_match"}` / `"ambiguous_change"` / `"no_change"` |
| File changed after preview | 409 | `{"error":"file_changed"}` |
| Restored hash mismatch | 500 | `{"error":"rollback_verification_failed","reason":"hash_mismatch"}` |
| Expired approval / rollback | 410 | `{"error":"approval_expired"}` / `"rollback_expired"` |
| Write failure | 500 | `{"error":"write_failed"}` |

> **Warning:** this is the first feature that writes files. It is local-only, has no
> authentication, and can restore from memory only until the rollback window or a server restart.
> Do not expose the API.

## Proof of Work evidence

The server records typed evidence events only at the boundary where an operation actually happens:
inspection, planning, approval, edit application, verification, recovery, and failures. A planned
step is recorded as `planned`, not executed; a prepared approval is not reported as approved; and
a successful `npm test` records `verified` for that command only, with
`coversPlanSteps: false`. A recovery is recorded as `recovered` only after the restored file is
re-read and its SHA-256 matches the original; the event carries `verifiedHash: true`.

- `GET /api/evidence` is read-only. There is no endpoint that accepts events, so the UI cannot
  submit a fabricated event and have it treated as proof.
- Events are scoped by the `X-ANIRA-Session` header and kept in bounded server memory: 100 events
  per session, 32 sessions, and 4 KiB of sanitized stdout/stderr per stream.
- Edits record the relative path and SHA-256 hashes, never file contents. Output is stripped of
  ANSI control characters and redacted for common secret patterns before it is capped.
- Deterministic fallback plans are assembled in the client. The server records the fallback signal,
  inspection, and server-observed operations; it does not record each client-built fallback step.
- Output redaction is best-effort, and a bounded excerpt can still contain repository output.
- **Limitations:** events are lost on server restart. This is not tamper-proof or durable audit
  storage; the session header is not a credential. A local client can perform real operations, so
  the timeline is proof of observed work, not an authenticated audit trail.

## Project layout

```
.
├── client/
│   ├── src/
│   │   ├── components/    dashboard panels and UI primitives
│   │   ├── hooks/         useHealth polling hook
│   │   ├── App.tsx        layout and local UI state
│   │   ├── checkFormat.ts exit-code and duration formatting
│   │   ├── demoData.ts    deterministic plan/report builder
│   │   ├── editFormat.ts  edit error messages and hash formatting
│   │   ├── evidenceSession.ts browser-session evidence scope
│   │   ├── workflow.ts    derived six-stage workflow state
│   │   ├── index.css      Tailwind theme and global styles
│   │   └── types.ts       shared client types
│   ├── index.html
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── checks/        catalog, approvals, npm resolver, runner, service
│   │   ├── edits/         path safety, preview, atomic writer, service
│   │   ├── evidence/      typed events, sanitizer, bounded session store
│   │   ├── routes/health.ts
│   │   ├── routes/inspect.ts
│   │   ├── routes/checks.ts
│   │   ├── routes/edits.ts
│   │   ├── routes/evidence.ts
│   │   ├── routes/guard.ts
│   │   ├── services/inspectRepository.ts
│   │   ├── app.ts
│   │   └── index.ts
│   ├── tests/app.test.ts
│   ├── tests/inspect.test.ts
│   ├── tests/checks.test.ts
│   ├── tests/evidence.test.ts
│   └── tsconfig.test.json
├── package.json
└── README.md
```

## Deliberately not included

- Voice input or speech synthesis
- Desktop control, screen capture, or UI automation
- Arbitrary shell execution or request-supplied commands
- Plan-step execution
- Multi-file edits, file creation, deletion, rename, or binary/oversized files
- Durable rollback or durable, tamper-proof audit storage (undo and evidence are in memory only)
- Scheduling, background runs, automatic execution, or cancellation
- Persistence, authentication, or a database
- Remote hosting, tunnels, or multi-user access

These are later milestones. The UI distinguishes proposed plan steps from the one implemented
check, and never presents a non-zero or interrupted run as passed.