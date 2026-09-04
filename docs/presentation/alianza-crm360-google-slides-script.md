# Alianza CRM Marketing 360 — Google Slides Explainer Pack

This package is written for a 12–15 minute presentation to business leaders,
marketing, sales, operations, and technical stakeholders. It can be pasted into
Google Slides, Gemini, or another presentation builder as source material.

The communication goal is: by the end, stakeholders should understand how
Alianza CRM Marketing 360 turns social engagement and campaign activity into
one secure, scored, actionable CRM record, with Microsoft SQL Server as the
source of truth.

## 30-second opening script

Alianza CRM Marketing 360 brings the marketing and sales journey into one
operating system. It captures interactions from Facebook, Instagram, X,
landing pages, webinars, and manually entered leads; connects those signals to
one person; scores intent from the person's complete history; and gives the
team a prioritized view of what to do next. Campaign media is managed through
Cloudinary, publishing is scheduled through Buffer, workflow automation is
handled through n8n, and every authoritative CRM record remains in Microsoft
SQL Server.

## Design direction for Google Slides

- Use a 16:9 widescreen layout.
- Use a warm off-white background, charcoal text, violet accents, and small
  coral or mint highlights to match the CRM interface.
- Suggested colors: `#F7F6F2`, `#303440`, `#7465D8`, `#ED8A65`, and `#4AA57D`.
- Use a clean sans-serif typeface such as Inter, Aptos, or Montserrat.
- Keep slide titles at 35–42 pt and body text at 18–22 pt.
- Use one main visual per slide. Avoid dense grids of small cards.
- Crop screenshots to the relevant workflow and place a short caption below.
- Never show passwords, access tokens, database credentials, private messages,
  email addresses, phone numbers, or other personally identifiable data.

---

## Slide 1 — One system connects engagement to revenue

### On-slide copy

**Alianza CRM Marketing 360**

From social conversation to qualified lead, campaign follow-up, and reporting.

### Speaker script

Alianza CRM Marketing 360 is designed to connect marketing activity with sales
action. Instead of leaving social conversations, campaign activity, and lead
details in separate tools, the system brings them into one CRM workflow. It
captures the interaction, identifies or creates the correct lead, records the
source, evaluates intent, updates the lead score, and makes that result visible
to the team. The goal is not simply to collect more activity. The goal is to
help the organization recognize which people are ready for attention and act
with the full context of their history.

### Suggested visual

Use the CRM logo or a full-width crop of the dashboard with a light violet
overlay. Do not show individual lead details on the title slide.

### Screenshot reference

`01_dashboard_overview.png` — **CRM Marketing 360: Executive Overview**

---

## Slide 2 — The CRM creates one operating view across the funnel

### On-slide copy

- Capture leads from social, forms, webinars, and manual entry.
- Preserve every interaction and acquisition source.
- Prioritize follow-up with intent and historical scoring.
- Build and schedule campaigns without leaving the CRM.
- Measure lead quality with live, SQL-backed reports.

### Speaker script

The platform covers the working lifecycle of a lead. Marketing can manage
campaigns and audience touchpoints, while sales can see each person's identity,
source, intent, score, and interaction history. Operations can confirm whether
the supporting services are healthy. Management can use the Reports workspace
to compare lead quality by temperature, intent, source, campaign, and
engagement. These are not separate copies of the data. Each view reads from the
same authoritative CRM records.

### Suggested visual

Use five connected stages: Capture, Understand, Prioritize, Engage, Measure.

---

## Slide 3 — Every signal follows a controlled path into the CRM

### On-slide copy

```text
Facebook / Instagram / X / Forms
                 ↓
        n8n normalization
                 ↓
      Secure CRM API endpoints
                 ↓
Identity + interaction + attribution
                 ↓
      Historical lead scoring
                 ↓
 Sales workflow and live reporting
```

### Speaker script

Inbound activity enters through controlled integrations. n8n receives and
normalizes approved social events, then submits the event to the CRM through a
service-authenticated API. The CRM resolves the person's identity, prevents a
duplicate event, stores the interaction and source attribution, and recalculates
the lead using the complete inbound history. The API returns the CRM-owned
score and temperature so n8n can branch its workflow without inventing a second
scoring model. Forms and webinar registrations enter through their own routes
but arrive at the same system of record.

### Suggested visual

Create a simple left-to-right process arrow using the six stages above.

---

## Slide 4 — Server boundaries keep data and credentials protected

### On-slide copy

```text
Browser
   ↓ authenticated request
Next.js dashboard and route handlers
   ↓ service-authenticated request
Express Social Listener
   ↓ parameterized procedures
Microsoft SQL Server
```

External services are called only from the server.

### Speaker script

The browser never connects directly to SQL Server and never receives provider
credentials. The Next.js application presents the interface and validates the
CRM session. Its route handlers call the internal Express Social Listener with
a server-held service token. The Social Listener owns the Microsoft SQL Server
connection pool and performs database work through typed parameters and stored
procedures. Buffer, Cloudinary, Meta, X, and OpenAI credentials also remain on
the server. This separation reduces credential exposure and keeps business
rules in the CRM service instead of scattering them across the browser.

### Suggested visual

Use the four-layer architecture above, with external services positioned beside
the Express layer rather than beside the browser.

---

## Slide 5 — One person remains one lead across multiple platforms

### On-slide copy

The CRM resolves identity in this order:

1. Platform plus stable external user ID.
2. Platform plus username when no stable ID exists.
3. Existing lead and social-account relationships.
4. A new lead only when no match exists.

Each platform identity is linked to the same lead record.

### Speaker script

Social identities are normalized instead of creating a separate lead every
time the same person interacts on a different platform. The CRM first uses the
provider's stable user ID. When a provider does not supply one, it falls back to
the platform and username. Social account records link Facebook, Instagram,
and X identities to the lead. The Lead 360 view then combines those identities
with conversations, interactions, opportunities, quotes, appointments, and
conversion history. This gives the team one relationship history rather than a
collection of disconnected handles.

### Screenshot reference

`02_lead_360_timeline.png` — **Unified Lead 360: Identity, Score, and Interaction History**

Capture: Leads → choose a record → **360**. Use a test or non-sensitive record
and blur email, phone, usernames, message text, and any personal names.

---

## Slide 6 — Historical scoring identifies who needs attention now

### On-slide copy

**Authoritative score components**

- Intent: up to 35 points
- Engagement: up to 20 points
- Fit: up to 15 points
- Recency: up to 15 points
- Source: up to 15 points

**Temperature bands**

- COLD: 0–29
- WARM: 30–59
- QUALIFIED: 60–79
- HOT: 80–100

### Speaker script

The lead score is deterministic and belongs to the CRM. It is calculated from
the person's inbound interaction history, not from a single message and not in
the presentation layer. Intent carries the greatest weight, followed by
engagement, fit, recency, and source. The resulting score is translated into
four operational bands: Cold, Warm, Qualified, and Hot. Because recency is part
of the model, a score can decrease as activity ages. Outbound replies are kept
in the history but do not artificially increase behavioral scoring.

### Important presenter note

OpenAI may classify intent or generate a proposed reply where configured, but
it does not calculate or write the final lead score. Reports display the score
already stored on the Lead record.

### Screenshot reference

`03_lead_score_explanation.png` — **Why This Lead Has This Score**

Capture the score summary and component breakdown from Lead 360. Redact all
identity and message fields.

---

## Slide 7 — Campaign Studio preserves control from draft to publication

### On-slide copy

```text
Create or edit campaign
        ↓
Validate schedule, channels, and media
        ↓
Upload approved media to Cloudinary
        ↓
Save campaign and post rows in SQL Server
        ↓
Schedule or update posts through Buffer
        ↓
Synchronize publishing status back to CRM
```

### Speaker script

Campaign Studio keeps SQL Server as the record of what the team intended to
publish and what happened afterward. The application validates the schedule,
selected channels, file type, size, and video compatibility. Approved media is
uploaded to Cloudinary, and the returned secure URL and media identity are
saved with the campaign. The CRM creates one post record per selected channel
before Buffer is called. Buffer schedules the outbound posts. Later edits reuse
the existing campaign and Buffer identifiers, while published posts and unsafe
channel removals are protected from accidental duplication.

### Screenshot reference

`04_campaign_studio.png` — **Campaign Studio: SQL-Backed Buffer Publishing**

Capture: Campaigns. Show one campaign card with its channel-post lifecycle.
Redact Buffer IDs, media URLs, and sensitive campaign content.

---

## Slide 8 — Each automation service has one clear responsibility

### On-slide copy

**n8n**

Receives and normalizes social events, coordinates approved workflows, and
records confirmed outbound results.

**Buffer**

Schedules and publishes outbound social campaign posts.

**Cloudinary**

Stores and serves public campaign images and videos.

**CRM + Microsoft SQL Server**

Own lead identity, interactions, attribution, scoring, and reports.

### Speaker script

The architecture avoids overlapping ownership. n8n is the workflow
orchestrator, Buffer is the publishing scheduler, Cloudinary is the campaign
media platform, and the CRM database is the system of record. OpenAI is used
only for the AI tasks already approved, such as structured intent
classification and reply generation. Sprout Social is not part of the current
architecture and was removed without replacing it with another social
management vendor.

### Screenshot reference

`05_social_listener_health.png` — **Social Listener: Provider Health and Qualified Intent Queue**

Capture: Social Listener. Prefer the service-health and provider-status section;
do not include tokens, IDs, or message content.

---

## Slide 9 — Reports turn CRM activity into a prioritized work queue

### On-slide copy

Seven live report views:

1. Lead Scoring
2. Temperature Summary
3. Lead Intent
4. Source Performance
5. Campaign Performance
6. Lead Engagement
7. Hot Leads

Filters, server-side sorting, pagination, and filtered CSV export are included.

### Speaker script

The Reports workspace is built for both daily action and management review.
Sales can start with Lead Scoring or Hot Leads to find the highest-priority
people. Marketing can compare source and campaign performance. Operations can
review engagement patterns and the current distribution across temperature
bands. Filters and sorting are executed on the server, which keeps large data
sets manageable. CSV export uses the active filters. Most importantly, reports
read live Microsoft SQL Server records and do not recalculate or override the
authoritative lead score.

### Screenshot reference

`06_reports_navigation.png` — **CRM Reports: Seven Operational and Executive Views**

Capture: Reports with the report tabs, filters, and table header visible. Redact
all lead-level rows if real customer data appears.

---

## Slide 10 — Lead Scoring puts identity, intent, and urgency together

### On-slide copy

The Lead Scoring report brings together:

- Lead name or the best available CRM identifier
- Instagram, Facebook, X, and other usernames
- Authoritative Lead Score
- Latest authoritative intent
- COLD, WARM, QUALIFIED, or HOT band
- Latest interaction and date
- Source and campaign attribution

Default order: highest score, then most recent interaction.

### Speaker script

This is the central sales-prioritization report. A manager can see who the lead
is, which social identities belong to that person, why the conversation may
matter, and how urgent the follow-up is. The default sort puts the highest
scores first and uses the most recent activity as the secondary order. The team
can narrow results by temperature, score range, intent, platform, source,
campaign, date range, or search text. Multiple social accounts are joined to
one lead rather than producing duplicate rows.

### Screenshot reference

`07_lead_scoring_report.png` — **Lead Scoring Report: Prioritized Follow-Up Queue**

Capture: Reports → Lead Scoring. Apply a non-sensitive filter and show the score,
intent, temperature, last interaction date, and source columns. Blur names and
social usernames if the data is not a demo environment.

---

## Slide 11 — Security separates people, services, and administrator actions

### On-slide copy

**CRM users**

- Secure, server-validated sessions
- HttpOnly cookie
- ADMIN and BASIC roles

**Automation services**

- Separate Bearer-token authentication
- Limited lead-interaction endpoints for n8n

**Data protection**

- Passwords stored as salted scrypt hashes
- Session tokens stored as hashes
- Provider secrets remain server-side or encrypted at rest
- All SQL input is parameterized

### Speaker script

Human and machine access are intentionally separate. CRM users sign in through
the application's session model. Basic users can work with normal CRM modules,
while settings and user administration require the Admin role. n8n does not
impersonate a browser user; it receives a service token and can access only the
approved interaction routes. Passwords and sessions are not stored as plain
text. Provider credentials stay on the server, and database calls use typed
parameters rather than building SQL from browser input.

### Screenshot reference

`08_secure_login.png` — **Secure CRM Access**

Capture: Login page before entering credentials. This is the safest full-screen
image for an external or executive deck.

---

## Slide 12 — Reliability controls prevent duplicates and false success

### On-slide copy

- Provider event IDs enforce interaction idempotency.
- Lead, interaction, attribution, and scoring updates use SQL transactions.
- A repeated webhook returns a duplicate result instead of creating new data.
- An outbound interaction is stored only after delivery is confirmed.
- Campaign failures remain visible without falsely marking posts published.
- Startup requires a real Microsoft SQL Server health check.
- Production reporting contains no mock or fallback records.

### Speaker script

The system is designed around accurate state. Social providers can resend
events, so the CRM uses their immutable interaction IDs to stop duplicates,
including race conditions. Related database changes are committed together in
a transaction. Outbound history is recorded only after the provider confirms
delivery. Campaign and Buffer failures stay visible and do not become false
successes. At startup, the production application confirms that Microsoft SQL
Server is reachable before serving the dashboard. These controls protect the
team from acting on duplicated, incomplete, or invented information.

---

## Slide 13 — Production uses the same SQL-backed path as local operation

### On-slide copy

**SmarterASP.NET production model**

```text
Hosted Node application
  ├─ Next.js CRM dashboard on the assigned public port
  └─ Express Social Listener on a private loopback port
                         ↓
              SmarterASP Microsoft SQL Server
```

Server-only environment variables connect Buffer, Cloudinary, n8n, social
providers, and the database.

### Speaker script

Production runs as one Node application on SmarterASP.NET. The launcher starts
the Express Social Listener on a private loopback port, verifies the Microsoft
SQL Server connection, and then starts the Next.js dashboard on the port
assigned by the host. The browser continues to use relative API routes, so the
same application flow works locally and in production. SQL migrations install
the database procedures, including authentication, historical scoring, lead
interaction APIs, and the seven CRM reports. Credentials are configured in the
hosting control panel and are not committed to source control.

---

## Slide 14 — The system is ready for operational use and measured expansion

### On-slide copy

**Ready now**

- Sprout Social removed from active code and configuration
- Live Microsoft SQL Server reporting installed
- Seven reports available in the authenticated CRM
- n8n, Buffer, Cloudinary, authentication, and scoring preserved
- Automated build, security, and regression checks passing

**Recommended next operating steps**

1. Confirm production environment variables and deploy the latest application.
2. Validate one end-to-end social interaction in n8n.
3. Publish one controlled campaign through Buffer.
4. Review Lead Scoring and Hot Leads during the sales cadence.
5. Refine workflow policy using observed conversion outcomes.

### Speaker script

The core operating model is in place. Sprout Social has been removed without
replacing the CRM's system-of-record responsibilities. The report procedures
are installed on the live database, and the application exposes seven secure
report views. The next step is disciplined operational adoption: validate one
end-to-end social workflow, run a controlled publishing cycle, and make the
Lead Scoring and Hot Leads reports part of the sales review rhythm. Future
changes should be judged by whether they improve data quality, response speed,
or conversion without creating a second source of truth.

---

## Optional appendix slide — Current validation snapshot

Use this slide only for an internal technical or project-status audience.

### On-slide copy

- Production build: passed
- Automated checks: 135 passed, 0 failed, 4 optional live-provider checks skipped
- Security scan: passed
- SmarterASP deployment validation: passed
- Live Microsoft SQL Server connection: passed
- Report procedures installed and executed: 7 of 7
- Live lead audit at validation: 74 distinct leads
- Leads with at least one stored social username: 67
- Missing authoritative scores: 0
- Invalid score bands: 0
- Report-to-lead score or band mismatches: 0

### Speaker script

This snapshot demonstrates that the implementation passed its automated
regression, security, deployment, and live database checks. Four optional
identity checks were skipped because the test process did not have the live
Instagram, Facebook, or X credentials loaded. Those are operational provider
checks rather than failures in the CRM. The database audit confirmed that every
report row maps to one distinct lead and that reporting matches the score and
temperature stored on the authoritative Lead record.

---

# Screenshot capture manifest

The filenames and titles below are designed to remain in the same order as the
story. Capture at 1440 × 900 or larger, use a 16:10 or 16:9 browser viewport,
and save PNG files.

| File | Title for the slide | Screen | What to show | Privacy treatment |
|---|---|---|---|---|
| `01_dashboard_overview.png` | CRM Marketing 360: Executive Overview | Overview | Header, live metrics, funnel, and main navigation | Crop or blur any record-specific details |
| `02_lead_360_timeline.png` | Unified Lead 360: Identity, Score, and Interaction History | Leads → 360 | Score, components, identities, and timeline structure | Blur names, email, phone, handles, and messages |
| `03_lead_score_explanation.png` | Why This Lead Has This Score | Leads → 360 | Score number, band, intent, and five score components | Crop out identity and message content |
| `04_campaign_studio.png` | Campaign Studio: SQL-Backed Buffer Publishing | Campaigns | Campaign card, active channels, schedule, and post status | Blur campaign copy, IDs, and URLs |
| `05_social_listener_health.png` | Social Listener: Provider Health and Qualified Intent Queue | Social Listener | Listener health and provider cards | Do not show credentials, IDs, or message content |
| `06_reports_navigation.png` | CRM Reports: Seven Operational and Executive Views | Reports | Report tabs, filters, export control, and table header | Blur all lead rows if using live data |
| `07_lead_scoring_report.png` | Lead Scoring Report: Prioritized Follow-Up Queue | Reports → Lead Scoring | Score, intent, temperature, date, source, and pagination | Replace or blur all names and usernames |
| `08_secure_login.png` | Secure CRM Access | Login | Full login page with empty fields | No additional redaction needed |
| `09_temperature_summary.png` | Lead Temperature Summary: Current Pipeline Mix | Reports → Temperature Summary | Four band summaries and active filters | No lead-level identity should be visible |

## Suggested screenshot callouts

Use no more than three numbered callouts on any screenshot.

- Overview: **1 Live CRM metrics**, **2 Funnel visibility**, **3 Direct access to action modules**.
- Lead 360: **1 Authoritative score**, **2 Cross-platform identities**, **3 Complete interaction history**.
- Campaign Studio: **1 SQL campaign record**, **2 Buffer post lifecycle**, **3 Cloudinary-backed media**.
- Reports: **1 Seven report views**, **2 Server-side filters**, **3 Filtered CSV export**.
- Lead Scoring: **1 Identity**, **2 Intent and temperature**, **3 Most recent activity**.

## Manual capture steps

1. Start the complete local application with `npm run dev`.
2. Open `http://localhost:3000/login`.
3. Sign in with an authorized CRM account.
4. Set the browser zoom to 100% and use a clean desktop-sized viewport.
5. Navigate to the screen named in the manifest.
6. Use non-sensitive test data where possible.
7. Capture the browser content area without password-manager overlays or
   developer tools.
8. Apply the required redactions before saving the final PNG.
9. Name the file exactly as listed in the manifest.
10. Add the listed title as the slide title or as a caption beneath the image.

---

# Copy-and-paste prompt for a Google Slides generator

```text
Create a polished 16:9 stakeholder presentation titled “Alianza CRM Marketing
360: One System from Engagement to Revenue.” The audience includes executives,
marketing, sales, operations, and technical stakeholders. The goal is to
explain how the system captures leads, resolves identity across social
platforms, stores interactions and attribution in Microsoft SQL Server,
calculates authoritative historical lead scores, schedules campaigns through
Buffer, stores campaign media in Cloudinary, coordinates workflows through
n8n, and provides live CRM reports.

Use the exact 14-slide sequence, on-slide copy, and speaker scripts in the
attached explainer document. Keep visible copy concise and place the longer
scripts in speaker notes. Use a warm off-white background, charcoal text,
violet as the primary accent, and restrained coral and mint highlights. Use a
clean sans-serif typeface and a modern, executive visual style. Avoid generic
stock photography, excessive card grids, and decorative technology imagery.
Use the supplied screenshots only on the slides identified in the screenshot
manifest. Preserve screenshot aspect ratios and add no more than three concise
callouts per screenshot. Do not display credentials, tokens, personal contact
information, private messages, or real social usernames.

The central takeaway should be: Alianza CRM Marketing 360 turns fragmented
engagement into one secure, scored, measurable CRM workflow, while Microsoft
SQL Server remains the source of truth.
```

---

# Frequently asked questions for the presenter

## Does n8n calculate the lead score?

No. n8n coordinates the workflow and uses the score returned by the CRM. The
CRM recalculates the authoritative score from persisted interaction history.

## Does OpenAI write directly to Microsoft SQL Server?

No. OpenAI may return structured intent classification or proposed response
content. The CRM validates and persists approved fields, then recalculates the
score itself.

## Is Buffer the CRM database?

No. Buffer schedules and publishes outbound posts. Microsoft SQL Server stores
the campaign, channel-post records, provider identifiers, state, and errors.

## Where does campaign media live?

The application validates the file and uploads it to Cloudinary. Microsoft SQL
Server stores the Cloudinary identity, secure URL, and verified metadata, not
the large media binary.

## How are duplicate social events prevented?

The CRM uses the provider's immutable interaction ID and a Microsoft SQL Server
unique key. A repeated event is acknowledged as a duplicate and is not inserted
again.

## Can a BASIC user manage settings or users?

No. BASIC users can use normal CRM modules. Settings and User Management are
restricted to ADMIN users.

## Does reporting create a new lead score?

No. Reporting reads `LeadScore`, the current intent, and `ScoreBand` from the
authoritative CRM model. It does not call OpenAI or calculate a parallel score.

## What replaced Sprout Social?

Nothing. Sprout was removed. n8n continues to coordinate approved automation,
Buffer continues to publish scheduled campaigns, Cloudinary continues to host
media, and the CRM remains the source of truth.

