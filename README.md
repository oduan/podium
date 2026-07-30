<p align="center">
  <img src="web/public/icons/podium-icon-192.png" width="112" height="112" alt="Podium icon">
</p>

<h1 align="center">Podium</h1>

<p align="center">
  A self-hosted web workspace for the <a href="https://pi.dev/">pi coding agent</a>.
</p>

<p align="center">
  <a href="https://github.com/oduan/podium/actions/workflows/release.yml"><img src="https://github.com/oduan/podium/actions/workflows/release.yml/badge.svg" alt="Release workflow"></a>
  <a href="https://github.com/oduan/podium/releases/latest"><img src="https://img.shields.io/github/v/release/oduan/podium" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-5e6ad2" alt="Supported platforms">
</p>

Podium runs alongside pi on your own machine. It gives you a browser-based conversation workspace, session navigation, file browsing, live tool output, model selection, and reasoning controls while pi continues to own agent execution and conversation persistence.

## Highlights

- One self-contained executable with the React interface embedded in the Go server.
- Native releases for Windows, Linux, and macOS on both amd64 and arm64.
- Real-time conversation and tool output over WebSocket.
- Sessions map directly to pi session files and working directories.
- No hosted account or external Podium service is required.
- Light and dark themes with a responsive desktop/mobile interface.

## Requirements

Podium does not bundle pi. Install pi first and ensure the `pi` command is available in `PATH`.

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Linux and macOS users can alternatively use pi's official installer:

```sh
curl -fsSL https://pi.dev/install.sh | sh
```

See the [pi quick start](https://pi.dev/docs/latest/quickstart) for current requirements and installation details.

> [!IMPORTANT]
> Provider authentication and model configuration must be completed in pi itself, not in Podium. Run `pi`, use `/login` to authenticate a provider, and use `/model` to select or verify a model. Custom providers and local models belong in `~/.pi/agent/models.json`; see the [pi model documentation](https://pi.dev/docs/latest/models). Podium only displays models that the current pi installation reports as available.

## Install Podium

The installers download the latest GitHub Release for the current operating system and CPU architecture, verify its SHA-256 checksum, and install the `podium` executable.

### Linux and macOS

```sh
curl -fsSL https://raw.githubusercontent.com/oduan/podium/main/scripts/install.sh | sh
```

The default install directory is `~/.local/bin`. If it is not already in `PATH`, the installer prints the required next step.

### Windows

Run the following in PowerShell or Command Prompt:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/oduan/podium/main/scripts/install.ps1 | iex"
```

The installer writes `podium.exe` to `%LOCALAPPDATA%\Podium\bin` and adds that directory to the user `PATH`. Open a new terminal after installation.

To install a specific release instead of the latest one, set `PODIUM_VERSION` to a tag such as `v0.1` before running the installer. Set `PODIUM_INSTALL_DIR` to override the destination directory.

Release archives can also be downloaded manually from [GitHub Releases](https://github.com/oduan/podium/releases/latest).

## Run

Start Podium from a terminal:

```sh
podium
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000). On first launch, Podium generates an access token, prints it in the terminal, and saves it to `~/.podium/config.json`. Paste that token into the login page.

Re-run the same install command whenever you want to update to the latest release.

## How it works

Each Podium session maps to one pi session and one working directory. Podium does not duplicate pi's conversation database; it drives pi through RPC and reads the session data pi stores under `~/.pi/agent/sessions/`.

```text
Browser
   │  REST + WebSocket, bearer-token authentication
   ▼
podium executable (Go server + embedded React app)
   │  one JSONL RPC subprocess per active session
   ▼
pi --mode rpc (session working directory)
```

## Configuration

Settings are resolved in this order: command-line flags, `PODIUM_*` environment variables, `~/.podium/config.json`, then defaults.

| Flag | Environment variable | Default | Description |
|---|---|---|---|
| `--host` | `PODIUM_HOST` | `127.0.0.1` | Listen address. Keep this on loopback unless Podium is protected by a reverse proxy. |
| `--port` | `PODIUM_PORT` | `8000` | HTTP server port. |
| `--token` | `PODIUM_TOKEN` | Generated | Bearer token required by the browser client. |
| `--data-dir` | `PODIUM_DATA_DIR` | `~/.podium` | Podium configuration and session metadata directory. |
| `--workspaces-root` | `PODIUM_WORKSPACES_ROOT` | `~/.podium/workspaces` | Root used for sessions without a selected folder. |
| `--pi-binary` | `PODIUM_PI_BINARY` | `pi` | Path or command used to start pi. |
| `--browse-root` | `PODIUM_BROWSE_ROOT` | User home | Highest directory exposed by the folder picker. |
| `--idle-timeout` | `PODIUM_IDLE_TIMEOUT` | `15` | Minutes before an idle pi process is stopped. |
| `--max-processes` | `PODIUM_MAX_PROCESSES` | `5` | Maximum number of active pi processes. |
| `--static-dir` | `PODIUM_STATIC_DIR` | Embedded UI | Optional directory overriding the embedded web assets. |

Set `PODIUM_CONFIG` to use a different configuration file. When `PODIUM_DATA_DIR` changes and no workspace root is explicitly configured, the default workspace root follows the selected data directory.

## Build from source

Building requires Go 1.25.12 or newer and Node.js 20.19+, 22.12+, or 24. The pi command is only required when running the resulting application.

```sh
cd web
npm ci
npm run build

cd ../server
go test ./...
go build -trimpath -o podium ./cmd/podium
```

The web build is written to `server/internal/webui/dist` and embedded into the Go executable. No loose frontend assets or Node.js runtime are needed after compilation.

For development, run the backend and Vite server separately:

```sh
# terminal 1
cd server
go run ./cmd/podium

# terminal 2
cd web
npm run dev
```

Vite serves [http://localhost:5173](http://localhost:5173) and proxies API and WebSocket traffic to Podium on port `8000`.

## Releases

Pushing a tag whose name starts with `v` triggers [the release workflow](.github/workflows/release.yml). It rebuilds the web interface, runs the Go tests, cross-compiles Podium, creates archives for these targets, generates `checksums.txt`, and publishes a GitHub Release:

- Windows: amd64 and arm64 (`.zip`)
- Linux: amd64 and arm64 (`.tar.gz`)
- macOS: Intel amd64 and Apple Silicon arm64 (`.tar.gz`)

## Security notes

- Podium listens on `127.0.0.1` by default. Use a TLS reverse proxy and keep bearer-token authentication enabled before exposing it to a network.
- The folder picker is restricted by `PODIUM_BROWSE_ROOT`.
- Provider credentials are owned by pi through its auth file or environment variables; Podium does not provide a model-credential editor.
- pi extensions and tools can execute code with the permissions of the user running Podium. Review your pi configuration before exposing the service.

## Repository layout

```text
podium/
├── .github/workflows/       # tag-driven release automation
├── scripts/                 # cross-platform installers
├── server/                  # Go backend and embedded production UI
│   ├── cmd/podium/          # executable entry point
│   └── internal/            # API, auth, config, sessions, pi RPC, web assets
└── web/                     # React + TypeScript frontend
```
