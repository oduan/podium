# Podium

A self-hosted web console for the [pi coding agent](https://pi.dev/). Podium lets
you open a folder in the browser, chat with the agent, and watch it edit files —
much like a hosted coding-agent workspace, but running on your own machine.

Each Podium *session* maps to one pi Session (a JSONL transcript) plus a working
directory. Podium does not store its own conversation history; it drives pi over
its RPC protocol and lets pi own persistence under `~/.pi/agent/sessions/`.

```
Browser
   │  REST (JSON) + WebSocket, Bearer-token auth
   ▼
podium executable (Go backend + embedded React SPA, 127.0.0.1:8000)
   │  one child process per active session, stdin/stdout JSONL
   ▼
pi --mode rpc   (cwd = the session working directory)
```

## Requirements

- Runtime: the `pi` CLI must be installed and available from `PATH`:

  ```sh
  npm install -g @earendil-works/pi-coding-agent@0.82.1   # tested RPC contract
  ```

- Build only: **Go 1.25.12+** and **Node 20.19+ or 22.12+ / npm**.

## Build

Build the frontend first, then compile it into the Go executable:

```sh
cd web
npm ci
npm run build          # outputs to server/internal/webui/dist

cd ../server
go build -trimpath -o podium ./cmd/podium
```

The release artifact is one file: `server/podium` (`server/podium.exe` on
Windows). Node, npm, and loose web assets are not needed at runtime.

## Run

Start the executable directly:

```sh
./server/podium
```

On first start, if no token is configured, Podium generates one and prints it to
stderr (and saves it to `~/.podium/config.json`). Open `http://127.0.0.1:8000`
and paste the token on the login screen.

### Development

Run the backend and the Vite dev server side by side; Vite proxies `/api`
(including the WebSocket) to the Go server on port 8000:

```sh
# terminal 1
cd server && go run ./cmd/podium

# terminal 2
cd web && npm run dev        # http://localhost:5173
```

## Configuration

Settings are resolved with precedence **flags > env (`PODIUM_*`) > `~/.podium/config.json` > defaults**.

| Flag | Env | Default | Description |
|---|---|---|---|
| `--host` | `PODIUM_HOST` | `127.0.0.1` | Listen host (keep on loopback behind a proxy). |
| `--port` | `PODIUM_PORT` | `8000` | Listen port. |
| `--token` | `PODIUM_TOKEN` | *(generated)* | Access token required for all requests. |
| `--data-dir` | `PODIUM_DATA_DIR` | `~/.podium` | Metadata, config, and keys directory. |
| `--workspaces-root` | `PODIUM_WORKSPACES_ROOT` | `~/.podium/workspaces` | Where default (folder-less) sessions are created. |
| `--pi-binary` | `PODIUM_PI_BINARY` | `pi` (from `PATH`) | Path to the pi executable. |
| `--browse-root` | `PODIUM_BROWSE_ROOT` | user home | Root exposed to the "open folder" picker. |
| `--idle-timeout` | `PODIUM_IDLE_TIMEOUT` | `15` | Minutes before an idle pi process is stopped. |
| `--max-processes` | `PODIUM_MAX_PROCESSES` | `5` | Max concurrent pi processes, including temporary model-discovery processes. |
| `--static-dir` | `PODIUM_STATIC_DIR` | embedded UI | Optional directory that overrides the embedded web assets. |

Set `PODIUM_CONFIG` to override the config-file path. Otherwise `--data-dir`
(or `PODIUM_DATA_DIR`) also selects `<data-dir>/config.json`. When no explicit
workspace root is configured, it follows the selected data directory.

## Authentication & API keys

- **Podium access** is protected by a single bearer token (single-user MVP).
- **Provider API keys** are managed in the Settings page and stored server-side in
  `~/.podium/keys.json`. They are injected as environment variables
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, …) into each pi
  subprocess.
- **Subscription logins** (e.g. Claude Pro via `/login`) are *not* handled in the
  web UI. Run `pi` interactively once on the server to complete OAuth; the
  credentials land in `~/.pi/agent/auth.json` and are inherited by every
  subprocess automatically.

## Deploying behind Caddy (HTTPS)

Podium listens on loopback only; terminate TLS with a reverse proxy. WebSocket
upgrades are proxied transparently.

```caddyfile
podium.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

Then run Podium as a service, for example with systemd:

```ini
# /etc/systemd/system/podium.service
[Unit]
Description=Podium (pi web console)
After=network.target

[Service]
ExecStart=/opt/podium/podium
Environment=PODIUM_TOKEN=your-long-random-token
Restart=always
User=podium

[Install]
WantedBy=multi-user.target
```

## Repository layout

```
podium/
├── server/                  # Go backend (module: podium/server)
│   ├── cmd/podium/          # main entrypoint
│   └── internal/
│       ├── webui/          # frontend build embedded with go:embed
│       ├── config/          # configuration loading
│       ├── auth/            # bearer-token middleware
│       ├── pirpc/           # pi RPC subprocess client (JSONL)
│       ├── session/         # session metadata + process lifecycle
│       ├── keys/            # provider API-key storage
│       ├── files/           # sandboxed file tree / reader
│       └── api/             # REST + WebSocket handlers
└── web/                     # React frontend (Vite + TS + Tailwind)
    └── src/
        ├── api/             # REST + WebSocket clients
        ├── stores/          # zustand state + chat model
        ├── components/      # chat, files, shared UI
        └── pages/           # login, sessions, chat, settings
```

## Notes & limitations

- MVP does not expose pi's session fork/tree visualization (the RPC supports it;
  reserved for later).
- Tool-approval prompts are rendered as passthrough modals driven by pi's
  `extension_ui_request` events; Podium implements no approval logic of its own.
