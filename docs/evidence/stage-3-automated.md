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

The current runner sends three messages concurrently every six seconds. It checks delivery to every open event stream and that each voice client continues to receive RTP from all its room peers. It exits with an error when application latency or RTP exceeds the declared thresholds. The operator checks the container resource thresholds from the Docker samples.

## Physical LAN smoke

On 2026-11-23, the Stage 3 Compose stack at `5629a77` hosted a call in Lounge between Windows GPUI and Brave on macOS. The Windows GPUI client was built from `381786b`, whose GPUI source tree matches `5629a77`. The maintainer confirmed clear, intelligible speech in both directions using the physical microphones. The synthetic load generator was idle during this call.

## Stage 3 implementation verification

On 2026-11-23, the Stage 3 working tree based on `5629a77` was verified on the same Mac and OrbStack setup. The disposable Compose builds used PostgreSQL 19.0, LiveKit 1.13.11, Caddy 2.11.9, Go 1.27.4, and Bun 1.4.5. Each maintenance drill used independent project names and volumes. The [operator procedures](../operations.md#coordinated-backup-and-restore) now describe the commands exercised in these drills.

- **Application checks** `pnpm check`, AUTH integration against PostgreSQL, race-enabled Go tests against PostgreSQL and LiveKit, and the container smoke suite passed. The isolated TURN/TLS test confirmed trusted signaling, rejection of an untrusted certificate and invalid credentials, authenticated relay, and the peer restriction.
- **GPUI voice roster** The opt-in LiveKit smoke reproduced the missing local nickname and passed after the fix. It asserts that the local participant appears first even when alone. Linux ARM64 formatting, pedantic Clippy, and all three default tests passed. The Windows build used in the earlier physical call predates this fix.
- **Coordinated archive** The operator command paused writes, dumped both databases, and verified the archive. The archive directory had mode `0700` and private files had mode `0600`. A modified dump failed verification before provisioning. A clean restore on new PostgreSQL volumes retained the existing guest identity and acknowledged message. The restored owner and moderator could sign in with their original roles, and LiveKit accepted a restored guest's grant.
- **Update and rollback** The merged Stage 2 baseline `381786b` was seeded and updated in place, preserving the stored guest ID and message. A run from the same pre-update archive confirmed that the existing owner and moderator could sign in and retained their roles after the update. On a separate instance, a database ownership change caused the migration to fail with PostgreSQL error `42501`. Restoration from a verified archive onto new volumes retained access to the persisted data.
- **Owner recovery and signing rotation** The new password restored the same owner account and recorded the revoked session count. The old password, login cookie, JWT, event ticket and voice grant were denied. With the key expiry advanced in the test database, Go accepted both signing keys during the grace period and a fresh verifier rejected the retired key.
- **Diagnostics and rate limits** Private diagnostics reported a reachable application database and an unavailable media dependency when LiveKit stopped. The public ingress rejected the private diagnostics route. Configuring both limits to one request per minute gave HTTP 429 with `Retry-After`, `X-Request-ID` and `try_later` at the tested guest-admission and message endpoints.
- **Dependency interruptions** The restored instance recovered after independent stops of AUTH, Go, PostgreSQL, and LiveKit. During AUTH downtime the existing guest could still read history, while privileged requests requiring session validation reported unavailability. During the media outage the guest session remained valid and LiveKit signaling failed until the service returned.
- **Browser recovery** Chrome on macOS displayed the reconnecting state after interruption of the event WebSocket. A new message committed during the interruption appeared exactly once in the timeline after reconnection.

### Sustained run against the completed implementation

The repeat used the same thresholds as the baseline. After a 60-second warm-up, it sustained the workload for 30 minutes with 100 persisted identities, 30 event streams, and 20 synthetic Opus publishers across two rooms. The diagnostics confirmed 30 event streams and 20 active grants during the run. The load driver reconciled all 900 acknowledged messages. PostgreSQL contained 900 committed messages and 900 distinct author/request pairs, with no active media sessions or pending removals after disconnect. None of the five containers restarted or reported an out-of-memory kill.

| Metric                                        | Observed                                 | Threshold |
| --------------------------------------------- | ---------------------------------------- | --------- |
| Text acknowledgement p95                      | 24.19 ms                                 | 250 ms    |
| Event reconnect p95                           | 22.91 ms across 29 cycles                | 2 s       |
| Voice reconnect p95                           | 48.72 ms across 29 cycles                | 5 s       |
| Forward RTP sequence gaps                     | 2,677 across 16,729,230 packets (0.016%) | 1%        |
| Mean RTP inter-arrival variation              | 0.648 ms                                 | 20 ms     |
| Peak aggregate container memory               | 327.60 MiB                               | 2 GiB     |
| Memory growth from the first sustained sample | 68.35 MiB                                | 256 MiB   |

The five services used 128.08 MiB at idle. Their aggregate CPU peaked at 59.78% of one logical core across 66 sustained samples. The final sample showed 348 MB received and 2.52 GB sent by LiveKit, and 116 MB read and 136 MB written by PostgreSQL. Isolated recovery tests shared the host during part of the run. Container measurements exclude the load driver and other projects.

## Physical acceptance under load

On 2026-11-23, the maintainer confirmed the Windows GPUI and macOS Web conversation using physical microphones while the server was under load. This completes the Stage 3 real-device conversation gate.

The capacity figures apply to the local Mac and OrbStack environment. Raspberry Pi 5 and public WAN/TURN deployment were outside these runs.

## Verification after review

On 2026-11-23, the Stage 3 review follow-up passed `pnpm check`, the race-enabled Go suite against PostgreSQL, the AUTH integration, the Compose smoke suite, and the isolated TURN/TLS integration.

- A running AUTH container with an overridden secret and a running one-off migration each blocked a backup before services stopped. SIGTERM during a dump resumed the five original services and left no complete archive. A subsequent verified backup restored both databases into clean volumes. The restored owner could sign in with the replacement password and issue a JWT accepted by Go. Guest identity and committed history also survived.
- Owner recovery rejected an active LiveKit service and completed after all application and media services stopped. Stopping AUTH alone left Go and LiveKit diagnosable. Stopping PostgreSQL yielded failed database readiness while preserving the diagnostic counters from Go's HTTP 503 response.
- With 100 expired signing-key rows present, AUTH issued 20 concurrent tokens with one signing key and Go verified the token against the published JWKS. AUTH retained both keys during the simulated grace period and withdrew the expired key after it.
- Docker rejected the second fixed TURN subnet while the original network existed. The same subnet could be created after the original was released. The existing TURN/TLS probe passed on the test network.
- The revised harness ran for 72 seconds with 30 event streams and 20 voice publishers, including one event reconnect and one voice reconnect. It reconciled 36 acknowledgements against 36 distinct database entries. Text acknowledgement p95 was 32.70 ms, event reconnect took 21.77 ms, and voice reconnect took 48.79 ms. A missing audio file and a one-second audio fixture were rejected. The success and both failure scenarios left zero active voice grants or pending removals. The original 30-minute figures above came from the earlier sequential harness.
