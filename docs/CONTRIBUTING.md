# Development and pull requests

Use Conventional Commits in English. Branch names summarize the final squash commit: `feat/implement-auth`, `fix/restore-voice-connection`, `chore/setup-repository`. Do not include tool/agent names in branches.

Each roadmap step is normally one commit. Each stage is one PR. Write a concrete English title and Summary / Validation / Checklist, following the owner's existing repositories. State actual evidence rather than checking boxes for tests that were not run.

For this implementation series, stack branches and PR bases in stage order. Do not merge, enable auto-merge, create release tags or publish releases. Track implementation checks separately from integration and release acceptance. The owner will eventually use Squash & Merge. Never claim that untested Windows/Linux devices, WAN media or published images were validated locally.
