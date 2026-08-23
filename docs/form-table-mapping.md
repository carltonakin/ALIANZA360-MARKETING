# CRM 360 form-to-table mapping

The browser never connects to SQL Server. Forms call Next.js route handlers; those handlers authenticate to the Node.js backend service, which alone owns the `mssql` connection pool.

| Application form | Backend operation | Primary table | Field mapping |
|---|---|---|---|
| Lead create/edit | `POST/PUT /leads` | `dbo.Leads` | name→Name, email→Email, phone→Phone, facebook→Facebook, instagram→Instagram, x→X, source→Source, value→EstimatedValue |
| Lead stage | `POST /leads/status` | `dbo.Leads` | leadId→LeadId, status→Status |
| AI/manual campaign | `POST/PUT /content` | `dbo.Campaigns` + `dbo.SocialCampaigns` | core content→Campaigns; sourceType, provider IDs, content reference, schedule, cadence, retries and run state→SocialCampaigns |
| Campaign automation controls | `POST /campaign-automation/action` | `dbo.SocialCampaigns` | campaignId→CampaignId; start/pause/resume/stop→AutomationStatus, AutomationEnabled and NextRunAt |
| Lead scoring settings | `PUT /scoring` | `dbo.LeadScoringRules` + `dbo.LeadTemperatureThresholds` | scoring event values→ScoreValue; COLD/WARM/HOT/VERY_HOT minimums→MinimumScore |
| Landing page | `POST/PUT /content` | `dbo.LandingPages` | campaignId→CampaignId, title→Title, slug→Slug, headline→Headline, teaser→Teaser, webinarUrl→WebinarUrl, paymentUrl→PaymentUrl, status→Status |
| Webinar | `POST/PUT /content` | `dbo.Webinars` | campaignId→CampaignId, landingPageId→LandingPageId, title→Title, description→Description, scheduledAt→ScheduledAt, webinarUrl→WebinarUrl, status→Status |
| Webinar registration | `POST /routine-leads` | `dbo.Leads` + `dbo.LeadRoutineEvents` | contact fields→Leads; routine, external event and related IDs→LeadRoutineEvents |
| Social channel settings | `PUT /channel-configurations/:channel` | `dbo.SocialChannelConfigurations` | provider IDs/scopes→matching columns; tokens→encrypted SecretCiphertext/IV/AuthTag |
| Social webhook | `POST /webhooks/meta` | `dbo.SocialEvents` + `dbo.SocialInteractions` + attribution tables | provider event data→SocialEvents; every normalized interaction→SocialInteractions; qualified identity→Leads, SocialAccounts and LeadSourceAttribution |
| Unified lead view | `GET /leads/:id/unified` | CRM and social relationship tables | lead, social identities, interactions, conversations, activities, opportunities, quotes, appointments and conversions→one timeline response |

Multi-table registration, webhook, lead deletion and content deletion operations run inside SQL Server transactions. All values are passed as typed `mssql` parameters to stored procedures.
