# ANIRA

A JARVIS-inspired desktop assistant built around one guarded loop:

**INSPECT → PLAN → APPROVE → EXECUTE → VERIFY → RECOVER/UNDO**

This repository is the **scaffold milestone**. It ships a working dashboard, a backend health
check, read-only repository inspection, evidence-backed plan reports, and **one explicitly
approved project check**. It does **not** edit files, execute plan steps, run arbitrary commands,
control the desktop, capture voice, or call any model.

> **Scope notice:** proposed plan steps are drafts and are never executed. Activity entries are
> real UI events from this session. A verification result is real only after you approve and run
> the single allowlisted check.

## Workflow status

| Stage | Status | What actually happens |
| --- | --- | --- |
| Inspect | **Implemented** | Scans an absolute folder (metadata only), skips `node_modules`, `.git`, `dist`, `build`, caps the scan, and detects stack signals from file names. |
| Plan | **Implemented, deterministic** | Keyword constraints plus scan facts produce a draft report with facts, inferences, limits, and proposed steps. No model is called. |
| Approve | **Check only** | The server issues a single-use, 2-minute approval for `node-test`. Plan-step approval is not implemented. |
| Execute | **Check only** | Runs the fixed `npm test` command once, with no shell, a 60 s timeout, and a 128 KB output cap. Plan-step execution is not implemented. |
| Verify | **Check only** | Shows the real exit code, duration, stdout, and stderr. A clean exit 0 is the only pass. It verifies the repository test command, not every proposed plan step. |
| Recover/Undo | **Partial** | Undo is not applicable because ANIRA makes no changes. After a failed or timed-out check, the consumed approval must be replaced by preparing a new check. |

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

The API binds to `127.0.0.1` by default. Override with `HOST` and `PORT` if you need a different
interface or port:

```bash
HOST=0.0.0.0 PORT=4000 npm run dev:server
```

Expose it beyond loopback only behind a reverse proxy with authentication.

The Vite dev server proxies `/api` to `http://127.0.0.1:4000`, so the dashboard's health pill uses
the same relative URL in development.

Run them separately if you prefer:

```bash
npm run dev:server
npm run dev:client
```

## Checks and build

```bash
npm run check   # TypeScript, both packages (including API tests)
npm run build   # server to server/dist, client to client/dist
npm test        # API tests (node:test + tsx)
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
│   │   ├── workflow.ts    derived six-stage workflow state
│   │   ├── index.css      Tailwind theme and global styles
│   │   └── types.ts       shared client types
│   ├── index.html
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── checks/        catalog, approvals, npm resolver, runner, service
│   │   ├── routes/health.ts
│   │   ├── routes/inspect.ts
│   │   ├── routes/checks.ts
│   │   ├── services/inspectRepository.ts
│   │   ├── app.ts
│   │   └── index.ts
│   ├── tests/app.test.ts
│   ├── tests/inspect.test.ts
│   ├── tests/checks.test.ts
│   └── tsconfig.test.json
├── package.json
└── README.md
```

## Deliberately not included

- LLM or model provider calls
- Voice input or speech synthesis
- Desktop control, screen capture, or UI automation
- Arbitrary shell execution or request-supplied commands
- Plan-step execution, file edits by ANIRA, or undo/rollback
- Scheduling, background runs, automatic execution, or cancellation
- Persistence, authentication, or a database
- Remote hosting, tunnels, or multi-user access

These are later milestones. The UI distinguishes proposed plan steps from the one implemented
check, and never presents a non-zero or interrupted run as passed.