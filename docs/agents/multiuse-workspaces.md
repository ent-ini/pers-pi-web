# Corporate workspace templates and reset

The multiuser admin UI is `components/MultiuseAdmin.tsx`; it must not change personal/single-user behavior. Template CRUD goes through `/api/multi/admin/template/*` to the privileged worker manager. Reset is `POST /api/multi/admin/users/<BPM UUID>/reset-workspace`.

## Contract and ownership

- BPM owns identities. The control plane requires the configured admin origin, same-origin request security, encrypted session, and a **current** BPM admin/tech role. Reset additionally verifies that the target exists in BPM. Neither BPM schema nor worker chat sessions are changed.
- Canonical defaults: `/data/pi-web/templates/default`. `snapshotTemplate()` captures text files and SHA-256 hashes; a deterministic revision includes paths, directories and content hashes. CRUD edits and snapshots are serialized so one reset uses consistent bytes.
- Issued manifest: `/data/pi-web/control/workspace-templates/<employee-uuid>.json`, version 1, revision, appliedAt, entries (path/type/file sha256). It is manager-owned, mode 0600, outside the worker's `agent/` and `workspace/` mounts. Never read a deletion manifest from a worker-controlled path.
- A new workspace gets the current template and a manifest, including for an empty template. Existing workers are **not** silently migrated or assigned ownership over arbitrary files.
- Admin users API exposes only `workspaceTemplate: { revision, appliedAt, trackedFiles } | null`, not the manifest itself. Template tree also exposes current revision. The UI distinguishes current/changed/unknown templates.

## Worker API forwarding

`proxy.ts` preserves the incoming query when rewriting legacy `/api/*` requests to `/api/multi/worker/<uuid>/*`. The worker route must preserve it again on its upstream URL (`target.search = request.nextUrl.search`). Omitting it drops `type=read` (the files endpoint defaults to listing and reports `Not a directory` for files) and `cwd=/workspace` (pins returns 400), as well as download/upload/preview filters. Encode path segments separately and retain query encoding/repeated values. Regression tests: `app/api/multi/worker/worker-route.test.mjs`.

## Reset semantics

1. Serialize ensure/reset per employee, capture the canonical snapshot, stop a running worker (including any active AI turn).
2. Preflight the whole update before touching files. Remove only previously issued file paths, even if an employee edited their contents. Remove old template directories only when empty; never recursively remove a directory that may contain personal files. A file replaced by a user directory is a conflict. New defaults colliding with untracked files/links/directories abort with 409. Shared existing directories are allowed.
3. Back up the entire workspace outside worker mounts. Persist the backup and pending transaction marker before mutating. Preserve the workspace root inode: removing/replacing the bind mount root leaves Docker pointing at an obsolete directory.
4. Apply defaults, set ownership only on new template entries (10001:10001), flush files/directories and atomically persist the new manifest. Clear the pending marker durably, then remove the temporary backup. `agent/` and chat history are not touched.
5. On ordinary IO failure restore the backup **in place**, restore the prior manifest, and restart a worker that was running. Stopped/missing workers stay stopped. Template conflicts leave the old manifest/files unchanged.
6. If rollback fails or a manager restart leaves `<uuid>.json.pending`, preserve the backup and block worker startup/reset until an operator checks it. Any unreadable/corrupt pending marker is also blocking. Never restart into a possibly half-restored workspace.

Reset has a 120-second manager request timeout (not the normal 15 seconds). A lost HTTP response does not cancel a running manager operation. Backup size is the user's full workspace; allow sufficient free disk space. Failures before a pending marker is published may leave an unused backup, but do not modify the workspace.

## Legacy workspaces

Without a previous manifest, reset treats all pre-existing files as personal/unknown: it can install non-conflicting new defaults and starts tracking them, but cannot identify or remove older default files by guesswork. Collisions require the administrator to move/reconcile the existing file first. Both confirmation and successful legacy reset explain this limitation. Never initialize a legacy manifest from the current template alone: earlier template versions may have different names/content.

## Interrupted transaction recovery (operator only)

Keep the worker stopped. The manager-owned pending JSON records `backup`, `previous` and `next`. Check the backup and workspace before choosing a complete rollback or accepting a verified complete new revision. Restore files **inside** the existing workspace mountpoint (do not swap/delete the mountpoint), restore the matching manifest/ownership, and only then remove the pending marker and start the worker. Do not simply delete the marker to get past an error. There is deliberately no browser action that discards this recovery information.

## Verification

- `node --test multiuse-manager/*.test.mjs`: selective deletion, modified defaults, nested personal files, rename/type transitions, conflicts, rollback, links, invalid/pending manifests, legacy initialization, empty templates, per-user isolation and lifecycle serialization.
- `node --experimental-strip-types --test app/api/multi/admin/admin-route.test.mjs lib/multiuse-admin-users.test.mjs`: live authorization, wrong host/origin, removed employee, manager conflicts, metadata validation.
- Build only in an isolated worktree. Browser checks should intercept/mock corporate API in a separate browser context; never reset a real employee for a smoke test.
