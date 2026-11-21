# Stage 2 Web runtime benchmark

On 2026-11-21, a local comparison on an Apple M4 Pro with macOS 27.2.1 used the Stage 2 working tree based on `80d6c69`. Both production builds used the same source snapshot (`3e0aafee73e796d4bae324dee4e044e5a6a2c17cf4618675b7ae06dee0eea7e2` SHA-256), React 19.3.1 dependencies, Vite 8.3.8, Node 26.13.1, and pnpm 12.21.0. The experiment added `@tanstack/redact@0.3.1` and the default `redact()` Vite plugin to one isolated copy, following the [TanStack Vite guide](https://tanstack.com/redact/latest/docs/quick-start). Caddy served both builds from the same loopback origin through separate paths and proxied the same Stage 2 backend.

## Size and timing

Chromium 154.0.8037.58 ran 16 measured pairs per startup profile with alternating order, one discarded warm-up pair, fresh browser contexts, disabled browser cache, and the same guest session. The startup marker was the second animation frame after the conversation profile entered the DOM. The throttled profile used 4× CPU slowdown, 40 ms simulated latency, 1.6 Mbit/s download, and 0.75 Mbit/s upload.

| Measure                                      |                React |               Redact |
| -------------------------------------------- | -------------------: | -------------------: |
| Minified JavaScript                          |          1,144.47 kB |            973.80 kB |
| JavaScript after gzip, as reported by Vite   |            331.46 kB |            283.75 kB |
| First contentful paint, loopback median      |              80.0 ms |              66.0 ms |
| Conversation visible, loopback median / p90  |     108.8 / 119.0 ms |      92.4 / 103.3 ms |
| First contentful paint, throttled median     |           2,172.0 ms |           1,884.0 ms |
| Conversation visible, throttled median / p90 | 2,388.5 / 2,417.0 ms | 2,071.0 / 2,090.1 ms |
| Composer input to next frame, median / p95   |        2.4 / 15.4 ms |        2.4 / 15.4 ms |

Gzip JavaScript fell by 47.71 kB (14.4%). CSS was byte-identical. Redact showed the conversation earlier in all 16 pairs in each profile. The median paired gain was 14.8 ms on loopback and 313.9 ms under throttling.

The composer test measured six sessions of 32 input events per runtime with 4× CPU slowdown, the same chat history, and an active LiveKit call with synthetic microphone input. There was no lost input. The latency is time from the DOM input event to the next animation frame callback. It is a lab proxy for typing responsiveness on this workload.

## Compatibility

- Chromium, Playwright Firefox 159.0, and Playwright WebKit passed message delivery between two clients, history after reload, the owner invitation list and manual refresh, and channel creation through React Hook Form and Zod. Both builds passed validation focus, keeping and discarding an unsaved draft, and focus restoration in the Base UI confirmation.
- Chromium also passed LiveKit join and leave, microphone mute and unmute, the device selector, keyboard push-to-talk, and Escape and focus restoration at a narrow viewport. The harness changed the signaling authority in the voice grant to its own test origin. The real Go signaling gate and LiveKit carried the synthetic media.
- Both builds passed all 11 existing Web tests. Bun runs these tests against the installed React packages, so the production browser runs establish Redact runtime coverage.
- Timing was limited to Chromium and one Mac. The experiment used synthetic microphone input and mobile viewport emulation. Physical audio and production Safari on Apple devices still need verification before a rollout.

## Decision

The size and cold-start gains justify a pilot. Keep React as the release baseline while measuring deferred LiveKit loading and running physical-device voice checks. Redact uses synchronous rendering under the default Vite integration. Review the [compatibility differences](https://tanstack.com/redact/latest/docs/compatibility) before adopting it across Web.
