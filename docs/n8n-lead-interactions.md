# CRM lead interaction API for n8n

CRM360 owns lead identity, interaction idempotency, historical scoring, and MSSQL writes. n8n owns Instagram comment/DM orchestration, and OpenAI owns classification and reply generation only. Neither n8n nor OpenAI may submit or directly update CRM scoring fields.

For n8n, these routes use `Authorization: Bearer <SERVICE_AUTH_TOKEN>`:

- `POST /api/leads/interactions`
- `POST /api/leads/{leadId}/intent`
- `POST /api/leads/{leadId}/replies/automatic`
- `POST /api/replies/outbound/claim`
- `POST /api/replies/{replyId}/complete`

The application validates that token against the server-side `SERVICE_AUTH_TOKEN` environment variable before forwarding to the internal Social Listener. These service routes do not accept a CRM browser session as a substitute. Missing, malformed, or incorrect Bearer credentials return `401` with `{ "ok": false, "error": "Unauthorized." }`.

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

## Deliver CRM-owned outbound replies

Manual and AI-assisted requests are created by authenticated CRM users. The existing fully automatic workflow creates its request before sending by calling `POST /api/leads/{leadId}/replies/automatic`:

```json
{
  "inReplyToInteractionId": 5821,
  "messageText": "Yes, Friday is available. I can help you with the booking.",
  "idempotencyKey": "automatic:ig_comment_987654:v1"
}
```

The response is `202` for a new request or `200` for an idempotent replay. It contains `replyId`, plus a `reply` object whose `responseStatus` remains `PENDING`. A successful manual reply or another pending/successful automatic reply returns `409`. A manual or AI-assisted request created before an automatic request is claimed cancels that pending automatic request in the same MSSQL transaction; Lead 360 shows the cancelled attempt as `FAILED` with “Superseded by a human reply before delivery.”

n8n claims work through `POST /api/replies/outbound/claim`:

```json
{ "limit": 10 }
```

To claim one request immediately after automatic reservation, include its numeric `replyId`:

```json
{ "replyId": 5822, "limit": 1 }
```

The response contains a server-generated `lockToken` and `replies`. Each reply includes its type (`COMMENT` or `DM`), text, response mode, original Instagram interaction ID, post ID, conversation ID, and external user ID. Only a claimed request may be sent. n8n must route `COMMENT` to the Instagram comment-reply operation and `DM` to the Instagram messaging operation.

After Instagram responds, n8n calls `POST /api/replies/{replyId}/complete` with the claim's lock token. Success requires Instagram's immutable reply/message ID:

```json
{
  "lockToken": "8e57bbf5-f4e7-4ccb-9bf7-7fa8d82dbe30",
  "succeeded": true,
  "externalReplyId": "ig_reply_456789",
  "externalStatus": "sent",
  "sentAt": "2026-08-31T19:04:00Z",
  "providerResponse": { "id": "ig_reply_456789" }
}
```

For a transient failure, request a retry. `nextAttemptAt` is optional; CRM defaults it to one minute later:

```json
{
  "lockToken": "8e57bbf5-f4e7-4ccb-9bf7-7fa8d82dbe30",
  "succeeded": false,
  "retryable": true,
  "nextAttemptAt": "2026-08-31T19:06:00Z",
  "error": "Instagram rate limit"
}
```

For a permanent failure use `"retryable": false`. CRM marks the interaction `FAILED`. It marks a reply `SENT`, writes `ExternalReplyId`/`SentAt`, and updates the Lead's latest-response summary only after a successful completion. Repeating a completion is idempotent. Outbound replies never invoke lead rescoring.

The legacy confirmed-outbound form of `POST /api/leads/interactions` with `deliveryConfirmed: true` remains accepted for backward compatibility, and such records display as `AI_AUTOMATIC`. New automatic sends must use reserve/claim/complete so database conflict checks run before the Instagram API call.

## Retrieve CRM history and details

- `GET /api/leads/{leadId}/interactions` returns comments, DMs, and outbound responses newest first.
- `GET /api/leads/{leadId}` returns the Lead, component scores, score reason, latest inbound interaction, latest outbound response, social accounts, and unified history.
- Lead 360 renders the Instagram subset chronologically (oldest to newest), labels direction/type/mode/sender/status, and polls while an outbound request is pending.

These retrieval routes require the existing authenticated CRM user session; the n8n service-token exception does not apply to them.

## Required n8n flow

1. Receive and normalize the Instagram comment or DM.
2. POST the inbound event to `/api/leads/interactions`.
3. Stop when `duplicateInteraction` is `true`.
4. Send the new message/context to OpenAI for classification and automatic reply generation.
5. POST the OpenAI classification to `/api/leads/{leadId}/intent`.
6. Branch using the CRM-returned score and band.
7. When automatic policy permits, reserve the response with `/api/leads/{leadId}/replies/automatic`. Stop on `409`.
8. Claim that `replyId` with `/api/replies/outbound/claim`. Never send an unclaimed request.
9. Post the claimed reply through the appropriate Instagram COMMENT or DM API.
10. Complete the request with the provider result and external reply ID. Report transient failures as retryable.

A second n8n workflow should poll `/api/replies/outbound/claim` on a short schedule to deliver manual and AI-assisted requests created in Lead 360, then use the same Instagram-send and completion nodes. Keep the existing automatic trigger, classification, OpenAI generation, and reply logic; insert the CRM reserve/claim step before its current Instagram node and replace its post-send history call with the completion call.

Branching bands are `COLD` (0-29), `WARM` (30-59), `QUALIFIED` (60-79), and `HOT` (80-100). CRM may raise or lower scores as interactions age because recency is recalculated from history.

The internal Social Listener retains equivalent service routes (`/lead-interactions`, `/leads/{leadId}/intent`, `/leads/{leadId}/replies/automatic`, `/reply-requests/claim`, and `/reply-requests/{replyId}/complete`) for same-host operation. n8n should normally use the public `/api/...` routes.
