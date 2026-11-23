# Stage 4 naming audit

GPT 6.2 Astra reviewed the working tree on `feat/stage-4-desktop-release` based on `466c2f1`, including uncommitted Rust modules. The audit covered 107 source files. This includes 33 Go files, 15 Rust files, and 59 Web, shared, AUTH, Electron, landing, and TypeScript tooling files. One of the 107 was the generated API binding, used as contract evidence.

The findings are based on identifier scans, source inspection, and call-site checks. The audit did not run application builds or tests.

## Implemented fixes

| Order | Scope                   | Changes                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | GPUI identity           | Rename the active `guest` field and its `Admission` bindings to `admission` where they can also hold a signed-in account. Use `show_sign_in_form`, `session_request_pending`, and `credential_saved` for form visibility, request state, and credential persistence.                                                                                                                                        |
| 2     | GPUI voice and messages | Use `SelectMicrophone` for device selection, `MicrophoneActiveChanged` for capture events, and `microphone_active` for observed state. Split `message_action` into explicit message deletion and participant moderation. Give the transport separate edit and delete methods.                                                                                                                               |
| 3     | Web and shared copy     | Use `selectedTextChannel`, `channelId`, and `activeChannelId` for the selected object and its ID. Name pagination inputs `beforeSequence` and `afterRevision`. Clarify voice names with `participantIdFromMediaIdentity`, `stopPromise`, `isCurrentSession`, `setEnabled`, `inputDeviceId`, and `setPushToTalkHeld`. Rename `newRevision` to `isEditStale` and the EN/PL key `adminLogin` to `staffSignIn`. |
| 4     | Go                      | Distinguish `participantID` from `mediaIdentity` in revocation calls. Rename internal-package methods `Active` and `Provision` to `CheckSessionActive` and `BootstrapOwner`. Name the cancellable cleanup loop `RunMessageRetention`.                                                                                                                                                                       |

Identifiers follow each language's conventions, such as TypeScript `channelId`, Go `ChannelID`, and Rust `channel_id`. Router search keys, HTTP parameters, serialization names, event names, database columns, and stored preference keys are unchanged.

## Separate behavior fix

A failed GPUI delete or moderation request used to lose its error when the user switched away from the originating channel. Both actions now record their result in the active or cached chat that started the request. The regression test simulates a failed response after the user switches channels. It verifies that the original chat keeps the error, the visible channel remains unaffected, and a result for a superseded chat generation is discarded.

## Verification

- Web passed `pnpm check`, including the generated API comparison, EN/PL translation parity, channel switching, message history changes, and push-to-talk release. React Doctor reported 92/100 and no findings in the changed files.
- Go passed `go vet ./...`, `go test -race ./...`, and `pnpm test:integration` with disposable PostgreSQL and LiveKit instances. The integration suite exercised AUTH session validation, logout, and media revocation.
- The Compose smoke suite (`scripts/test-containers.ts`) passed with the rebuilt Go server in a disposable loopback project. It covered owner bootstrap and sign-in, guest admission, chat edit and deletion, moderation, and rejection of revoked account sessions.
- GPUI passed `cargo fmt --check`, locked offline Clippy with warnings denied, four ordinary unit tests, and the locked offline release build on Ubuntu ARM64. The separate live GPUI signaling test remained ignored. This follow-up did not rerun the Windows UI or physical microphone checks.
