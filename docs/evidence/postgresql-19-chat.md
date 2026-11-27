# PostgreSQL 19 chat verification

The 2026-11-27 run compared the changes in this PR with `5048a50` on macOS 27.2.1 arm64, using Go 1.27.4 and OrbStack Docker Engine 29.8.2. The disposable container used the Compose-pinned PostgreSQL 19.0 Alpine digest. The schema and stored data format require no migration.

## Send and retry behavior

- `go test -race ./...` passed with `TEST_DATABASE_URL` pointing to the disposable server. The PostgreSQL tests exercised same-channel retries, history reconciliation, legacy messages, retries after an edit or deletion, and retention. The PostgreSQL HTTP integration also ran. External AUTH, LiveKit and TURN scenarios need separate fixtures and were outside this run.
- `go test ./internal/community -run '^TestConcurrentMessageRetryAcrossChannels$' -count=25` passed. Two concurrent sends with the same author and request ID on different channels produced one new message and one conflict. A retry in the winning channel returned the same message and nickname without marking it fresh.
- `go test -race ./internal/community ./internal/httpapi -count=1` also passed with a non-superuser role that owned its disposable application database.
- The repository Staticcheck and go-critic script, `go vet ./...`, Go formatting and `git diff --check` passed.

`Store.Send` executes one write-and-return statement in place of the separate insert and lookup, with the same transaction and channel lock.

A single local Go client used fresh schemas, `GOMAXPROCS=4`, 100 warm-up calls and 1,000 timed calls per case. Four paired runs alternated the order of baseline and candidate. Each run sent new request IDs in one case and retried a fixed request ID in the other. Baseline p95 ranged from 2.79 to 18.25 ms for new sends and from 2.77 to 34.25 ms for retries. Candidate p95 ranged from 2.58 to 21.44 ms for new sends and from 2.92 to 9.64 ms for retries. The ranges overlap and measure the store directly, so they do not establish an end-to-end latency improvement.

## History query plans

The fixture loaded the current schema and inserted 260,000 messages with one synthetic author. Sequences 1–200,000 belonged to the busy channel and the remaining 60,000 to a second channel. After `ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS, IO)` ran with `plan_cache_mode=force_generic_plan`, a limit of 51 and a deep cursor of 10,000. That setting isolates the generic prepared plan. The real server can choose a custom plan, and the fixture timings cover the page query only.

| Page   | SQL                 | Rows removed by filter | Shared buffers hit or read | Execution |
| ------ | ------------------- | ---------------------: | -------------------------: | --------: |
| Latest | One optional cursor |                 60,000 |                      4,788 |  5.644 ms |
| Latest | Separate query      |                 60,000 |                      2,478 |  3.191 ms |
| Deep   | One optional cursor |                250,001 |                     17,614 | 20.143 ms |
| Deep   | Separate query      |                      0 |                          7 |  0.064 ms |

The deep-page query used the cursor as an index condition. Both first-page queries still filtered the leading rows from the second channel in this fixture. Different cache states affected these single-pass timings.

## Retention and disk space

The existing partial age index supported selection of the first eligible channel and its 250-row batch. The fixture aged 40,000 messages past a one-day cutoff and applied the same redaction update in batches of 250 with fixture autovacuum disabled. All 260,000 identifiers remained present. No production vacuum setting or maintenance schedule changed.

| Stage                   | Estimated dead rows | Total relation bytes |
| ----------------------- | ------------------: | -------------------: |
| Before redaction        |                   0 |          151,658,496 |
| After redaction         |              40,000 |          159,793,152 |
| After ordinary VACUUM   |                   0 |          159,793,152 |
| After concurrent REPACK |                   — |          125,501,440 |

`REPACK (CONCURRENTLY, ANALYZE)` ran on the disposable table and preserved the 40,000 redacted rows and all identifiers. Consider this operation when measurements show table bloat and disk space needs to be reclaimed. A production rehearsal should account for temporary table and index copies, the final exclusive lock, and old snapshots that can see an empty table after the swap. History pagination uses a repeatable-read snapshot. See the [PostgreSQL 19 concurrent-operation notes](https://www.postgresql.org/docs/19/sql-repack.html#SQL-REPACK-NOTES-CONCURRENTLY).
