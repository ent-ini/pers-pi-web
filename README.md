# Pi Web

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

Browser UI for the [pi coding agent](https://github.com/earendil-works/pi).

This fork supports two deliberately separate runtime modes:

- **`single`** (default) is the normal personal Pi Web. It uses the local Pi configuration, sessions, credentials, and working directories of the account that starts it.
- **`multi`** is the corporate control plane used with BuhgalterBPM. Employees authenticate through BPM; every employee is routed to a separate, unprivileged Pi worker container with its own agent state and `/workspace`.

The modes do not share agent data. `single` remains the right choice for an individual local installation.

**[Try the interactive demo →](https://agegr.github.io/pi-web/)** The real Pi Web UI runs entirely in your browser, with sample sessions, files and models. There is nothing to install; replies are pre-written and no model is called.

![Pi Web displaying a pi session with structured Markdown, tool calls, and project navigation](https://raw.githubusercontent.com/agegr/pi-web/main/docs/screenshot2.png)

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Web-based configuration**: in `single` mode, manage provider login and API keys, models, model tests, plugin packages, and skills without leaving Pi Web.
- **Corporate isolation (`multi`)**: BPM authentication, an encrypted HttpOnly session, and a per-employee worker/container. The control plane never serves its own personal Pi data to an employee.
- **English, Simplified Chinese, and Traditional Chinese UI**: Pi Web follows the browser language initially and provides a language switcher in the top bar.

## Single-user Quick Start

`single` is the default mode and requires Node.js 22.19.0 or newer. The upstream npm package can be used for an ordinary personal installation:

```bash
npx @agegr/pi-web@latest
```

The CLI opens a browser after the server is ready. If it does not, open [http://127.0.0.1:30141](http://127.0.0.1:30141). Pi Web listens only on `127.0.0.1` by default.

To run this fork, including the `multi` implementation, clone and build it instead:

```bash
git clone https://github.com/ent-ini/pers-pi-web.git
cd pers-pi-web
npm ci
npm run build
node bin/pi-web.js --mode single
```

If no model provider is configured yet, open the **Models** panel to sign in or add an API key. To install the upstream `pi-web` command globally, use `npm install -g @agegr/pi-web@latest`.

## Configuration

For port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `pi-web --help` (or `-h`) to print startup options and exit without starting the server. Unknown options exit with an error.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `--mode <single|multi>` or `PI_WEB_MODE` | Operating mode (`multi` is reserved for the corporate deployment) | `single` |
| `PI_WEB_BPM_API_URL` | BPM origin used for corporate authentication; required in `multi` | — |
| `PI_WEB_MULTI_SESSION_SECRET` | Random 32+ character secret used to encrypt corporate HttpOnly sessions; required in `multi` | — |
| `PI_WEB_MULTI_SESSION_COOKIE_DOMAIN` | Optional shared cookie domain, e.g. `.example.com` for `ai` and `admin` subdomains | Unset |
| `PI_WEB_ADMIN_HOST` | Exact separate hostname permitted to serve the corporate admin UI | Unset |
| `PI_WEB_WORKER_MANAGER_URL` | Internal URL of the worker manager; required by the multiuser control plane | — |
| `PI_WEB_WORKER_MANAGER_SECRET` | Random 32+ character credential between the control plane and worker manager; required in `multi` | — |
| `PI_WEB_DEFAULT_CWD` | Default directory for a worker; set internally to `/workspace` | Unset |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable Pi Web update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |

For example:

```bash
pi-web --help
pi-web -p 8080 -H 0.0.0.0 --no-open
```

## Corporate (`multi`) deployment

`multi` is not a flag for exposing a personal installation to several people. It requires a BPM-compatible identity endpoint (`GET /api/integrations/pi-web/me`) and the companion worker manager defined in [`docker-compose.multi.yml`](./docker-compose.multi.yml).

Create a protected `.env.multi` next to the compose file:

```env
PI_WEB_BPM_API_URL=https://bpm.example.com
PI_WEB_MULTI_SESSION_SECRET=<32+ random characters>
PI_WEB_WORKER_MANAGER_SECRET=<different 32+ random characters>
PI_WEB_ALLOWED_HOSTS=ai.example.com
```

Generate the secrets with `openssl rand -base64 48`. Build and start the control plane plus manager:

```bash
docker compose -f docker-compose.multi.yml up -d --build
```

The compose file is the deployment profile used on `boffice`: it binds port `30141` to the configured Tailscale address and expects an HTTPS reverse proxy in front of it. Adapt the published address, DNS, TLS, limits, and BPM URL for another environment. Do not publish worker ports or mount the Docker socket into workers; only `worker-manager` has Docker authority.

On first successful BPM login, the manager creates `/data/pi-web/users/<employee-uuid>/{agent,workspace}` and starts that employee's worker. Workers run as an unprivileged user with a read-only root filesystem, CPU/RAM/PID limits, and only a private Docker network. The current MVP does **not** yet provide corporate provider/model assignment or an admin control plane; a worker therefore has no shared model credential by default.

### Remote Access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' pi-web --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose Pi Web over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address Pi Web binds to.

### HTTP Proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## Notes

- **Agent data in `single`**: Pi Web reads Pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another Pi agent directory.
- **Agent data in `multi`**: the control plane does not read employee session files. Each worker has a separate `agent/` directory and `/workspace` under `/data/pi-web/users/<employee-uuid>/` on the deployment host.
- **Filesystem access**: in `single`, run Pi Web in the same filesystem environment as Pi when sharing existing sessions. In `multi`, the worker sees only its mounted state and workspace.
- **Shared configuration**: in `single`, the Models panel uses Pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in Pi Web and session roots it already knows about; it is not a general filesystem browser.

### Downstream Session Context Menu

Electron wrappers and other downstream integrations can provide a session-row
context menu without patching `SessionSidebar`. Listen for the cancelable
`pi-web:session-row-contextmenu` browser event and call `preventDefault()`
synchronously when the integration will handle it:

```js
window.addEventListener("pi-web:session-row-contextmenu", (event) => {
  event.preventDefault();
  const { id, path, cwd, name, clientX, clientY, refresh } = event.detail;

  void openSessionMenu({ id, path, cwd, name, clientX, clientY }).then((changed) => {
    if (changed) refresh();
  });
});
```

The detail object contains `id`, `path`, `cwd`, optional `name`, pointer
coordinates, and a `refresh()` callback for actions that change the session
list. If no listener cancels the extension event, Pi Web preserves the
browser's native context menu. This hook is browser-side and independent of
Pi agent extensions.

### Extension Session Liveness

Server-side Pi extensions with detached work can prevent automatic idle
session eviction through the versioned global registry:

```js
const liveness = globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")];
const release = liveness?.version === 1
  ? liveness.register({
      name: "my-extension",
      sessionId,
      sessionFile: sessionFile || undefined,
      isActive: () => detachedJobs.size > 0,
    })
  : () => {};
```

Register once per active extension session and call the returned idempotent
`release` function on session shutdown, replacement, or reload. `isActive`
must be synchronous, cheap, and scoped to the supplied exact session id or
file. Provider errors fail safe by preserving that session. This lease only
affects automatic idle eviction; explicit shutdown and Stop fallback cleanup
still take precedence.

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development. It writes to `.next/` and can interfere with the development server; leave builds for release work.

Contributor guides: [Internationalization](./docs/i18n.md) and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint and launch option parsing
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE)
