# Yapper

Yapper is a self-hosted voice and text communicator for friends, with a longer-term direction toward Discord-like capabilities.

**Stage 4 is closed. Native phone and tablet clients are in development.** Stage 5 stabilization is deferred. See the [implementation roadmap](docs/implementation-plan.md) and the [desktop verification record](docs/evidence/stage-4-desktop.md).

Each installation is an independent community, operated through one Docker Compose project. Its operation does not depend on a central Yapper account service or cloud media provider.

## Documentation

- [Product specification](docs/product.md): agreed scope, user behavior, languages, and platform roadmap.
- [Architecture](docs/architecture.md): service responsibilities, identities, protocols, storage, and deployment boundaries.
- [Implementation plan](docs/implementation-plan.md): ordered stages, dependencies, deliverables, and completion gates.
- [Native mobile plan](docs/stage-6-mobile-plan.md): Android and iOS/iPadOS work sequence, architecture, and acceptance checks.
- [Mobile client builds](apps/mobile/README.md): build and connect the Compose and SwiftUI apps.
- [Validation](docs/validation.md): functional, platform, recovery, and load acceptance scenarios.
- [Development workflow](docs/development.md): repository layout, branches, squash commits, tooling, and local verification.
- [Approved toolchain](docs/toolchain.md): pnpm, Turborepo, standard Vite, Bun runtime boundaries, and multi-language integration.
- [Operations](docs/operations.md): planned installation, updates, backups, diagnostics, and history reset procedure.

The initial plan was approved on 2026-09-28. The [native desktop decision](docs/architecture.md#native-desktop-direction) updates that plan. Each stage has explicit completion criteria. Record changes to product scope, trust boundaries, or hosting requirements in the relevant specification.

## First private release baseline

The first-release scope includes text and voice channels, persistent message history, invitations, moderation, and local administration. Its client targets are Web, including macOS browsers, and native GPUI on Windows and Linux. The Astro landing has Polish and English status pages. The [validation record](docs/validation.md) tracks verified combinations and remaining checks.

The native mobile clients come next, using Kotlin Multiplatform for shared logic, Jetpack Compose on Android, and SwiftUI on iPhone and iPad. The dedicated Swift macOS client follows. The Rust terminal client stays in the later roadmap.

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
