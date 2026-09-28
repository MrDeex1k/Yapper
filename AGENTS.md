# Project instructions

- Before implementing a stage, read `docs/implementation-plan.md` and the referenced product, architecture, and validation sections relevant to that stage. Keep completed work distinct from planned work.
- For changes to user behavior or scope, consult `docs/product.md`. For identities, service communication, media, or persistence, consult `docs/architecture.md`.
- For interface work, apply `frontend-skill`; for library documentation, use Context7; before editing Go, apply `modern-go-guidelines:use-modern-go` and the relevant `engineering-skills-for-go` skills. Follow the scope and verification rules in `docs/development.md#required-skills-and-documentation`.
- Use English for code, documentation, branch names, and commit titles. Ship application and landing copy in both Polish and English; add translation keys with each user-facing change.
- Before creating branches or commits, follow `docs/development.md`. Branch names use prefixes such as `feat/`, `fix/`, or `docs/` and must not contain `codex`, in any letter case. Use squash & merge.
- For JS/TS changes, use the configured Oxlint and Oxfmt checks. Apply `@shadcn/lint` to UI code. Once scripts exist, run relevant lint, format, type, and behavior checks and fix failures before reporting completion. Never report planned checks as executed.
- For deployments, migrations, backup changes, or Git history replacement, follow `docs/operations.md`. Preserve the GitHub repository. Documentation approval does not execute the history-reset procedure.
- Record evidence against the current stage's completion gates in `docs/validation.md` or a linked implementation report. Explain any unverified platform behavior.
