# Phone-first sign-in and codes (STEP 38)

A person signs in with their **Profile ID + mobile number** (an e-mail address still works) and receives a one-time code on **WhatsApp, else SMS, else e-mail**. An e-mail address is optional at registration once this is switched on. Everything is behind the feature flag `auth.phone_login.enabled`, which is **OFF** by default, so nothing changes for anyone until you switch it on.

## How the code is delivered

| Order | Channel | Used when |
|---|---|---|
| 1 | WhatsApp | the profile has a WhatsApp number **and** a real WhatsApp provider is configured **and** `WHATSAPP_OTP_TEMPLATE_NAME` is set |
| 2 | SMS | a real SMS provider is configured (Twilio or the HTTP gateway below) |
| 3 | E-mail | the profile has an e-mail address (the e-mail provider is already working) |

- A channel counts only if a **real** provider would carry the message. The built-in "sandbox" only writes to a log, so it is skipped and the next channel is tried; the person is never told a code was sent when it was not.
- If a channel fails the next one is tried. If none can deliver, the sign-in page says so honestly (HTTP 503).
- With the flag OFF the code goes to the e-mail address, exactly as before.
- The code always goes to the number / address **stored on the profile**, never to anything typed in the request.
- Phone sign-in also needs `auth.applicant_otp_login.enabled` ON (without a code step a phone number would be a password-less door).

## What you must set up (Vercel -> Settings -> Environment Variables, then redeploy)

### 1. SMS gateway (local Pakistani provider)
Ask the provider for their **HTTP API page** (a URL, whether it is GET or POST, and the parameter names). Then set:

| Variable | Meaning |
|---|---|
| `SMS_GATEWAY_URL` | https address; may contain `{to}` `{message}` `{sender}` |
| `SMS_GATEWAY_METHOD` | `GET` or `POST` (default `POST`) |
| `SMS_GATEWAY_BODY` | POST body with `{to}` `{message}` `{sender}` |
| `SMS_GATEWAY_CONTENT_TYPE` | `application/x-www-form-urlencoded` (default) or `application/json` |
| `SMS_GATEWAY_HEADERS` | optional JSON, e.g. `{"Authorization":"Bearer ..."}` |
| `SMS_GATEWAY_SENDER` | the approved sender name / number (a "mask" in Pakistan) |
| `SMS_GATEWAY_RECIPIENT_FORMAT` | `digits` (923001234567, default), `e164` (+923001234567) or `local` (03001234567) |
| `SMS_GATEWAY_SUCCESS_PATTERN` | optional regex the reply must match (otherwise any 2xx counts) |
| `SMS_GATEWAY_FAILURE_PATTERN` | optional regex that marks a reply as a refusal |
| `SMS_GATEWAY_MESSAGE_ID_PATTERN` | optional regex; first group = the provider's message id |

Example (GET style): `SMS_GATEWAY_URL=https://api.provider.pk/send?user=U&pass=P&to={to}&from={sender}&text={message}`, `SMS_GATEWAY_METHOD=GET`, `SMS_GATEWAY_SENDER=LifePartner`.
The credentials live only in these server variables; they are never shown, logged or stored in the database.

### 2. WhatsApp (Meta Cloud API)
1. In Meta Business -> WhatsApp -> create / use a phone number; note the **Phone number ID** and create a **permanent access token** (System User).
2. In WhatsApp Manager -> Message templates create a template of category **Authentication** (body: the code as `{{1}}`; Meta adds the "copy code" button). Wait for approval.
3. Set `WHATSAPP_ENABLED=true`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OTP_TEMPLATE_NAME` (the approved name), `WHATSAPP_OTP_TEMPLATE_LANGUAGE` (e.g. `en`), and `WHATSAPP_OTP_TEMPLATE_BUTTON=false` only if your template has no button.

## Switching it on (in this order)
1. Set the variables above, redeploy, and open **Control Center -> Providers**: SMS and / or WhatsApp must show configured.
2. Switch `auth.applicant_otp_login.enabled` ON if it is not already.
3. Switch `auth.phone_login.enabled` ON (Control Center -> Feature flags). Sign in once with your own profile using your phone number and confirm a code arrives on your phone.
4. Done: registration now lets people leave the e-mail empty, and the sign-in page accepts a mobile number.

To go back, switch `auth.phone_login.enabled` OFF: sign-in returns to e-mail codes at once. Profiles that registered without an e-mail cannot receive a code then until it is switched on again.

## Security notes
- A code is bound to the profile; only the newest code works; wrong guesses are counted atomically; per-profile and per-address rate limits apply.
- A sign-in code needs a valid Profile ID **and** a matching number / e-mail, so the form cannot be used to send messages to arbitrary numbers (no SMS-pumping door).
- Signing in by phone never marks the phone as "verified"; verification is a separate step.
- Without an e-mail address, "e-mail verified" is treated as not applicable (not as a missing step), so verification level and completeness are not lowered.
- Duplicate detection ignores absent e-mail addresses; mobile-number matching is unchanged.
