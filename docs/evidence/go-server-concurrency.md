# Go server concurrency follow-up

The 2026-11-27 verification compared the changes in this PR with main at `5048a50`. Both server builds used Go 1.27.4 and the base commit's dependency pins. Testing ran on a Mac16,8 with macOS 27.2.1, 12 logical CPUs and 24 GiB of RAM, with Linux arm64 containers in OrbStack.

## Functional verification

- The Go race suite used disposable PostgreSQL 19 and self-hosted LiveKit 1.13.11. It covered event tickets, kick close code `4001`, bans and blocked addresses, message deduplication across concurrent sends, edited and deleted message retries, cursor reconciliation, and LiveKit moderation.
- A regression runs the voice reconciler during a pending replacement and verifies that a retry reuses the same replacement identity. Another pauses the second AUTH check of a signaling upgrade, admits an unrelated guest, and confirms that leaving during the paused check prevents the first upgrade from completing.
- The formatting check, `go vet ./...`, and the repository's Go analysis script passed. The race-enabled HTTP and media suites passed the existing goroutine leak checks. The external AUTH check passed separately using a real JWT issued by the disposable AUTH service.

## Measurement method

The same [Stage 3 driver](../../server/cmd/stage3-load/main.go) ran against fresh versions of the local [capacity stack](../../compose.capacity.yaml). The baseline server included the same private diagnostics counters as the candidate. The rest of the baseline server came from `5048a50`. Both runs used cached AUTH and ingress builds, PostgreSQL 19.0, and LiveKit 1.13.11.

The driver measured delivery from the start of the HTTP send to each stream's receipt of its first matching event, including events received before the HTTP acknowledgement. The run used 100 persisted identities, 30 guest event streams, 20 synthetic Opus publishers across two rooms, three concurrent text sends every six seconds, and one event and voice reconnect. Each run used a 10-second warmup followed by 72 seconds of workload.

On the disposable database, `pg_stat_statements` counted statement executions after the streams and publishers were ready. Private `/internal/diagnostics` reports cumulative pool acquisitions, successful acquisitions that waited, canceled acquisitions, and aggregate wait time in milliseconds. Compare counter deltas over the same interval.

## Capacity comparison

| Measurement | Baseline | Candidate repeat |
| --- | ---: | ---: |
| Text acknowledgement p95 | 32.74 ms | 93.10 ms |
| Event delivery p95 / p99 | 34.24 / 40.28 ms | 93.58 / 99.03 ms |
| Voice reconnect with two-way RTP | 184.51 ms | 203.32 ms |
| Pool acquisitions | 9,242 | 5,618 |
| Pool acquisitions that waited | 1,734 | 658 |
| Aggregate pool wait | 1,165 ms | 369 ms |
| Canceled pool acquisitions | 0 | 0 |

Both measured runs delivered 1,080 events and reconciled 36 unique acknowledged messages against PostgreSQL. They ended with zero active media sessions and pending removals. Each guest stream check used two SQL statements on the baseline and one on the candidate. The sampled intervals recorded 3,573 participant lookups in the baseline and 3,543 combined access checks in the candidate.

The first candidate run delivered the same 1,080 events, but text acknowledgement p95 was 1.54 s and exceeded the 250 ms threshold. The repeat passed the existing thresholds. Its longest measured PostgreSQL statement execution was 13.56 ms for the channel row lock. The cause of the first run's latency spike is undetermined. These runs establish the reduction in database work. End-to-end latency was higher in both candidate samples.

## PostgreSQL hot paths

A local pgx query tracer counted operations, including transaction boundaries. Sixty successful guest authentications from the same address executed 480 statements on the baseline and 360 on the candidate. Each series of 240 fresh sends used three concurrent writers in one text channel. Every baseline series executed 1,440 statements, and every candidate series executed 1,200.

The tracer measured from the return of the channel-lock query through the return of the commit, including the commit round trip. The baseline p95 was 17.10, 18.72, and 45.32 ms in three series. The candidate p95 was 2.29, 2.56, and 3.66 ms. The tests ran sequentially on a shared local host, where the timing varied between series.

Separately, 200 consecutive checks of an active account session through the Go AUTH client measured p95 of 2.24 ms and p99 of 4.12 ms on a disposable local AUTH and PostgreSQL stack. Each check queried the live session state.

## Coverage limits

The capacity comparison is a short local run. WAN and TURN connectivity, physical audio, real-device timing and the 30-minute capacity gate were outside this follow-up. Context7 supplied development PostgreSQL and current pgx documentation for the requested versions. The SQL ran on PostgreSQL 19.0 and the pool counters were checked against the pinned pgx v5.13.0 source.
