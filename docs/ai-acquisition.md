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

Files changed for this module include `.env.example`, `.env.production.example`, `README.md`, `app/api/acquisition/[...path]/route.ts`, `app/components/AIAcquisition.tsx`, `app/globals.css`, `app/page.tsx`, `docs/ai-acquisition.md`, `package.json`, `proxy.ts`, `social/acquisition.mjs`, `social/ai-providers.mjs`, `social/server.mjs`, `social/sql-server.mjs`, `sql/026_ai_acquisition.sql`, `sql/028_apollo_selective_enrichment.sql`, `tests/acquisition.test.mjs`, and `tests/rendered-html.test.mjs`.

Configurations select an existing AI provider, reuse Company Profile ID 1, and store their own targets, sources, qualification fields, handoff policy, follow-up policy, and communication ordering. Active configurations run discovery on the acquisition timer and can also be run manually. Repeated runs are bounded by the daily prospect limit and unique prospect identities. Automatic outreach is disabled by default and requires an explicit per-configuration opt-in; its timer queues at most the configured batch size of consented, policy-allowed prospects, then follows the configured delay, maximum follow-ups, and channel ordering. Queueing does not itself deliver a message.

## Discovery providers

`social/acquisition.mjs` defines `searchProspects()`, `getProspectDetails()`, `enrichProspect()`, `normalizeProspect()`, and `validateProspect()`.

Installed adapters are Google Places, existing/inactive CRM Leads, Landing Page activity, Instagram/Facebook inbound activity, and CSV row import. The Prospect workspace accepts a CSV with `companyName` or `businessName` and optional contact, source ID, and consent columns. Website forms, approved directories, and partner APIs are configurable placeholders; the engine reports that no adapter is installed instead of silently fabricating results.

Google Places uses the Text Search v1 API. It stores the Place ID as the external source ID and records Google Places as provenance for returned phone and website values. It does not invent email or social values.

Apollo.io decision-maker discovery is available as the optional `APOLLO_IO` source. Its primary path calls People Search and stores Apollo person and organization IDs, name, job title, seniority, company/domain, location, and LinkedIn URL without requesting email or phone. Titles and seniorities are editable per acquisition; the defaults target owners, founders, executives, directors, and managers. Filters support organization/person locations, organization domains and IDs, employee ranges, technologies, exclusions, keywords, paging, and up to 100 results. When Google Places or another existing source has a reliable website, Apollo prefers a domain-scoped search unless that behavior is disabled. Company Search remains an explicitly enabled compatibility option.

Apollo enrichment is a separate timer/manual stage after the existing Prospect Fit Score. Production batches contain at most ten people and use stable Apollo person IDs. Standard People Enrichment is off until explicitly enabled. A standard result with an acceptable business email stops email enrichment. Waterfall Email runs only when enabled, the configured higher fit threshold passes, standard enrichment produced no acceptable email, the Prospect is not suppressed, and both credit limits allow it. Native phone and Waterfall Phone have their own switches and high-fit threshold, run only when SMS or WhatsApp is relevant to configured communication priority, and can be deferred when a higher-priority usable email exists. An Apollo phone is stored only as `Phone`; it is never copied into `WhatsAppNumber` or treated as WhatsApp consent.

Async phone and waterfall results use Apollo polling rather than a public webhook. The signed 64-bit Apollo request ID is stored as text, the acquisition timer honors provider retry timing, and completion maps records by Apollo person ID. Retries and duplicate results update the provider profile and the existing contact record idempotently. Apollo never sends outreach: the existing Communication Priority Engine, consent checks, opt-out/`DO_NOT_CONTACT` rules, and n8n delivery worker remain authoritative.

Paid enrichment requires a positive daily and monthly credit limit. A zero limit is an intentional hard stop. Usage records include People Search, standard enrichment, waterfall email, native phone, waterfall phone, attempts, successes, provider-reported credits, temporary reservations, failures, and rate limits. The Search Sources screen provides connection testing, local usage/error history, and a manual eligible-enrichment action without exposing the API key.

Apollo endpoint authorization is treated as a separate, permanent condition rather than a transient failure. A `401` or `403` from People Search or Company Search is recorded as `ACCESS_DENIED`; later scheduled acquisition ticks skip that endpoint instead of retrying it. **Test Connection** validates both the API credential and the configured search endpoint with a one-result, zero-credit access check. A successful manual test after Apollo grants access clears the circuit breaker. The CRM never falls back to a different Apollo endpoint to bypass a denied permission.

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

Migration `sql/028_apollo_selective_enrichment.sql` adds `AIAcquisitionApolloProfiles` and `AIAcquisitionApolloUsage`. These are provider-specific state/audit tables linked to the existing Prospect and configuration tables. They enforce one Apollo person per acquisition, track enrichment fields and async polling, and write accepted contact data through the existing Prospect/contact model. They do not create a second Prospect or Lead model, call Lead scoring, alter Lead 360, or change conversion.

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
APOLLO_API_KEY=<Apollo API key with People Search, People Enrichment, and profile access>
```

Existing SQL, service-auth, channel-encryption, AI-provider-encryption, Meta, email, SMS, WhatsApp, Buffer, and Cloudinary variables remain unchanged. Never prefix the Google or Apollo key with `NEXT_PUBLIC_`.

### Apollo production deployment

1. Take and verify a fresh backup of the production MSSQL database.
2. Set `APOLLO_API_KEY` as a server-side SmarterASP application variable; do not send it through chat, store it in source control, or prefix it with `NEXT_PUBLIC_`.
3. Stop the application/acquisition timer, then publish the application files without starting the new build yet.
4. Run `npm run db:setup:mssql` so migration 028 is applied after the existing numbered migrations.
5. Start the application and use **AI Acquisition -> Search Sources -> Apollo -> Test Connection**.
6. Enable Apollo People Search in the acquisition configuration. Configure target filters/titles, enable only the desired enrichment stages, and set explicit non-zero daily/monthly credit limits.
7. Run a controlled discovery. Confirm decision-maker names and Apollo IDs exist before running **Run Eligible Enrichment**.
8. Verify one accepted business email, one intentionally eligible async result, usage totals, no duplicate contact records, and that any phone remains separate from WhatsApp.
9. Confirm the existing n8n queue still claims outreach only after the Communication Priority Engine and consent policy allow it.

Rollback is operationally safe: disable the Apollo source or all enrichment switches first, then redeploy the prior application build if needed. Migration 028 is additive; keep its audit tables unless a separately reviewed data-retention change is approved.

## Validation

The acquisition tests cover configuration validation, stable normalization and contact provenance, People Search without paid enrichment, configurable filters, stable Apollo IDs, bulk limits, fit gating, acceptable standard email stopping waterfall, selective waterfall, disabled phone-channel behavior, async correlation, WhatsApp separation, channel priority/policy enforcement, daily-limit discovery and deduplication, consent-gated automatic scheduling, conversion criteria, opt-out handling, structured AI fallback, and independent listener routes. The normal full regression suite remains the release gate for Campaigns, AI Campaigns, Buffer, Landing Page Studio, social listener, Lead scoring, and Lead 360. Migration 026 was applied to the configured production MSSQL database on 2026-09-19 after a user-confirmed backup. Migration 028 must not be applied until a fresh production backup is confirmed for this Apollo change.

## AI discovery Search Sources

The existing Acquisition Configuration → Search sources checklist includes **ChatGPT (OpenAI)**, **Gemini (Google)**, and **Claude (Anthropic)**. Their stable IDs are `chatgpt`, `gemini`, and `claude`; persisted source codes follow the existing uppercase convention (`CHATGPT`, `GEMINI`, `CLAUDE`). Each defaults to disabled and has its own enabled flag, priority, and existing source settings. Older configurations keep their saved selections. The editor appends missing sources as disabled. No separate search panel, acquisition workflow, schema migration, or tables are required.

Enable the desired source and run the existing discovery action, or let the existing active-configuration job run it within its date window. Prospects use the same normalization, fit scoring, daily caps, review, communication/consent rules, and Lead conversion. Missing credentials, disabled search tools, rejected constraints, and partial source failures appear in the existing feedback area. Other selected sources continue running.

Reuse the enabled encrypted provider credential/model from AI Configuration, or configure server-only credentials. Search-specific model variables override the saved/general model; choose models available to your account that support these tools:

| Source | Credential fallback | Search model override | Required opt-in |
| --- | --- | --- | --- |
| ChatGPT | `OPENAI_API_KEY` | `OPENAI_SEARCH_MODEL` | `ACQUISITION_OPENAI_WEB_SEARCH=true` |
| Gemini | `GEMINI_API_KEY` | `GEMINI_SEARCH_MODEL` | `ACQUISITION_GOOGLE_WEB_SEARCH=true` |
| Claude | `ANTHROPIC_API_KEY` | `CLAUDE_SEARCH_MODEL` | `ACQUISITION_ANTHROPIC_WEB_SEARCH=true` |

These use OpenAI Responses `web_search`, Gemini GenerateContent `google_search` grounding, and Anthropic `web_search_20250305`. Model IDs are configurable; none is hardcoded for discovery. The account must permit the respective tool. A request that does not actually perform web search cannot import prospects. API calls time out after 45 seconds; transient failures retry up to three attempts with bounded backoff. Invalid configuration/authentication failures do not retry.

Only targeting fields (industry, customer type, location, business size, keywords and source search terms) leave the CRM. Private CRM records, inactive Leads, landing registrations, conversations, and Company Profile data are not sent. Configuration/account relationships remain in the existing authenticated repository pipeline.

Existing source settings `searchTerms`, `industryOrCategory`, `keywords`, `location`, `resultLimit`, `dailyProspectLimit`, and `minimumFitScore` are supported. Source overrides follow the existing Google Places convention. Existing keyword fit scoring and qualification thresholds remain authoritative. Industry, location, customer type, and size require literal supporting phrases on the business evidence page; synonyms, ambiguous regions, or inferred employee counts can be rejected. Unknown settings (for example radius, arbitrary status/date filters, or include/exclude expressions) return an explicit unsupported-constraint error. The existing start/end dates still control the scheduled configuration, rather than filtering web page dates.

Each candidate must cite a URL present in the provider's actual web citations. The server verifies a publicly accessible business-owned HTTPS HTML/text page, checks the company and any accepted contact values against visible text, and discards guessed email/phone values, social handles, consent claims, and model scores. Browser rendering, protected/paywalled pages, PDFs, redirects, IPv6-only sites, blocked robots rules, and unverifiable evidence cannot qualify. Retrieval uses validated, pinned public IPv4 addresses, bounded page sizes, per-page timeouts, and a 15-second evidence budget; no anti-bot bypass is attempted. Results are capped at ten candidates per source call and respect lower configured/remaining limits. Empty and rejected results are reported without inventing replacements.

The existing prospect identity/upsert path merges AI discoveries of the same canonical business domain; scoped website matching also reuses an existing prospect from another source. Evidence from each AI source remains in prospect metadata and is linked in the existing Prospect table. The first source label and consent/engagement lifecycle remain intact. This conservative business-domain identity can combine branches sharing one domain; person-level discovery remains the existing Apollo workflow. No raw page body is retained. Operator review is still required before conversion/outreach under the existing rules.

Verification uses mocked provider/evidence responses for all three sources, persistence/defaults, supported/rejected criteria, missing credentials/tools, error/retry behavior, evidence rejection, and cross-source deduplication. Live paid provider calls and account-specific model/tool permissions have not been verified by these tests.

API references: [OpenAI](https://developers.openai.com/api/docs/guides/tools-web-search), [Gemini](https://ai.google.dev/gemini-api/docs/google-search), [Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).
