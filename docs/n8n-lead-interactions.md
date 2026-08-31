# n8n lead interaction contract

n8n monitors provider comments and DMs, but CRM360 owns lead identity, deduplication, and scoring. Send normalized events directly to the Social Listener with `Authorization: Bearer <SERVICE_AUTH_TOKEN>`.

## Record an interaction

`POST /lead-interactions`

```json
{
  "platform": "instagram",
  "externalUserId": "provider-user-123",
  "username": "customer_name",
  "externalInteractionId": "provider-comment-456",
  "externalPostId": "provider-post-789",
  "campaignId": "provider-campaign-10",
  "campaignPostId": 42,
  "interactionType": "COMMENT",
  "direction": "INBOUND",
  "messageText": "Can you send pricing?",
  "intent": "PRICE_REQUEST",
  "intentConfidence": 0.96,
  "createdAt": "2030-01-02T15:04:05.000Z"
}
```

Required values:

- `platform`: `facebook`, `instagram`, or `x`
- `externalInteractionId`: the provider's immutable comment or message ID
- `externalUserId`, or `username` only when the provider has no stable user ID
- `interactionType`: `COMMENT` or `DM`
- `direction`: `INBOUND` or `OUTBOUND`
- `messageText`

`intent` and `intentConfidence` may come from the existing OpenAI classification step. CRM360 applies the deterministic scoring formula; n8n and OpenAI must not submit a final score.

Example response:

```json
{
  "ok": true,
  "duplicate": false,
  "leadCreated": false,
  "leadUpdated": true,
  "interactionInserted": true,
  "leadId": 392,
  "score": 87,
  "band": "HOT",
  "qualified": true
}
```

Repeated delivery of the same `platform` plus `externalInteractionId` returns `duplicate: true` and `interactionInserted: false`.

## Record an outbound response

Call the same endpoint only after the provider confirms a successful send. Set:

```json
{
  "interactionType": "DM",
  "direction": "OUTBOUND",
  "deliveryConfirmed": true
}
```

CRM360 rejects unconfirmed outbound records with HTTP `409`. Outbound messages update `LastResponse*` but do not increase the lead's behavior score.

## Rescore and branch

New interactions are scored automatically. To refresh recency without adding an interaction, call `POST /leads/{leadId}/score` with the same bearer token.

Branch n8n from the CRM response:

- `COLD` (`0-29`): store and monitor
- `WARM` (`30-59`): nurture
- `QUALIFIED` (`60-79`): qualified-lead workflow
- `HOT` (`80-100`): priority response and optional sales notification

The authenticated Next.js application also exposes proxy routes at `POST /api/social/interactions` and `POST /api/social/leads/{leadId}/score`.
