# Configuration management (STEP 36)

## Settings

Platform settings are **typed, validated, versioned and per environment** (`settings-registry.ts`, `settings.ts`).

Types: `STRING`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `JSON`, `ENUM`, `URL`, `SECRET_REFERENCE` (the *name* of an environment variable, never a value; no setting currently uses it).

Registered settings (each states where it is used; one with no consumer says "recorded as the official value"):

* Identity: name, short name, tagline, description.
* Localization: default and enabled languages, default country, currency display, time zone, date and time format.
* Public contact: e-mail, phone, WhatsApp, address, support hours (shown on `/contact` and `/status` only when set).
* Branding: primary colour, e-mail footer text, website address.
* Status page: on/off, public message.

Validation: type, range, length, pattern; URLs must be `https` without credentials; control characters refused; **secret-shaped values refused** (private keys, `sk_live_…`, AWS keys, JWTs, bearer tokens, connection strings with passwords, long opaque tokens); JSON limited in size and depth and may not contain prototype keys.

Not here on purpose: matching, verification, proposals, payments, security, privacy, retention, risk, AI and workflow settings. Each has its own editor. The settings route `PATCH /api/admin/settings` (the older editor) now only accepts an allow-listed set of fields; payment, rollout, membership and reconciliation settings are "managed in …" and refused there (PR #22).

## Change log

`PlatformConfigChange` is append-only: kind, key, per-item version, actor, session, reason, approval, environment, redacted before and after, and the change it rolled back. Secret-looking keys and values are replaced by `[hidden]` *before* storage. Nothing in the code updates or deletes a row (tested).

## Compare and rollback

* **Compare** shows a field-by-field difference; a secret-looking field is hidden on both sides and counts as unchanged.
* **Rollback** exists for **settings and feature flags only**, because only those have a complete, valid "before" value that the normal validated write path can restore. It writes a **new** version pointing at the one it reverses.
* Refused when: the item has changed since (you cannot roll back an older change over a newer one), the change was already rolled back, it is in another environment, it is the first value, a freeze is active (unless break-glass), or the kind is not supported.
* Needs `platform:configuration:rollback`, a reason, the environment, password confirmation, and the approval gate (`PLATFORM_CONFIG_ROLLBACK`).
* Maintenance, freeze and emergency-switch changes are reversed by making the opposite change on purpose.

## Search and export

* Search (`/api/admin/platform/search`) matches keys, labels, categories, providers, features and statuses you may see. It never matches or returns stored values.
* Export (`/api/admin/platform/export`) needs `platform:configuration:manage`, is audited and rate limited, and contains safe metadata only: settings (redacted), flag states, provider status, maintenance state. There is **no import**.

## Environment separation

Each environment (development, staging, production) has its own database, so one cannot edit another's configuration. The extra protection is naming: every write must name the environment and is refused unless it is the one the server runs in. Settings and flag targets can reference the environment.
