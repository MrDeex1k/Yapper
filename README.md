# Yapper

Yapper is a planned self-hosted voice and text communicator for friends, with a longer-term direction toward Discord-like capabilities.

**Status:** approved product and implementation plan. This repository currently contains documentation only. No application, deployment configuration, or automated checks have been implemented.

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

The existing GitHub repository is retained. Replacing its Git history is a separate future operation, documented in [Operations](docs/operations.md#repository-history-reset). No remote repository changes have been performed as part of this documentation work.
