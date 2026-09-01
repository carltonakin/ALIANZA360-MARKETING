# CRM lead interaction API for n8n

CRM360 owns lead identity, interaction idempotency, historical scoring, and MSSQL writes. n8n owns Instagram comment/DM orchestration, and OpenAI owns classification and reply generation only. Neither n8n nor OpenAI may submit or directly update CRM scoring fields.

For n8n, only `POST /api/leads/interactions` and `POST /api/leads/{leadId}/intent` use `Authorization: Bearer <SERVICE_AUTH_TOKEN>`. The application validates that token against the server-side `SERVICE_AUTH_TOKEN` environment variable before forwarding to the internal Social Listener. These two service routes do not accept a CRM browser session as a substitute. Missing, malformed, or incorrect Bearer credentials return `401` with `{ "ok": false, "error": "Unauthorized." }`.

Other application routes, including lead detail and history retrieval, retain the existing CRM user/session and role protections.

## Record an inbound interaction

`POST /api/leads/interactions`

```json
{
  "platform": "instagram",
  "externalUserId": "17841400123456789",
  "username": "johnsmith",
  "externalInteractionId": "ig_comment_987654",
  "externalPostId": "ig_post_123456",
  "interactionType": "COMMENT",
  "direction": "INBOUND",
  "messageText": "How much is this and can I book Friday?",
  "campaignId": 42,
  "campaignPostId": 81,
  "occurredAt": "2026-08-31T19:00:00Z"
}
```

Required values are:

- `platform`: `facebook`, `instagram`, or `x`
- `externalInteractionId`: the provider's immutable comment or message ID
- `externalUserId`, or `username` only when the provider has no stable user ID
- `interactionType`: `COMMENT` or `DM`
- `direction`: `INBOUND` or `OUTBOUND`
- `messageText`

CRM matches `platform + externalUserId` first. When no stable ID exists, it uses `platform + username`. It inserts or reuses the Lead, inserts one `SocialInteractions` row (the existing LeadInteraction equivalent), updates latest inbound fields, recalculates the score from full inbound history, and commits those operations in one MSSQL transaction.

Example authoritative response:

```json
{
  "ok": true,
  "leadId": 392,
  "leadCreated": false,
  "interactionId": 5821,
  "interactionInserted": true,
  "duplicate": false,
  "duplicateInteraction": false,
  "score": 87,
  "band": "HOT",
  "qualified": true,
  "scoreReason": "Intent 35/35; engagement 20/20 across 3 inbound interactions; fit 12/15; recency 15/15 (0 days); source 15/15."
}
```

The MSSQL unique key on platform plus external interaction ID is the final race-condition guard. A repeated webhook returns `duplicateInteraction: true` and `interactionInserted: false`; n8n must stop processing that event.

## Submit OpenAI intent classification

`POST /api/leads/{leadId}/intent`

```json
{
  "interactionId": 5821,
  "intent": "booking",
  "intentConfidence": 0.96,
  "pricingIntent": true,
  "purchaseIntent": true
}
```

CRM verifies that the interaction belongs to the lead, maps supported intent aliases to CRM categories, stores the AI classification metadata with the interaction, and recalculates the deterministic historical score. A mismatched lead/interaction pair returns `404`. Submitted `score`, `leadScore`, score components, bands, reasons, or scoring timestamps are rejected because those fields are CRM-owned.

OpenAI may classify intent and generate a reply, but it does not write MSSQL and does not calculate the final lead score.

## Record a successful outbound AI response

After Instagram confirms that a comment reply or DM was sent, call `POST /api/leads/interactions`:

```json
{
  "leadId": 392,
  "platform": "instagram",
  "externalInteractionId": "ig_reply_456789",
  "externalPostId": "ig_post_123456",
  "interactionType": "DM",
  "direction": "OUTBOUND",
  "messageText": "Yes, Friday is available. I can help you with the booking.",
  "deliveryConfirmed": true,
  "occurredAt": "2026-08-31T19:04:00Z"
}
```

`leadId` allows the outbound response to be attached without repeating the provider user identity. CRM validates that lead, deduplicates the provider response ID, inserts the outbound history row, and updates `LastResponseAt`, `LastResponseType`, and `LastResponseText`. Unconfirmed outbound records return `409` and are not stored. Outbound responses do not increase behavioral scoring.

## Retrieve CRM history and details

- `GET /api/leads/{leadId}/interactions` returns comments, DMs, and outbound responses newest first.
- `GET /api/leads/{leadId}` returns the Lead, component scores, score reason, latest inbound interaction, latest outbound response, social accounts, and unified history.

These retrieval routes require the existing authenticated CRM user session; the n8n service-token exception does not apply to them.

## Required n8n flow

1. Receive and normalize the Instagram comment or DM.
2. POST the inbound event to `/api/leads/interactions`.
3. Stop when `duplicateInteraction` is `true`.
4. Send the new message/context to OpenAI for classification and reply generation.
5. POST the OpenAI classification to `/api/leads/{leadId}/intent`.
6. Branch using the CRM-returned score and band.
7. When workflow policy permits, post the generated reply through the Instagram API.
8. Only after a successful provider send, record it as an `OUTBOUND` interaction with `deliveryConfirmed: true`.

Branching bands are `COLD` (0-29), `WARM` (30-59), `QUALIFIED` (60-79), and `HOT` (80-100). CRM may raise or lower scores as interactions age because recency is recalculated from history.

The internal Social Listener retains equivalent service routes (`/lead-interactions`, `/leads/{leadId}/intent`, `/leads/{leadId}/interactions`, and `/leads/{leadId}`) for same-host operation. n8n should normally use the public `/api/leads/...` routes.
