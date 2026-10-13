# Provider management (STEP 36)

The Providers screen lists every outside service in **one status vocabulary** and runs safe connection tests. It is a view and a test bench, not another place to store credentials.

## Status words

`CONNECTED`, `HEALTHY`, `DEGRADED`, `UNAVAILABLE`, `DISABLED`, `NOT_CONFIGURED` (see `provider-status.ts`; each source's own words are mapped onto these).

## What is listed

Database, file storage, sign-in, the communication providers (e-mail, SMS, WhatsApp, in-app) from the provider table, payments (manual / bank transfer, Stripe), AI, and marketing connections. Monitoring and analytics providers are shown only if they exist in the platform; none is invented.

## What a provider row shows

Name, category, status, environment, enabled features, short notes, last check (outcome, time, latency), last success, and a link to the provider's own screen. **Never** a credential, key, token, connection string or the *name* of a credential variable.

## Test connection

* Needs `platform:providers:manage`, and is rate limited (6 per minute per administrator, policy `platform-provider-test`).
* **Read-only**: it sends no message, charges nothing and changes nothing. The database test is a round trip, storage checks the store, a communication provider is asked for its own health, Stripe receives a read-only balance request, AI only checks that a key is present (an external model costs money per call).
* Every call has a 5-second timeout. The result (outcome, status, latency, a short redacted detail) is stored in `PlatformProviderCheck` and shown in the history. Diagnostics are flattened, long tokens replaced and cut to 200 characters.

## Enabling or disabling a provider

Only **communication providers** can be switched on or off here (`PATCH /api/admin/platform/providers/comm:<key>`). The existing provider service performs the change with its own approval rule; the Control Center adds the environment, reason, freeze check and a history entry. Everything else about a provider (priority, failover, templates, credentials in the environment) is changed on the provider's own screen.

## Credentials

Credentials live in the hosting environment (Vercel project variables). Nothing in the Control Center can read, show, export or write them. A test (`platform-flow.test.ts`) sets recognisable secret values and checks that no provider view contains them.
