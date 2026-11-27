# Yapper

Yapper is a self-hosted voice and text communicator for friends. Each installation is an independent community run through Docker Compose, with local accounts, persistent chat history, and self-hosted LiveKit voice.

## Clients

| Client                              | Current status                                                                                                 | Build or acceptance                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Web                                 | React client for setup, chat, voice, and community administration. Part of the first private release baseline. | [Browser and desktop acceptance](docs/validation.md#platform-matrix) |
| Windows and Linux                   | Native Rust/GPUI client for chat, voice, and saved servers. Part of the first private release baseline.        | [GPUI builds](apps/desktop-gpui/README.md)                           |
| Android, iPhone, and iPad           | Native Compose and SwiftUI clients with shared Kotlin logic. Emulator and simulator results are recorded.      | [Mobile builds](apps/mobile/README.md)                               |
| macOS                               | Native SwiftUI client builds on Apple Silicon for macOS 26 or later.                                           | [macOS builds and Web transition](apps/macos/README.md)              |
| macOS, Linux, and Windows terminals | Rust/Ratatui client for guest chat and voice. Platform acceptance is ongoing.                                  | [Terminal client builds](apps/terminal/README.md)                    |

The [implementation roadmap](docs/implementation-plan.md) tracks stage status. Stage 4 is closed, Stage 5 is deferred, and native mobile and macOS acceptance is ongoing. The [validation record](docs/validation.md) lists tested environments and open checks.

## Local development

Install the versions in `.node-version`, `.bun-version`, `.go-version`, and `package.json`. From the repository root, run the following for a fresh disposable environment.

```sh
pnpm install --frozen-lockfile
pnpm setup:dev
docker compose -f compose.dev.yaml up -d --wait
pnpm migrate:auth
pnpm migrate:server
pnpm dev
```

Open `http://127.0.0.1:5173`. Use the host-local setup token from `.env` to create the owner, then sign in and create invitations. Keep the token and generated credentials private. Setup preserves an existing `.env`. The bilingual Astro status page runs on port 4321.

```sh
pnpm check
pnpm test:integration
```

Integration tests use disposable schemas and accounts in the development databases and exercise local LiveKit. Run them only against a development installation. The native clients use their own build commands above. See the [development workflow](docs/development.md) for browser tests and Go and Rust verification.

## Documentation

- [Product specification](docs/product.md) for scope, user behavior, language, and platform decisions.
- [Architecture](docs/architecture.md) and [protocol contracts](docs/contracts.md) for service boundaries, identity, application events, and media admission.
- [Development workflow](docs/development.md) and [toolchain](docs/toolchain.md) for repository layout, dependency ownership, and local checks.
- [Operations](docs/operations.md) for installation, upgrades, backup and restore, and diagnostics.
