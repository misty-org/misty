# Signed-in sessions

A signed-in session is one Misty install signed in to the account. There's no second step: registering with proof of
its own key (`POST /devices`) makes a session trusted at once, whether or not it has the vault open.

- **Keys.** Each session has its own signing key in the OS keychain's protection. Signed requests, policies and agent
  run grants use it; the server checks signatures it can't produce. The older table names (`trusted_devices`,
  `device_*`) stay because renaming them isn't needed for anything.
- **Agents.** A run works only on the computer it was sent from. Its grant is signed by that session, names that
  session, and is checked again by the server and the session before acting.
- **The vault.** Sessions with the vault open are listed in `sync_sessions` and shown in Settings › Sync. A grant signed
  by the vault root admits one; only someone with the vault password can do that.
- **Removal.** Removing a session from Settings › Sync stops its vault link at once, for good. Removing its device
  record refuses its key forever, ends its login and cancels its queued work.
- **Presence.** `GET /devices/channel` carries presence and job hints between an account's sessions. Sessions never
  connect to each other directly; everything goes through the server.
