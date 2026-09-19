# AI Acquisition architecture and operations

## Existing architecture inspected

AI Acquisition follows the existing production boundary:

```text
Browser -> Next.js App Router handler -> Express Social Listener -> Microsoft SQL Server
```

The implementation inspected and reuses these existing surfaces:

- `CompanyProfiles` and `CompanyProfile_Get` for the singleton company context.
- `AIProviderConfigurations` plus the encrypted OpenAI, Anthropic, and Gemini adapters.
- `CRMLead_UpsertFromRoutine` for email, phone, and social-identity Lead matching/creation.
- `LeadScore_Recalculate` for the authoritative COLD, WARM, QUALIFIED, and HOT score bands.
- `SocialLead_GetUnified` and `LeadActivities` so conversion history appears in Lead 360.
- Existing Meta/social listener, Landing Page, Buffer, Campaign, AI Campaign, integration event, and n8n-facing routes without changing their behavior.

The configured MSSQL target was checked read-only before implementation. It contains the required Company Profile, AI-provider, Lead, routine-event, interaction, conversation, and Lead 360 procedure surfaces.

## Module layout

The dashboard has an independent **AI Acquisition** navigation category with Overview, Acquisition Configurations, Prospects, Conversations, Search Sources, Communication Settings, and Analytics.

Files changed for this module: `.env.example`, `.env.production.example`, `README.md`, `app/api/acquisition/[...path]/route.ts`, `app/components/AIAcquisition.tsx`, `app/globals.css`, `app/page.tsx`, `docs/ai-acquisition.md`, `package.json`, `proxy.ts`, `social/acquisition.mjs`, `social/ai-providers.mjs`, `social/server.mjs`, `social/sql-server.mjs`, `sql/026_ai_acquisition.sql`, `tests/acquisition.test.mjs`, and `tests/rendered-html.test.mjs`.

Configurations select an existing AI provider, reuse Company Profile ID 1, and store their own targets, sources, qualification fields, handoff policy, follow-up policy, and communication ordering. Active configurations run discovery on the acquisition timer and can also be run manually. Repeated runs are bounded by the daily prospect limit and unique prospect identities. Automatic outreach is disabled by default and requires an explicit per-configuration opt-in; its timer queues at most the configured batch size of consented, policy-allowed prospects, then follows the configured delay, maximum follow-ups, and channel ordering. Queueing does not itself deliver a message.

## Discovery providers

`social/acquisition.mjs` defines `searchProspects()`, `getProspectDetails()`, `enrichProspect()`, `normalizeProspect()`, and `validateProspect()`.

Installed adapters are Google Places, existing/inactive CRM Leads, Landing Page activity, Instagram/Facebook inbound activity, and CSV row import. The Prospect workspace accepts a CSV with `companyName` or `businessName` and optional contact, source ID, and consent columns. Website forms, approved directories, and partner APIs are configurable placeholders; the engine reports that no adapter is installed instead of silently fabricating results.

Google Places uses the Text Search v1 API. It stores the Place ID as the external source ID and records Google Places as provenance for returned phone and website values. It does not invent email or social values.

Prospect identity is SHA-256 over `source + externalSourceId` when a stable external ID exists. Otherwise it uses normalized business name/domain/email/phone/location. MSSQL enforces uniqueness for both the configuration identity and non-null source/external ID.

## Communication and conversation policy

Each channel has enabled state, priority, maximum attempts, retry delay, next-channel delay, stop-on-response, and explicit simultaneous-channel behavior. The policy engine blocks disabled channels, missing or invalid contact data, maximum-attempt violations, opt-out/revoked consent/`DO_NOT_CONTACT`, delay windows, and escalation after a response.

The engine selects the first allowed configured method. A contact request creates an idempotent MSSQL queue record; it does not expose credentials or let the model bypass the policy engine. The claim procedure rechecks configuration state, date window, channel enablement, consent, contact provenance, maximum attempts, delay, response, and opt-out before returning work. A successful completion records a sent conversation and advances the contact delay. Manual follow-up is a review task, not an automatic message.

An external delivery worker can `POST /api/acquisition/outreach/claim` with `Authorization: Bearer <SERVICE_AUTH_TOKEN>` and `{ "limit": 10 }`, send via an existing approved channel integration, then `POST /api/acquisition/outreach/<attemptId>/complete` with the same service token and `{ "lockToken": "<claim token>", "succeeded": true, "externalMessageId": "<provider ID>" }`. Failed attempts may return `retryable` and `nextAttemptAt`. The worker should pass the attempt idempotency key to its provider if supported and must not send a manual review task as a message. **No built-in Email, WhatsApp, SMS, or Meta delivery worker is installed by this module, and existing n8n workflows are not automatically rewired.** Until a worker is connected, queued attempts remain unsent.

Incoming messages are stored before AI processing. The selected existing AI provider receives Company Profile, acquisition configuration, known prospect fields, conversation history, and missing qualification fields. It must return:

```json
{
  "intent": "",
  "confidence": 0,
  "next_action": "",
  "response": "",
  "qualification_field": "",
  "extracted_information": {},
  "request_human": false
}
```

The server normalizes the result, applies confidence/handoff rules, validates the proposed response through communication policy, and persists it as `PROPOSED` or `BLOCKED`. Autonomous selling stops in `HUMAN_HANDOFF`. Manual follow-up creates a separate review task visible on Acquisition Overview; CRM users can mark it reviewed. The outbound delivery claim procedure never returns manual tasks.

## Prospect-to-Lead conversion

Prospects remain in `AIAcquisitionProspects` until explicit conversion after response/engagement or Landing Page registration (unless the configuration relaxes that rule), the configured fit threshold, and do-not-contact checks. Conversion calls `CRMLead_UpsertFromRoutine` using `acquisition-prospect:<id>`, retaining existing email/phone/social matching. For a Prospect discovered from an existing CRM Lead, the known Lead ID is linked directly and an idempotent routine event is recorded; this avoids creating a duplicate when the existing Lead has no usable contact identity. Conversion then links `ConvertedLeadId` and acquisition conversations, adds a conversion activity and summaries of received/sent messages to the existing Lead 360 activity timeline, and calls `LeadScore_Recalculate`. Full conversation text and AI proposals remain in the acquisition conversation table.

AI Acquisition does not define a second Lead entity and does not calculate the final Lead score.

## MSSQL changes

Migration `sql/026_ai_acquisition.sql` adds:

- `AIAcquisitionConfigurations`
- `AIAcquisitionSearchSources`
- `AIAcquisitionCommunicationMethods`
- `AIAcquisitionProspects`
- `AIAcquisitionProspectContacts`
- `AIAcquisitionConversations`
- `AIAcquisitionContactAttempts`

It also adds unique deduplication/message/idempotency indexes, status/query indexes, and configuration, prospect, conversation, contact-attempt, overview, analytics, and conversion procedures. Analytics reads persisted acquisition records and authoritative Lead score bands; it does not recalculate scores. The `LeadsCreated` database metric counts Prospects linked to a Lead, whether the existing matcher created a new Lead or matched an existing one; the UI labels this “Leads created/matched.”

## API and deployment

Authenticated Next.js requests under `/api/acquisition/*` proxy to matching listener routes for configurations/action, discovery, prospects/import/contact/convert, overview, source/channel settings, and analytics. Worker claim/complete and `POST /api/acquisition/conversations/incoming` require the service Bearer token at the public Next.js boundary; a CRM browser session alone is not accepted for these integration routes.

The timer runs discovery for active configurations and, when explicitly enabled, queues bounded initial outreach and follow-ups. Webhook identity resolution for incoming messages and a push/email CRM-user notification dispatcher are not included. Incoming messages must be supplied with a known Prospect ID and stable external message ID. Manual reviews are visible in Acquisition Overview, but assignment and proactive notification require an external integration. Score-triggered handoff thresholds are stored but do not dispatch a CRM notification without that integration.

Apply the numbered migrations and restart the application:

```powershell
npm run db:setup:mssql
npm run build
npm start
```

Server-only environment variables:

```text
AI_ACQUISITION_INTERVAL_MS=900000
AI_ACQUISITION_OUTREACH_BATCH_SIZE=10
GOOGLE_PLACES_API_KEY=<key with Places API access>
```

Existing SQL, service-auth, channel-encryption, AI-provider-encryption, Meta, email, SMS, WhatsApp, Buffer, and Cloudinary variables remain unchanged. Never prefix the Google key with `NEXT_PUBLIC_`.

## Validation

The acquisition tests cover configuration validation, stable normalization and contact provenance, channel priority/policy enforcement, daily-limit discovery and deduplication, consent-gated automatic scheduling, conversion criteria, opt-out handling, structured AI fallback, and independent listener routes. The normal full regression suite remains the release gate for Campaigns, AI Campaigns, Buffer, Landing Page Studio, social listener, Lead scoring, and Lead 360. Migration 026 was applied to the configured production MSSQL database on 2026-09-19 after a user-confirmed backup. Read-only smoke checks verified all seven acquisition tables, 16 stored procedures, and the configuration, prospect, overview, and analytics reads. No acquisition configuration or prospect existed at verification time; a delivery worker and inbound channel integration are still required before messaging can run.
