# Yapper

Yapper is a self-hosted voice and text communicator for friends, with a longer-term direction toward Discord-like capabilities.

**Stage 1 is in acceptance testing.** The foundation and first conversation implementation are merged. Local setup, chat, voice admission, TURN/TLS and the Electron development client on macOS have test evidence. The next milestone is a two-person call with real microphones on a publicly reachable test server, including TURN fallback and recovery after a network interruption. The macOS Electron development package still needs installation checks. See the [current status and acceptance steps](docs/evidence/stage-1.md#current-status).

Each installation is an independent community, operated through one Docker Compose project. Its operation does not depend on a central Yapper account service or cloud media provider.

## Documentation

- [Product specification](docs/product.md): agreed scope, user behavior, languages, and platform roadmap.
- [Architecture](docs/architecture.md): service responsibilities, identities, protocols, storage, and deployment boundaries.
- [Implementation plan](docs/implementation-plan.md): ordered stages, dependencies, deliverables, and completion gates.
- [Validation](docs/validation.md): functional, platform, recovery, and load acceptance scenarios.
- [Development workflow](docs/development.md): repository layout, branches, squash commits, tooling, and local verification.
- [Approved toolchain](docs/toolchain.md): pnpm, Turborepo, standard Vite, Bun runtime boundaries, and multi-language integration.
- [Operations](docs/operations.md): planned installation, updates, backups, diagnostics, and history reset procedure.

The initial plan was approved on 2026-09-28. The [native desktop decision](docs/architecture.md#native-desktop-direction) updates that plan. Each stage has explicit completion criteria. Record changes to product scope, trust boundaries, or hosting requirements in the relevant specification.

## Planned first private release

The first private release is planned to include text and voice channels, persistent message history, invitations, moderation, and local administration. The target clients are desktop and mobile browsers, Rust/GPUI on Windows and Linux, and Electron on macOS. The Astro landing currently has Polish and English status pages. Download links and installation guidance are part of release preparation.

Native mobile clients, a Rust terminal client, and a dedicated Swift macOS client follow after the first release is stabilized. Additional communication features are prioritized from real usage.

## Local development

Install the versions in `.node-version`, `.bun-version`, `.go-version`, and `package.json`. Then:

```sh
pnpm install --frozen-lockfile
pnpm setup:dev
docker compose -f compose.dev.yaml up -d --wait
pnpm migrate:auth
pnpm migrate:server
pnpm dev
```

Open `http://127.0.0.1:5173`. Use the host-local setup token from `.env` to create the owner, then log in and create invitations. Keep that token private. The Astro status page runs on port 4321. Generated `.env` credentials remain local. Setup refuses to overwrite an existing environment.

```sh
pnpm check
pnpm test:integration
```

Integration tests create disposable schemas/accounts in the development databases and exercise local LiveKit. Never point them at production. `pnpm build` builds clients and services. For a local Electron smoke launch, run `pnpm --filter @yapper/desktop exec install-electron` once, then `pnpm --filter @yapper/desktop start`. This is not an installer or release package. Electron serves its bundled renderer and API gateway from one loopback HTTP origin. Select the server in the application; credentials remain isolated in the main process. The foundation-only `YAPPER_API_ORIGIN` preview setting is superseded by this server picker.

The existing GitHub repository is retained; its default branch now has a new root history. See [reset evidence](docs/evidence/stage-0.md#repository-reset).
