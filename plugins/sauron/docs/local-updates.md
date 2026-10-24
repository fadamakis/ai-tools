# Optional local source updates

Sauron can coordinate local source checks only after the target runtime has verified read access to Slack, Granola, Jira, GitHub, and Google Calendar. Ordinary installation creates no schedule and keeps the existing coordination mode.

## Verify capabilities first

Run the packaged probe from the selected runtime:

```sh
node scripts/probe-local-runtime.mjs
```

Discovery alone is insufficient: the probe requires actual permitted reads for all five providers and checks the restricted tool policy. If a provider is unavailable, keep manual use and existing coordination in place; do not widen permissions or create another store as a workaround.

Read the intended store's ID through `list_attention`. To record a successful proof, use that exact ID with `node scripts/probe-local-runtime.mjs --record STORE_UUID`. An incomplete probe does not record success.

## Prepare a schedule

```sh
node scripts/prepare-local-scheduler.mjs --expected-store-id STORE_UUID --runtime /absolute/path/to/verified/sauron --output /absolute/path/to/private/local-sauron.plist
```

Replace the placeholders with the observed store ID and chosen stable paths. This creates an inactive private plist; it does not install or load a LaunchAgent. Review its runtime, database, and environment before use. An hourly weekday business-hours check is gated by the local runtime; the one-minute LaunchAgent interval is a cheap due check, not a source/model poll. Business-hour freshness uses the computer's time zone, or an explicit `ATTENTION_TIME_ZONE` supplied consistently to server and worker.

## Coordinate writers

1. Identify the existing source updater and any scheduled writers for this store. Pause only those writers through their supported controls, and reconcile dispatched work or uncertain receipts.
2. Take a consistent backup. Use a compatible runtime and stop old server processes that cannot honor writer fencing.
3. Read current store identity, coordination mode, and owner epoch. Call `configure_attention_sync` with a fresh operation UUID, the matching store ID, requested `local_managed` mode, and observed `expectedMode`/`expectedEpoch`.
4. Verify the returned identity/mode/epoch. Run one explicitly requested local check and inspect source coverage, receipts, and retained user decisions.
5. Only under explicit scheduling authorization, load the reviewed job. Verify an actual run and catch-up behavior. Never enable a second uncoordinated writer.

The mode change rejects unverified runtimes, active conflicting work, and unresolved local writes. It preserves schema-3 tasks, decisions, histories, and receipts. It does not itself stop an old process or an external scheduler.

For recovery, stop the local job, reconcile its outstanding result, and switch ownership using the current mode/epoch and a compatible runtime. Resume only the verified original updater. Preserve newer decisions; restoring an old database is not a code rollback.

## Privacy and limits

Source/model queries leave the computer through the user's connected services. The local worker has a bounded read policy; explicit UI Slack replies are a separate action. Keep source payloads, store IDs, pending envelopes, and schedules private. Runtime discovery or browser test results do not prove production source access. See [privacy and permissions](https://github.com/fadamakis/ai-tools/blob/main/docs/privacy-and-permissions.md).
