# Stage 3 automated verification

The disposable rehearsals used the accepted Stage 2 PR head `281a213` and the capacity harness at `08c1013` on `test/verify-stage-3`. The environment was a Mac16,8 with macOS 27.2.1, 12 CPU cores, and 24 GiB of physical memory. OrbStack exposed 12 vCPUs and 11.73 GiB to Docker Engine 29.8.2 and Compose 5.5.0. Builds used Go 1.27.4, Node 26.13.1, Bun 1.4.5, and pnpm 12.21.0. Service images used the repository's PostgreSQL 19.0, LiveKit 1.13.11, and Caddy 2.11.9 pins.

## Recovery and operations

- **Baseline** `pnpm check` passed formatting, lint, contracts, types, tests, and builds. The real Compose smoke passed owner setup, invitations, guarded administration, chat, retry deduplication, and moderation. The AUTH integration passed. The race-enabled Go run passed 36 tests and subtests. The separate TURN/TLS integration passed authenticated relay, address forwarding, untrusted certificate rejection, and the restricted peer policy. The cached Ubuntu ARM64 GPUI environment passed formatting, Clippy, the three default tests, and a locked build.
- **Backup and clean restore** Stopped ingress, Go, AUTH and LiveKit to quiesce writes on the disposable source. Took PostgreSQL custom-format dumps of both databases and recorded checksums for the dumps, private environment file, Compose configuration, and source and image references. Source and restore used different PostgreSQL volumes. Modified archive bytes failed checksum verification before import. After restore, the same owner signed in, the moderator retained the same ID and role, the original guest cookie resolved to the same participant, and the same message and signing key were present. LiveKit validated the restored guest's grant through the Go media ingress.
- **Previous-version upgrade** Built the Stage 1 source at `ce6aae7` and seeded it through the real container smoke. Reused its database volume with the Stage 2 image and migrations. The guest kept its original identity and committed history.
- **Failed migration and recovery** Introduced an incompatible text key in the category table on a separate copy of the Stage 1 databases. The Stage 2 migration failed on the foreign-key type mismatch and rolled back its schema change. Restored the pre-upgrade dumps to fresh volumes and reran the persistence smoke successfully. This recovery restored the contents of the snapshot.
- **Dependency failures** Stopped AUTH, Go, PostgreSQL, and LiveKit separately and restored each before the next check. During AUTH downtime, the established guest could read history, while registered-user requests requiring session validation returned unavailable and new login failed. Go and database outages surfaced failure responses. During LiveKit downtime, chat stayed available and signaling failed. The original guest and the affected endpoint recovered after each service returned.
- **Web reconnect** A real Chrome session showed its reconnecting state after the event WebSocket was interrupted. A message was persisted during the interruption. The browser obtained a new event stream, restored the connected state, and reconciled that message exactly once.
- **Key lifecycle and TLS** On a disposable restored instance, advanced the old signing key's expiry in PostgreSQL. Real Better Auth issued a new key, published both keys during overlap, and withdrew the old key after the simulated grace period. Go accepted both during overlap and rejected the retired key after refreshing from a cold cache. An independent loopback TLS control accepted a valid certificate and rejected a trusted but expired leaf before it reached the test HTTP handler.

## Capacity run

The [capacity overlay](../../compose.capacity.yaml) serves loopback HTTP and exposes test ICE ports on the declared host address. The [load driver](../../server/cmd/stage3-load/main.go) seeds 100 identities, opens 30 authenticated event streams, and publishes synthetic 32 kb/s Opus audio from 20 real WebRTC clients in two rooms. It exercises chat acknowledgements, idempotent retries, timeline reconciliation, and controlled event and media reconnections. The client process runs on the same Mac as the Docker VM.

The short pilot joined all clients, sustained 20 tracks, received 175,842 RTP packets without observed forward sequence gaps, and measured about 24 ms for text acknowledgement p95. Before the sustained run, set the local thresholds to 250 ms for text acknowledgement p95, 2 s for event reconnect p95, 5 s for voice reconnect p95, 1% for forward RTP sequence gaps, and 20 ms for mean RTP inter-arrival variation. The aggregate container memory budget was 2 GiB, with up to 256 MiB growth from the first sustained sample. Docker sampled per-service CPU, memory, network and block I/O approximately every 30 seconds. Forward RTP gaps and mean arrival variation are receiver-side estimates.

The sustained workload passed 30 minutes after a 60-second warm-up. All 30 event connections and 20 voice publishers reached the target concurrency. The driver reconciled all 900 acknowledged messages through paginated history. A direct PostgreSQL check confirmed 100 participant records, 900 committed messages and 900 distinct author/request pairs, with zero active media sessions and zero pending media removals after the driver exited. None of the five service containers restarted or reported an out-of-memory kill.

| Metric                                        | Result                                                        | Predeclared threshold |
| --------------------------------------------- | ------------------------------------------------------------- | --------------------- |
| Text acknowledgement p95                      | 23.96 ms                                                      | 250 ms                |
| Event reconnect p95                           | 17.71 ms across 29 cycles                                     | 2 s                   |
| Voice reconnect p95                           | 34.30 ms across 29 cycles                                     | 5 s                   |
| Forward RTP sequence gaps                     | 388 across 16,728,360 received packets, approximately 0.0023% | 1%                    |
| Mean RTP inter-arrival variation              | 0.487 ms                                                      | 20 ms                 |
| Peak aggregate container memory               | 312.25 MiB                                                    | 2 GiB                 |
| Memory growth from the first sustained sample | 36.74 MiB                                                     | 256 MiB               |

Across 56 sustained samples, aggregate Docker CPU peaked at 65.96% of one logical core. The idle memory sample was 112.65 MiB. The final sample showed 345 MB received and 2.5 GB sent by LiveKit, and 203 MB read and 120 MB written by PostgreSQL. Other local workloads shared the host during part of this run. These readings measure the test containers, with the Go load driver and any unrelated workloads outside the per-container totals.

## Repeat the capacity run

Use a fresh, disposable Compose project and a privately generated configuration containing a valid setup token and distinct service secrets. Set `STAGE3_MEDIA_IP` to the test host address used for ICE. Start Compose with `compose.yaml`, `compose.smoke.yaml`, and `compose.capacity.yaml` in that order. For example, use the project name `yapper-stage3-capacity` and the profile's default loopback origin `http://127.0.0.1:18090`.

From `server/`, build `./cmd/stage3-load` with the repository Go version. Generate a test tone for longer than the planned warm-up and sustained test using FFmpeg.

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2220 \
  -c:a libopus -b:a 32k -vbr off -page_duration 20000 capacity.ogg
go build -o stage3-load ./cmd/stage3-load
./stage3-load -tone capacity.ogg -warmup 60s -duration 30m
```

Supply `STAGE3_SETUP_TOKEN` to the test process from the private Compose environment. Record idle and sustained Docker statistics separately. The runner accepts a fresh loopback installation and creates test accounts and messages. Use a separate disposable project for each run.

## Remaining acceptance

The maintainer will confirm intelligible two-way speech on physical Windows GPUI and macOS Web clients with load running. The results describe the local Mac and OrbStack environment. Raspberry Pi 5 deployment and a public WAN/TURN path require their own runs.

This branch verifies the existing service behavior and the operational rehearsals. The proposed production operator workflow, automated backup/restore interface, diagnostic export, host-side owner recovery, rotation scheduling, and configurable request limits remain implementation items in the [Stage 3 plan](../stage-3-plan.md).
