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

Browser POST/PUT/PATCH requests include the public HTTPS `Origin`, whereas a worker receives an internal HTTP `Host`. The worker route first validates the original request with `isApiRequestAllowed()` (in addition to the outer proxy), then rewrites an existing Origin to `target.origin`. Do not merely remove/rewrite Origin before checking it: that would hide malicious cross-site requests. Requests without Origin retain that absence; corporate cookies, Authorization and x-forwarded headers never reach workers. Tests exercise the real worker Host/Origin validator, including TLS reverse-proxy headers and rejection before worker provisioning.

`fetch` transparently decodes gzip/br/deflate but keeps upstream `Content-Encoding`. Strip it (and the old Content-Length) before returning `upstream.body`, otherwise Firefox/Safari decode it twice (`NS_ERROR_INVALID_CONTENT_ENCODING`, `TypeError: Decoding failed`). Request `Accept-Encoding: identity` on the internal hop; the public reverse proxy may negotiate compression independently. The proxy regression test uses a real gzipped HTTP response, not just a fabricated JSON Response.

## Worker image upgrades are not workspace resets

Docker containers retain an immutable image ID even when the deployment's `:latest` tag moves. On each ensure, manager resolves the configured image tag and compares it with container `Image`. A mismatch is replaced under the per-employee ensure/reset lock: stop/rename old container, create the original name on the resolved immutable ID with **the same agent/workspace bind mounts**, start and wait for readiness, then delete the stopped previous container. No template reset, directory replacement, key copying or data deletion occurs. A deployment can interrupt an active AI turn; persistent chats/files/credentials remain. Ensure's control-plane timeout is 45 seconds to allow stop/readiness/rollback.

Creation/readiness failure rolls back to the previous container/name and its prior running/stopped state. A stopped previous container is retained for operator recovery if cleanup/rollback fails. See `multiuse-manager/worker-image.mjs` and its lifecycle tests.

This also prevents frontend/worker SDK drift: the old 0.87.1 worker lacked `/api/sessions/ui-state` and `/api/open-in-explorer`, and its long-lived auth state could miss keys saved after chat creation. SDK 1.1.0 rereads changed credentials; `lib/provider-credential-store.test.mjs` pins saving/replacing/removing a key against the **same** ModelRuntime without restarting a chat. Never change or expose the user's real API key as a workaround.

## Provider egress

An internal-only Docker network prevents both provider HTTPS and external DNS (`EAI_AGAIN`), even when credentials are correct. Manager lazily creates/verifies `PI_WEB_WORKER_EGRESS_NETWORK` (default `pi-web-egress`), a labelled NAT bridge with `enable_icc=false`, and attaches workers at ensure/start time. Control-plane/manager stay off this bridge; their worker traffic continues over `pi-web-internal`. No worker port is published. Missing egress on a running worker is repaired without replacing it or touching its data. Internal, unlabelled, ICC-enabled or explicitly non-masquerading networks fail validation instead of being reused silently. This is outbound internet access, **not** a provider/domain allowlist; egress restrictions beyond that are a separate policy task.

Sources: [Docker bridge options](https://docs.docker.com/engine/network/drivers/bridge/), [connect a running container](https://docs.docker.com/reference/cli/docker/network/connect/). Network lifecycle regressions: `multiuse-manager/worker-network.test.mjs`.

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
