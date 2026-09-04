# Alianza CRM Marketing 360 — User Experience Walkthrough

This is a Google Slides-ready story about how people use Alianza CRM Marketing
360. It explains the system through the experience of a marketing user, a sales
user, and an administrator rather than through source code or database design.

The recommended presentation length is 12–15 minutes. Put the short “On-slide
copy” on the slide and place the longer “Speaker script” in Google Slides
speaker notes.

## Audience outcome

By the end, users and stakeholders should understand what they can accomplish
in the CRM, what happens after each action, and how one connected workflow
turns engagement into prioritized sales follow-up.

## The three user perspectives

- **Marketing user:** creates campaigns, landing pages, webinars, and reviews
  source and campaign performance.
- **Sales user:** searches leads, reviews Lead 360, uses scores and intent to
  prioritize outreach, and updates the CRM stage.
- **Administrator:** manages users, validates integrations, and protects
  server-side configuration.

---

## Slide 1 — The user starts with one place to manage the customer journey

### User experience

The user opens one application for leads, campaigns, social activity, landing
pages, webinars, and reports. The navigation keeps each task visible without
forcing the user to move between several disconnected systems.

### On-slide copy

**Alianza CRM Marketing 360**

One workspace for attracting, understanding, prioritizing, and converting
leads.

### Speaker script

From the user's point of view, Alianza CRM Marketing 360 is one operating
workspace. A marketing user can create the campaign that starts the journey. A
sales user can see the lead, the latest intent, and the next action. A manager
can open reports without assembling data from several platforms. Behind the
screen, the CRM connects specialized services, but the user works through one
consistent experience and one authoritative customer record.

### Screenshot

**File:** `UX-01-overview.png`

**Title:** **One Workspace for the Complete Growth Journey**

**Capture:** Overview screen with the left navigation, welcome message, metric
row, and funnel visible.

**Callouts:**

1. Main workflow navigation
2. Live CRM metrics
3. Funnel and recommended action

---

## Slide 2 — Secure sign-in gives every person the right level of access

### User experience

The user enters an authorized CRM username and password. A successful sign-in
opens the dashboard. An unsuccessful sign-in gives a clear error without
revealing whether a specific account exists.

### On-slide copy

- One secure sign-in for the CRM
- ADMIN and BASIC access levels
- Sessions stay protected in an HttpOnly cookie
- Administrator tools remain hidden from BASIC users

### Speaker script

The first experience is intentionally simple: the user signs in and is taken to
the dashboard. The application verifies the account on the server and creates a
revocable session. Basic users can perform everyday CRM work. Administrators
can also manage users and system settings. The browser never receives password
hashes, database credentials, or integration secrets. If a session expires,
the user returns to sign-in rather than continuing with stale access.

### Screenshot

**File:** `UX-02-secure-login.png`

**Title:** **Secure CRM Access**

**Capture:** The complete login page with both fields empty.

**Privacy:** This is the safest screenshot for an external presentation. Never
capture a filled password field or a password-manager suggestion.

---

## Slide 3 — The Overview tells the user where attention is needed

### User experience

After sign-in, the user sees current lead volume, pipeline value, active
campaigns, the funnel, and a recommended marketing opportunity. The page is a
starting point, not a static report: its actions take the user directly to the
next workflow.

### On-slide copy

The first screen answers three questions:

1. What is happening now?
2. Where are leads moving through the funnel?
3. What should I work on next?

### Speaker script

The Overview is designed for orientation. The user can immediately see the
size of the lead population, the estimated pipeline value, and how many
campaigns are active. The funnel shows the progression from reach to customer.
The opportunity panel provides a direct path into campaign creation. The
important experience is that the user does not have to search through menus to
understand current activity or begin the next task.

### Screenshot

**File:** `UX-03-dashboard-overview.png`

**Title:** **The Dashboard Turns Current Activity into a Next Step**

**Capture:** Overview screen from the welcome panel through the full funnel and
opportunity panel.

**Privacy:** Crop out browser bookmarks and account-specific browser controls.

---

## Slide 4 — The sales user can find and update a lead in seconds

### User experience

The user opens **Leads**, searches by name, email, or source, and reviews a
compact work queue. Each row shows source, current score and temperature,
latest intent, AI-assisted response context, and CRM stage.

### On-slide copy

**Find → understand → act**

- Search the contact list
- Review source, score, intent, and suggested context
- Change the CRM stage
- Open the complete Lead 360 record
- Edit contact information when needed

### Speaker script

The Leads screen is the sales user's daily work queue. Search narrows the list
immediately. A lead's score and temperature appear beside the source, so the
user can distinguish a cold contact from someone who may need immediate
follow-up. The latest intent explains what the person appears to want. The
stage selector lets the user move the lead through New, Engaged, Hot,
Registered, and Customer. For more context, the 360 button opens the complete
relationship history.

### Screenshot

**File:** `UX-04-lead-work-queue.png`

**Title:** **The Lead Work Queue Puts Priority and Context Together**

**Capture:** Leads screen with the search field, table header, and three to five
test or redacted rows.

**Callouts:**

1. Search and contact count
2. Score, temperature, and intent
3. Stage, 360, and Edit actions

**Privacy:** Replace or blur names, emails, social handles, response text, and
other personal data.

---

## Slide 5 — Lead 360 explains the person, the score, and the history

### User experience

The user selects **360** from a lead row. A single view shows the lead's current
score, temperature, intent, CRM stage, scoring components, most recent inbound
interaction, social identities, and timeline.

### On-slide copy

One lead record can include:

- Contact and qualification details
- Facebook, Instagram, and X identities
- Score and five scoring components
- Latest comment or direct message
- Inbound and confirmed outbound interaction history
- Conversations, opportunities, quotes, appointments, and conversions

### Speaker script

Lead 360 is where the user understands why a lead matters. The score is not
presented as a mystery number. The view breaks it into intent, engagement, fit,
recency, and source components and displays the current reason. The latest
comment or direct message appears near the top, followed by the connected social
identities and the chronological history. This gives the sales user enough
context to respond appropriately without opening several social platforms or
guessing what happened earlier.

### Screenshot

**File:** `UX-05-lead-360.png`

**Title:** **Lead 360 Shows the Complete Relationship in One View**

**Capture:** Lead 360 modal from the title through social identities and the
first portion of the interaction timeline.

**Callouts:**

1. Score, temperature, intent, and stage
2. Explainable score components
3. Cross-platform identity and timeline

**Privacy:** Use a demonstration record. Otherwise blur the person's name,
email, phone, company, usernames, messages, and external identifiers.

---

## Slide 6 — The score helps the user choose the next conversation

### User experience

The user sees a score from 0 to 100 and a corresponding temperature. Higher
scores indicate stronger or more recent buying signals. The score can change as
new inbound interactions arrive or older activity loses recency.

### On-slide copy

| Temperature | Score | User interpretation |
|---|---:|---|
| COLD | 0–29 | Nurture and observe |
| WARM | 30–59 | Continue engagement |
| QUALIFIED | 60–79 | Begin focused sales follow-up |
| HOT | 80–100 | Prioritize immediate attention |

### Speaker script

The user does not calculate the score. The CRM evaluates the complete inbound
history and returns the authoritative result. Intent can contribute up to 35
points, engagement up to 20, and fit, recency, and source up to 15 each. An
outbound reply remains visible in the timeline but does not inflate behavioral
interest. OpenAI may classify the intent of a message, but the CRM owns the
final score and temperature. This gives every user the same prioritization
logic in Lead 360, the Leads screen, automation, and reporting.

### Screenshot

**File:** `UX-06-score-explanation.png`

**Title:** **The User Can See Why a Lead Is Cold, Warm, Qualified, or Hot**

**Capture:** A close crop of the Lead 360 score banner and five score-component
boxes.

**Privacy:** Exclude the lead name and all interaction text from the crop.

---

## Slide 7 — Marketing creates a campaign through one guided form

### User experience

The marketing user opens **Campaigns**, selects **New Buffer campaign**, and
enters the campaign objective, audience, message, channels, post type, publish
time, and optional media. The same form reopens an existing campaign for safe
editing.

### On-slide copy

**Campaign creation experience**

1. Define the campaign and audience.
2. Choose live Buffer channels.
3. Select Post, Reel, or Story.
4. Add and validate media.
5. Choose an exact publication time.
6. Save as a draft or schedule through Buffer.

### Speaker script

Campaign creation stays inside the CRM. The selectable publishing channels are
loaded from the configured Buffer organization rather than typed manually. The
user can build a standard post, Reel, or Story and attach an image or video.
The application validates the channel combination, schedule, file signature,
size, and supported media requirements before it attempts publication. If a
validation fails, the campaign remains visible so the user can correct the
specific problem instead of starting over.

### Screenshot

**File:** `UX-07-new-campaign-form.png`

**Title:** **A Guided Campaign Form Keeps Publishing Requirements Clear**

**Capture:** Campaigns → New Buffer campaign. Use a non-sensitive draft and
show the objective, channel, post type, schedule, and media areas without
submitting it.

**Callouts:**

1. Campaign purpose and content
2. Channel and post-type selection
3. Schedule and media validation

---

## Slide 8 — The user sees the publishing lifecycle without leaving the CRM

### User experience

After saving, the campaign appears as a card with active channel posts,
scheduled time, AI-reply setting, media preview, Buffer status, and any safe
error message. The user can reopen an eligible campaign or refresh its Buffer
status.

### On-slide copy

```text
Campaign saved in CRM
        ↓
One post record per channel
        ↓
Buffer schedules publication
        ↓
CRM synchronizes status and published link
```

### Speaker script

The campaign card becomes the user's operational record. The CRM saves the
campaign and its channel posts before asking Buffer to schedule anything. That
means the user's work is not lost if Buffer is temporarily unavailable. When
Buffer accepts the post, its identifiers and status are stored with the CRM
record. The user can refresh status later to see whether a post is scheduled,
published, or failed. Editing reuses the existing identifiers instead of
silently creating a duplicate post.

### Screenshot

**File:** `UX-08-campaign-lifecycle.png`

**Title:** **Campaign Status Remains Visible from Draft to Published**

**Capture:** Campaigns screen with one representative campaign card and its
channel-post statuses.

**Privacy:** Blur Buffer IDs, published URLs, private campaign copy, and any
media not approved for presentation use.

---

## Slide 9 — Landing pages and webinars extend the same campaign journey

### User experience

The marketing user can create a landing page associated with a campaign, then
create a webinar connected to the landing page and campaign. Published landing
pages can collect registrations through the CRM.

### On-slide copy

**Campaign → Landing page → Webinar → Registration → Lead**

- Reuse the campaign relationship
- Keep webinar and landing-page status visible
- Capture registration as a CRM routine event
- Preserve source and campaign attribution

### Speaker script

The user can continue the campaign journey without creating a disconnected
registration list. A landing page carries its title, headline, teaser, webinar
link, payment link, and status. A webinar can be associated with both the
campaign and landing page. When a visitor registers, the CRM creates or reuses
the lead and records the registration event with its source and related IDs.
The result is that the sales team can see where the person came from and how
the registration relates to later engagement.

### Screenshot

**File:** `UX-09-landing-webinar.png`

**Title:** **Campaign Journeys Continue through Landing Pages and Webinars**

**Capture options:**

- Preferred: Landing Pages list with one test page and the action to create a
  webinar.
- Alternate: Webinar list showing campaign and landing-page relationships.

**Privacy:** Use demonstration URLs and titles. Do not show private payment or
meeting links.

---

## Slide 10 — Social Listener gives operations a clear health view

### User experience

The user opens **Social Listener** to see whether supported providers have been
validated, when each provider was last checked, how many events and leads have
been processed, and whether qualified intent is entering the CRM.

### On-slide copy

The screen answers:

- Is the listener working?
- Which channels are connected?
- When was the last successful check and event?
- Are qualified social leads reaching the CRM?

### Speaker script

The Social Listener screen translates integration health into language an
operator can act on. The provider is only shown as connected after a real,
read-only identity check succeeds. Each channel card explains its current
status and last activity. The qualified-intent queue shows whether normalized
people and source attribution are available to the CRM. Configuration details
and tokens stay on the server; this screen reports readiness without exposing
the secret itself.

### Screenshot

**File:** `UX-10-social-listener.png`

**Title:** **Users Can Verify Social Activity without Seeing Credentials**

**Capture:** Social Listener from the health panel through all provider cards.

**Privacy:** Exclude the qualified-intent queue if it contains real names or
messages. Never capture provider IDs, tokens, or webhook secrets.

---

## Slide 11 — Reports help each user move from data to action

### User experience

The user opens **Reports**, chooses one of seven report tabs, applies filters,
sorts a supported column, pages through results, or exports the filtered data
to CSV.

### On-slide copy

**Sales views**

- Lead Scoring
- Lead Engagement
- Hot Leads

**Management and marketing views**

- Temperature Summary
- Lead Intent
- Source Performance
- Campaign Performance

### Speaker script

Reports are organized around a decision rather than around database tables. A
sales user can begin with Lead Scoring or Hot Leads. A marketing manager can
compare lead quality by source or campaign. A leader can use Temperature
Summary to understand the current mix of Cold, Warm, Qualified, and Hot leads.
Search, score, intent, platform, source, campaign, and date filters run on the
server. CSV export respects the selected report and active filters.

### Screenshot

**File:** `UX-11-reports-workspace.png`

**Title:** **Seven Reports Support Daily Action and Management Review**

**Capture:** Reports screen with all report tabs, filter panel, export control,
and the table header visible.

**Callouts:**

1. Choose a business question
2. Apply server-side filters
3. Review or export the result

**Privacy:** Blur every lead-level row when capturing the live database.

---

## Slide 12 — Lead Scoring becomes the user's prioritized follow-up queue

### User experience

The user selects **Lead Scoring**. Results default to the highest score and then
the most recent interaction. The user can filter by temperature, score range,
intent, platform, source, campaign, date, or search text.

### On-slide copy

Each row combines:

- Lead identity and available social usernames
- Authoritative score and temperature
- Latest intent
- Last interaction and date
- Source and campaign context

### Speaker script

This report brings the most important follow-up information into one row. The
user can see who the person is, the social usernames connected to the record,
the current score, the latest intent, the temperature, and when the last
interaction occurred. The default order surfaces the strongest current
opportunities first. The report does not calculate a new score and it does not
create one row per social network. It reads the score and identity relationships
already owned by the CRM.

### Screenshot

**File:** `UX-12-lead-scoring-report.png`

**Title:** **The Highest-Priority Leads Appear First**

**Capture:** Reports → Lead Scoring with the score, intent, temperature, last
interaction date, source, and pagination visible.

**Privacy:** Blur names, handles, messages, and campaign details. Keep score,
temperature, generic source, and dates visible only if approved.

---

## Slide 13 — Temperature Summary gives leaders a fast pipeline-quality view

### User experience

The user selects **Temperature Summary** and sees the number and percentage of
leads in each band. The same filters can narrow the view to a date range,
platform, source, intent, or campaign.

### On-slide copy

**Cold → Warm → Qualified → Hot**

The summary shows both count and percentage, so leaders can compare the size
and quality of the active lead population.

### Speaker script

Temperature Summary is the fastest way for a leader to understand the quality
mix of the current pipeline. It always presents the four standard bands and
shows each as a count and percentage of the filtered population. Because the
filters are shared with the other reports, the user can answer more focused
questions, such as the temperature mix for Instagram, a specific source, or a
particular campaign period.

### Screenshot

**File:** `UX-13-temperature-summary.png`

**Title:** **Temperature Summary Shows the Current Quality Mix**

**Capture:** Reports → Temperature Summary with all four band summaries and the
active filter panel.

**Privacy:** No lead identity should be visible in this capture.

---

## Slide 14 — Administrators manage access without exposing system secrets

### User experience

An administrator can create or update CRM users, choose ADMIN or BASIC access,
activate or deactivate accounts, and reset passwords. Settings and user
management remain unavailable to BASIC users.

### On-slide copy

**Administrator controls**

- Create and maintain CRM users
- Assign ADMIN or BASIC role
- Activate or deactivate access
- Reset passwords securely
- Review integration readiness
- Keep credentials server-side

### Speaker script

Administration is separated from daily CRM work. An Admin can manage user
access and review system readiness. A Basic user does not see or gain access to
the protected settings and user-management functions. Password changes are
processed on the server, and the database stores a salted password hash rather
than the plain password. Social, Buffer, Cloudinary, and database credentials
are configured as server-side values, not typed into ordinary browser screens.

### Screenshot

**File:** `UX-14-user-management.png`

**Title:** **Administrators Control Access by Role and Account Status**

**Capture:** User Management with the table header and anonymized test accounts.
Do not open or capture a password-reset form containing a real password.

**Alternate screenshot:** Settings service-readiness panels with all sensitive
values outside the crop.

---

## Slide 15 — The user experiences one journey while services work behind it

### On-slide copy

```text
User creates demand
        ↓
Engagement enters through social or forms
        ↓
CRM resolves the lead and records history
        ↓
Score and intent prioritize the next action
        ↓
Sales follows up with complete context
        ↓
Reports show what is working
```

**Behind the experience:** n8n coordinates approved workflows, Buffer publishes
scheduled posts, Cloudinary serves media, and Microsoft SQL Server remains the
source of truth.

### Speaker script

The most important design decision is that the user experiences one journey,
even though several services contribute behind the screen. Marketing activity
creates demand. Social conversations and registrations become CRM history. The
CRM connects identity, intent, and source, then calculates the score. Sales uses
that context to choose the next conversation. Reports close the loop by showing
lead quality and performance. n8n, Buffer, and Cloudinary each perform a clear
supporting role, while Microsoft SQL Server owns the business record.

### Screenshot

**File:** `UX-15-navigation-summary.png`

**Title:** **One Navigation Connects the Entire User Journey**

**Capture:** A narrow crop of the navigation beside a privacy-safe Overview or
Reports screen.

---

# Live demonstration script

Use this sequence for a five- to seven-minute product walkthrough. Complete all
data setup before the presentation. Do not create, publish, delete, or modify
production records during a live executive demonstration.

## 1. Sign in

**Action:** Open the Login screen and sign in with an approved demonstration
account.

**Say:** “Every user enters through the same secure CRM sign-in. Their role
controls whether they see everyday CRM tools or administrator functions.”

## 2. Orient the audience on Overview

**Action:** Point to the metric row, funnel, and opportunity panel.

**Say:** “The first page shows current CRM activity and gives the user a direct
path into the next task. It is designed to answer what is happening, where
leads are moving, and what needs attention.”

## 3. Open the Leads work queue

**Action:** Select Leads and use search with a prepared, non-sensitive record.

**Say:** “The sales user can find a person quickly and see source, score,
temperature, intent, response context, and stage without opening the full
record.”

## 4. Open Lead 360

**Action:** Select **360** on the prepared record.

**Say:** “Lead 360 explains the score and brings together cross-platform
identity, the latest inbound signal, and the complete interaction history. The
user can understand the person before deciding how to respond.”

## 5. Show Campaign Studio

**Action:** Open Campaigns and point to one prepared draft or scheduled campaign.

**Say:** “Marketing can see the campaign, channel posts, publication time,
media, and Buffer status in one place. SQL Server keeps the campaign record even
if an external publishing request encounters a problem.”

## 6. Preview the campaign form without saving

**Action:** Select **New Buffer campaign**, explain the sections, then close the
form without saving.

**Say:** “The form guides the user through the objective, content, channels,
post type, media, and exact schedule. The application validates the combination
before anything is sent for publication.”

## 7. Show Social Listener health

**Action:** Open Social Listener and point to the health panel and provider cards.

**Say:** “Operations can confirm whether social activity is reaching the CRM
without seeing credentials. Connected means a real provider identity check has
succeeded.”

## 8. Show Lead Scoring Report

**Action:** Open Reports → Lead Scoring and apply a prepared temperature or
score filter.

**Say:** “This is the prioritized follow-up queue. The user sees identity,
intent, score, temperature, recent activity, and source. Sorting and filtering
happen on the server using live CRM data.”

## 9. Show Temperature Summary

**Action:** Select Temperature Summary.

**Say:** “A leader can now move from individual follow-up to a fast picture of
pipeline quality. The same filters can focus the view on a platform, source,
campaign, or time period.”

## 10. Close on the connected journey

**Action:** Return to Overview.

**Say:** “The user experiences one workflow from campaign to engagement to
qualified follow-up and reporting. n8n, Buffer, and Cloudinary support that
workflow, while the CRM and Microsoft SQL Server remain the source of truth.”

---

# Screenshot production checklist

Capture screenshots only from a demonstration account and demonstration data
set whenever possible.

## Recommended settings

- Resolution: 1440 × 900 or 1920 × 1080
- Browser zoom: 100%
- File format: PNG
- Color mode: standard light theme
- Capture area: application viewport only
- Cursor: move it away from important content before capture
- Notifications: disable browser and desktop notifications

## Required privacy review before using any screenshot

- Remove or blur names that identify real leads or users.
- Remove email addresses and phone numbers.
- Remove social usernames and platform user IDs.
- Remove private comments, direct messages, and AI response text.
- Remove campaign IDs, Buffer IDs, and private campaign copy when necessary.
- Remove webinar, payment, media, and published-post URLs unless approved.
- Never include passwords, tokens, keys, connection strings, cookies, or
  browser password-manager content.

## Title treatment

Use the screenshot title from each slide as the image caption or as a 24 pt
heading immediately above the image. Add no more than three numbered callouts.
Callouts should describe the user's task, not the underlying code.

---

# Prompt for creating the Google Slides deck

```text
Create a polished 16:9 presentation titled “Alianza CRM Marketing 360: The User
Experience from Campaign to Qualified Lead.” The audience includes CRM users,
marketing, sales, operations, administrators, and business stakeholders.

Build the presentation around the user's journey, not around software code.
Follow the exact slide sequence and use the on-slide copy from the attached
User Experience Walkthrough. Put each slide's longer speaker script in speaker
notes. Show what the user sees and does first, then briefly explain what the
system does behind the screen.

Use the supplied screenshots according to their numbered filenames and titles.
Preserve their aspect ratios. Add no more than three concise numbered callouts
per screenshot. Never reveal names, email addresses, phone numbers, social
usernames, messages, credentials, tokens, IDs, or private URLs.

Use a warm off-white background, charcoal text, violet accents, and restrained
coral or mint highlights. Use a clean sans-serif typeface. Keep slide titles at
35–42 pt and body text at 18–22 pt. Favor one large screenshot or one simple
process visual per slide. Avoid generic stock photography and dense dashboard-
style slide layouts.

The central takeaway is: users experience one connected workflow for creating
demand, understanding leads, prioritizing follow-up, and measuring results,
while Microsoft SQL Server remains the authoritative CRM record.
```

