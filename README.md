# Yapper

Yapper is a self-hosted voice and text communicator for friends, with a longer-term direction toward Discord-like capabilities.

**Stage 2 has passed acceptance.** The community features and the Windows/Linux GPUI prototype are implemented. See the [Stage 2 acceptance record](docs/evidence/stage-2-acceptance.md).

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

The first private release is planned to include text and voice channels, persistent message history, invitations, moderation, and local administration. The target clients are desktop and mobile browsers, including browsers on macOS, and native Rust/GPUI on Windows and Linux. The Astro landing currently has Polish and English status pages. Download links and installation guidance are part of release preparation.

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

Integration tests create disposable schemas/accounts in the development databases and exercise local LiveKit. Never point them at production. `pnpm build` builds clients and services. See the [GPUI prototype](apps/desktop-gpui/README.md) for native build and smoke-test instructions.

The existing GitHub repository is retained; its default branch now has a new root history. See [reset evidence](docs/evidence/stage-0.md#repository-reset).
