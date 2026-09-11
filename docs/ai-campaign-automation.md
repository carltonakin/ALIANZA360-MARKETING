# Multi-provider AI campaign automation

## Architecture audit

Before this release, the CRM had one manual publishing path:

`Campaign form -> dbo.Campaigns -> dbo.CampaignPosts -> BufferCampaignService -> Buffer`

`CampaignPosts` has one row per Campaign/Buffer-channel pair and the database
enforces that identity. Campaign media is uploaded by the existing Express
multipart endpoint to Cloudinary; SQL stores only Cloudinary identity and
`secure_url`. The pre-existing campaign automation engine polls Facebook,
Instagram, and X for lead activity and is independent from content publishing.
The live database did not contain a Company Profile table, so migration 024
adds one authoritative singleton instead of asking for company data on every
campaign.

## Provider and campaign design

`social/ai-providers.mjs` defines a common normalized output contract and
provider adapters for OpenAI Responses, Anthropic Messages, and Gemini
generateContent. Provider-specific HTTP bodies, authentication headers, model
selection, structured-output settings, retries, and response extraction stay
inside those adapters. The application consumes only:

- headline, caption, body, hashtags
- CTA text and URL
- content type
- image and video prompts
- platform and recommended UTC publish time
- actual provider/model metadata

The initial adapters advertise `TEXT_GENERATION` and `STRUCTURED_OUTPUT`.
Image/video prompts are retained in generation history. No adapter claims
direct media generation until a real media-generation implementation is
configured. Uploaded or future generated media continues through the existing
Cloudinary endpoint and campaign columns; there is no second media store.

Provider API keys use the existing AES-256-GCM envelope implementation. Only
ciphertext, IV, authentication tag, secret-field name, and key version are
stored in MSSQL. API responses contain only `hasSecret` and a mask. One filtered
unique index allows at most one default provider, and updating another provider
as default clears the old one transactionally.

`AICampaignConfigurations` stores dates, frequency, content categories,
provider/model, optional explicit fallback, selected live Buffer channel IDs,
CTA, destination, publishing mode, and lifecycle status. It is orchestration
configuration—not a publishing table. Every daily channel-specific result is
sent to `BufferCampaignService.scheduleCampaign`, which creates an ordinary
`Campaigns` row and its ordinary `CampaignPosts` row. This preserves the
existing Campaign Studio edit, media replacement, draft, scheduling, and Buffer
status behaviors.

## Scheduling, idempotency, and failures

The listener checks active AI campaigns at startup and at the configured
interval. SQL claims one run for each configuration/date/post slot/Buffer
channel with a serializable transaction and a unique key. Retries reuse that
claim and cannot create another normal run. The end date is inclusive; active
campaigns become `COMPLETED` on the next date and existing posts remain intact.

Each provider request has a bounded three-attempt retry for transient HTTP
errors. The service never changes providers implicitly. It attempts a fallback
only when the campaign stores one explicitly, and history records the actual
provider, model, attempt count, and fallback flag. Failures are redacted and
stored with the run. Regeneration creates a versioned history run but updates
the same unscheduled normal Campaign/CampaignPost; scheduled or published posts
must follow the existing Buffer editing rules.

The Company Profile, campaign objective, selected platform, date/duration,
CTA/destination, and recent successful outputs form the generation context.
Reviewing prior headlines, captions, CTAs, and visual prompts helps the provider
avoid repetitive content.

## Existing systems preserved

The release does not change Meta webhook ingestion, n8n contracts, lead
creation/matching, the Unified Lead Timeline, lead scoring, follow-up automation,
Buffer credentials, Cloudinary credentials, or manual campaign creation.
Generated posts therefore produce comments, DMs, and landing-page traffic that
enter the same existing lead pipeline after publication.
