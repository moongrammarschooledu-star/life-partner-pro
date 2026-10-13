# Feature flags (STEP 36)

One write path (`src/lib/platform/flags.ts`) serves both the Control Center and the older `/admin/system-config` screen, so history, the change freeze and the approval rule apply whichever you use.

## States

| State | Meaning |
|---|---|
| `ENABLED` | On for everyone. |
| `DISABLED` | Off for everyone. |
| `ROLLOUT` | On only for the chosen percentage and groups. The global question "is it on?" is **off** during a rollout. |
| `PAUSED` | Off for everyone; a rollout held while you decide. The rule is kept. |
| `EMERGENCY_DISABLED` | Switched off in an emergency; stays off until someone deliberately changes it. |

`isFeatureEnabled(key)` keeps its old meaning (true only when `ENABLED`), so every existing call site behaves as before. A caller that knows who is asking can use `isFeatureEnabledFor(key, subject)`.

## Rollout rules

* **Percentage**: a stable hash of flag + person, so a person stays in or out. 0 means nobody, 100 means everybody in scope.
* **Targets**: internal / admin only, specific role, specific user id, country, environment. Any match turns it on; the percentage is one more way in.
* **No personal-attribute targeting.** Religion, sect, caste, health, income, looks, age, gender and family cannot be targets; unknown types are refused (tested).
* The rule is validated: a rollout needs a percentage or a target; a percentage or targets on `ENABLED` / `DISABLED` / `EMERGENCY_DISABLED` is refused instead of silently ignored.

## Rules for changing a flag

1. Needs `platform:features:manage`, a reason, the environment named, and a fresh password confirmation for sensitive flags.
2. Blocked by an active change freeze (423) unless break-glass applies, or the change only switches something off and the administrator holds `platform:change_freeze`.
3. Switching a **sensitive** flag **on** in **production** goes through the approval gate (`PLATFORM_FEATURE_ACTIVATION`). The response is `202` with an approval code and nothing changes until it is approved. Switching off never needs approval.
4. Every change is versioned, written to the configuration change log and the audit log, and can be rolled back from the history while it is still the latest change.

Changes reach every server instance within about 30 seconds (per-instance cache).

## The brief's flag names

Enforced (mapped to the application's real switch): registration, verification, matching, proposals, contact sharing (as the emergency switch), payments (read-only here; managed in the Finance Center), subscriptions, WhatsApp, SMS, e-mail, AI, marketing.

**Not enforced yet** and therefore listed read-only, not switchable: CRM, family portal, advanced search, risk automation, security automation, PWA.

## Emergency switches

Registration, matching, proposals, contact sharing and payments use the existing `SystemControl` emergency switches; WhatsApp, SMS, e-mail and marketing use the flag state `EMERGENCY_DISABLED`; AI and the payment rollout kill switch keep their own approval workflows and are linked, not duplicated. Engaging stops **new** activity only; nothing is deleted.
