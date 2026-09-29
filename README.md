# Yapper

Yapper is a self-hosted voice and text communicator for friends, with a longer-term direction toward Discord-like capabilities.

**Status:** Stage 0 foundation under verification. AUTH/Go interoperability, monorepo checks and development scaffolds exist. Chat, voice and production installation are not ready. See [evidence](docs/evidence/stage-0.md).

Each installation is an independent community, operated through one Docker Compose project. Its operation does not depend on a central Yapper account service or cloud media provider.

## Documentation

- [Product specification](docs/product.md): agreed scope, user behavior, languages, and platform roadmap.
- [Architecture](docs/architecture.md): service responsibilities, identities, protocols, storage, and deployment boundaries.
- [Implementation plan](docs/implementation-plan.md): ordered stages, dependencies, deliverables, and completion gates.
- [Validation](docs/validation.md): functional, platform, recovery, and load acceptance scenarios.
- [Development workflow](docs/development.md): repository layout, branches, squash commits, tooling, and CI.
- [Approved toolchain](docs/toolchain.md): pnpm, Turborepo, standard Vite, Bun runtime boundaries, and multi-language integration.
- [Operations](docs/operations.md): planned installation, updates, backups, diagnostics, and history reset procedure.

The plan was approved on 2026-09-28. Stages are based on completion criteria, without weekly deadlines. Technical defaults are implementation proposals within the approved architecture; changes to product scope, trust boundaries, or hosting requirements must be recorded explicitly.

## First release

The first private release provides text and voice channels, persistent message history, invitations, moderation, and local administration. A responsive React client supports desktop and mobile browsers; Electron supports Windows and macOS. An Astro landing page supports Polish and English.

Native mobile clients, a Rust terminal client, and a native macOS client follow after the first release is stabilized. Additional communication features are prioritized from real usage.

## Local foundation development

Install the versions in `.node-version`, `.bun-version`, `.go-version`, and `package.json`. Then:

```sh
pnpm install --frozen-lockfile
pnpm setup:dev
docker compose -f compose.dev.yaml up -d --wait
pnpm migrate:auth
pnpm dev
```

Open `http://127.0.0.1:5173`. The foundation preview checks the Go connection; it is not yet a chat client. The Astro status page runs on port 4321. Generated `.env` credentials remain local. Setup refuses to overwrite an existing environment.

```sh
pnpm check
pnpm test:integration
```

Integration tests create and delete a disposable account in the development AUTH database. Never point them at production. `pnpm build` builds the compatibility scaffolds too. For a local Electron smoke launch, run `pnpm --filter @yapper/desktop exec install-electron` once, then `pnpm --filter @yapper/desktop start`. This is not an installer or release package. The desktop preview serves the built renderer and public health probe from one loopback HTTP origin, with the Go API at `http://127.0.0.1:8080` by default. Set `YAPPER_API_ORIGIN` when starting Electron to select another HTTPS origin (HTTP is restricted to loopback). This foundation transport does not proxy authenticated APIs.

The existing GitHub repository is retained; its default branch now has a new root history. See [reset evidence](docs/evidence/stage-0.md#repository-reset).
