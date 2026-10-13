# Mobile release process (STEP 37)

## Stages

`Draft → Internal testing → Closed testing → Open testing → Production`, with `Paused` (reversible) and `Retired` (final) available once a build is out. They are recorded in **Control Center → Mobile apps → Releases**. The log is a record: the real release happens in the Play Console / App Store Connect.

| Move | Needs |
|---|---|
| any non-production move | `platform:mobile:manage`, a reason, the environment typed, password confirmation; blocked during a change freeze (except pausing / retiring, which are restrictive) |
| **to Production** | all of the above **and** the approval gate (`MOBILE_PRODUCTION_RELEASE`, SUPER_ADMIN, level 2). The request returns `202` with an approval code until a second administrator approves; then repeat the move |
| Paused / Retired | allowed during a freeze; "rollback reference" can point at the earlier build you are returning to |

Each record keeps: platform, version, build number, environment, notes, status, who created it, release time, rollback reference, and the approval used. Every change is also in the configuration history and the audit log.

## Step by step

1. **Decide the version.** Marketing version `X.Y.Z`; a build number higher than any earlier upload.
2. **Run the pipeline.** Actions → *Mobile release* (see `ANDROID_RELEASE_GUIDE.md`, `IOS_RELEASE_GUIDE.md`). It must be green: type check, lint, every test, security scan, migration check, Android bundle built and validated, iOS compiled.
3. **Record the build** (Draft) in Control Center.
4. **Internal testing.** Upload to the store's internal track; move the record; run `MOBILE_TESTING_GUIDE.md`.
5. **Closed → open testing** as the store requires; fix findings; build again with a higher build number.
6. **Production (staged).** Move the record to *Production* (second administrator approves), then start a staged rollout in the store console (for example 10% → 50% → 100%), watching Control Center → Mobile apps for errors, push health and refused links.
7. **After it is live.** Set the **recommended** version. Raise the **minimum** only for a security or compatibility reason, and only after the new version is in the store: older apps then show an update screen.

## Safety valves (server side, no store release needed)

| Need | Use |
|---|---|
| Stop everything from the app | `mobile.app.enabled` off (the app shows a notice) |
| One platform | `mobile.android.enabled` / `mobile.ios.enabled` |
| Maintenance notice in the app | `mobile.maintenance.enabled` (and the platform maintenance mode) |
| Stop notifications | `mobile.push.enabled` off (or remove a provider's variables) |
| Stop link opening | `mobile.deep_links.enabled` off |
| Roll a feature out gradually | percentage / group rollout on the flag (for example `mobile.new_dashboard.enabled`) |
| Block old versions | raise the minimum in *App versions* |

Flags are evaluated per installation for rollouts (same app, same answer). The brief's "version targeting" per flag is covered by the **minimum / recommended** version policy per platform; a flag cannot target "versions below X" separately.

## Rollback

Pause the staged rollout in the console; move the record to *Paused* with a rollback reference; if needed, lower the recommended version back to the previous build and use a server-side switch above. A build already installed cannot be removed from phones; the server decides what it may do.

## What must never be in a release

A debug build; a key, keystore, `google-services.json`, `.p8` or service-account file in Git; a changed package id / bundle id after publishing; a build number that did not rise; a production release not recorded and approved.
