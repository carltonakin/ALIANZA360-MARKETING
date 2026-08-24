import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  environmentVariablePresence,
  PRESENCE_ENVIRONMENT_VARIABLES,
  redactDiagnosticLead,
} from "../app/api/diagnostics/environment/route.js";
const read=(path)=>readFile(new URL(path,import.meta.url),"utf8");
test("all CRM browser routes proxy to the server and no longer import D1",async()=>{const [data,register,landing,config,hosting]=await Promise.all([read("../app/api/data/route.ts"),read("../app/api/register/route.ts"),read("../app/landing/[slug]/page.tsx"),read("../app/api/social/_config.ts"),read("../.openai/hosting.json")]);for(const source of [data,register,landing,config])assert.doesNotMatch(source,/drizzle|D1Database|getDb|\.prepare\(/);assert.match(data,/proxySocialRequest/);assert.match(register,/routine-leads/);assert.match(landing,/resolveSocialListenerConfig/);assert.match(hosting,/"d1": null/)});
test("required SQL Server environment variables are documented without secrets",async()=>{const env=await read("../.env.example");for(const key of ["DB_SERVER","DB_PORT","DB_NAME","DB_USER","DB_PASSWORD","DB_ENCRYPT","DB_TRUST_SERVER_CERTIFICATE"])assert.match(env,new RegExp(`^${key}=`,"m"));assert.doesNotMatch(env,/DB_PASSWORD=.+/)});
test("schema contains normalized form tables, social automation relationships, indexes, transactions and CRUD procedures",async()=>{const [core,crud,automation]=await Promise.all([read("../sql/001_social_listener.sql"),read("../sql/002_crud_delete.sql"),read("../sql/003_social_crm_automation.sql")]);for(const table of ["Leads","Campaigns","LandingPages","Webinars","LeadRoutineEvents","SocialChannelConfigurations"])assert.match(core,new RegExp(`CREATE TABLE dbo\\.${table}`));for(const table of ["SocialPlatforms","SocialAccounts","SocialCampaigns","SocialConversations","SocialInteractions","Opportunities"])assert.match(automation,new RegExp(`CREATE TABLE dbo\\.${table}`));assert.match(core,/FOREIGN KEY \(CampaignId\)/);assert.match(core,/BEGIN TRANSACTION/);assert.match(automation,/SocialCampaign_ClaimDue/);for(const procedure of ["SocialLead_Delete","Campaign_Delete","LandingPage_Delete","Webinar_Delete"])assert.match(crud,new RegExp(`PROCEDURE dbo\\.${procedure}`));assert.match(crud,/IX_Leads_Email/)});
test("repository binds typed parameters instead of interpolating form values",async()=>{const source=await read("../social/sql-server.mjs");assert.match(source,/request\.input\("Name", this\.sql\.NVarChar/);assert.match(source,/request\.input\("Email", this\.sql\.NVarChar/);assert.match(source,/\.execute\("dbo\.SocialLead_Create"\)/);assert.doesNotMatch(source,/query\(`[^`]*\$\{/)});
test("every application form has a documented table mapping",async()=>{const mapping=await read("../docs/form-table-mapping.md");for(const form of ["Lead create/edit","Lead stage","AI/manual campaign","Landing page","Webinar","Webinar registration","Social channel settings","Social webhook"])assert.ok(mapping.includes(form),`${form} mapping is missing`)});
test("temporary environment diagnostic reports presence without exposing values",()=>{
 const secretMarker="diagnostic-must-never-return-this-value";
 const env=Object.fromEntries(PRESENCE_ENVIRONMENT_VARIABLES.map((name)=>[name,secretMarker]));
 env.DB_PORT="   ";env.DB_ENCRYPT="";env.DB_TRUST_SERVER_CERTIFICATE=undefined;
 const presence=environmentVariablePresence(env);
 assert.equal(Object.keys(presence).length,PRESENCE_ENVIRONMENT_VARIABLES.length);
 for(const [name,value] of Object.entries(presence)){
  assert.equal(typeof value,"boolean",`${name} must be reported as a boolean`);
 }
 assert.equal(presence.DB_SERVER,true);
 assert.equal(presence.DB_PORT,false);
 assert.equal(presence.DB_ENCRYPT,false);
 assert.equal(presence.DB_TRUST_SERVER_CERTIFICATE,false);
 assert.doesNotMatch(JSON.stringify(presence),new RegExp(secretMarker));
});
test("temporary diagnostic redacts lead PII with an explicit output allowlist",()=>{
 const secretMarker="lead-pii-must-never-be-returned";
 const lead=redactDiagnosticLead({LeadId:42,Name:secretMarker,Email:secretMarker,Phone:secretMarker,SocialUsername:secretMarker,Facebook:secretMarker,Instagram:secretMarker,X:secretMarker,Source:secretMarker,EstimatedValue:999,Status:"Qualified",CreatedAt:new Date("2026-01-02T03:04:05.000Z"),UpdatedAt:new Date("2026-02-03T04:05:06.000Z"),UnexpectedSensitiveColumn:secretMarker},0);
 assert.deepEqual(Object.keys(lead),["rowNumber","status","createdAt","updatedAt","piiRedacted"]);
 assert.equal(lead.rowNumber,1);assert.equal(lead.status,"Qualified");assert.equal(lead.piiRedacted,true);
 assert.doesNotMatch(JSON.stringify(lead),new RegExp(secretMarker));
});
test("temporary diagnostic uses one shared MSSQL path for database and read-only lead queries",async()=>{
 const source=await read("../app/api/diagnostics/environment/route.js");
 assert.match(source,/openSqlConnection/);
 assert.match(source,/SELECT DB_NAME\(\) AS databaseName/);
 assert.match(source,/SELECT TOP 5 \* FROM dbo\.leads/);
 assert.equal(source.match(/openSqlConnection\(env\)/g)?.length,1);
 assert.doesNotMatch(source,/Response\.json\(\s*process\.env/);
});
