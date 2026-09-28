# Using the MVP candidate

Ask your host for the server address and a private invitation. In a browser, open the host's HTTPS address. In the Windows/Linux desktop candidate, enter the same address. Saved addresses contain no password or token. Sign in, or choose Join server and consume your invitation once.

Choose a text channel to read and send messages. Retries reuse the same message identity. Voice channels have a circular icon: choose Join voice to enable the microphone, then use mute, deafen and device selection. Voice continues while switching to a text channel; Voice controls in the sidebar return to the room. Leave voice ends the call. Focused push-to-talk uses V and does not trigger while typing. Desktop global PTT is opt-in and can fall back to focused mode; see DESKTOP.md. Deafen also blocks PTT transmission.

Administrators create text/voice channels, private memberships and invitations in Server settings and People and permissions. Moderators manage member bans and remove messages in channels they can access. Role changes revoke sessions; users must sign in again. Instance status checks services and database usage on demand.

Exit revokes the current session. Changing server requires leaving the authenticated workspace, so its token is never sent to the newly selected host. Sessions are held in memory; restarting the client requires signing in again.

This is candidate 0.5.0 in unmerged PRs. Desktop packages are unsigned, and physical Windows/Linux group acceptance remains pending. There is no public stable download or automatic updater yet.

Attach a file before sending a message; downloads require current channel access. Search history returns only accessible channels. Edit your own messages inline; moderators can edit within their authorized channels. A visible history ending advances your read marker across sessions.

Camera and Share screen are explicit controls inside a joined voice room. Select a camera or screen quality before publishing. The browser or desktop asks for a capture source; system audio is disabled. Pause incoming video leaves voice connected. Hidden video is unsubscribed, and each page receives at most four video publications. Stop sharing or Turn camera off ends that publication.

See [feature matrix](FEATURE_MATRIX.md) and [F05 verification](verification/F05.md) for tested scope.
