import { proxySocialRequest } from "../social/_proxy";
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
async function json(response:Response){return response.json().catch(()=>({})) as Promise<Record<string,unknown>>}
export async function GET(){
 const [leadResponse,contentResponse]=await Promise.all([proxySocialRequest("/leads?limit=100"),proxySocialRequest("/content")]);
 if(!leadResponse.ok)return new Response(await leadResponse.arrayBuffer(),{status:leadResponse.status,headers:{"content-type":"application/json"}});
 if(!contentResponse.ok)return new Response(await contentResponse.arrayBuffer(),{status:contentResponse.status,headers:{"content-type":"application/json"}});
 const leadData=await json(leadResponse),contentData=await json(contentResponse);
 return Response.json({leads:Array.isArray(leadData.leads)?leadData.leads:[],campaigns:Array.isArray(contentData.campaigns)?contentData.campaigns:[],pages:Array.isArray(contentData.pages)?contentData.pages:[],webinars:Array.isArray(contentData.webinars)?contentData.webinars:[],activities:[]},{headers:{"cache-control":"no-store"}});
}
export async function POST(request:Request){
 let body:Record<string,unknown>;try{body=await request.json()}catch{return Response.json({error:"Malformed JSON payload."},{status:400})}
 const action=clean(body.action);let path="",method="POST",payload:Record<string,unknown>={};
 if(action==="lead.create"){
  if(!clean(body.name)||!clean(body.email))return Response.json({error:"Name and email are required"},{status:400});
  path="/leads";payload={name:clean(body.name),email:clean(body.email),phone:clean(body.phone),facebook:clean(body.facebook),instagram:clean(body.instagram)||clean(body.social),x:clean(body.x),source:clean(body.source)||"Manual",value:Number(body.value)||0};
 }else if(action==="lead.update"){
  path="/leads";method="PUT";payload={leadId:Number(String(body.id).replace(/^social:/,"")),name:clean(body.name),email:clean(body.email),phone:clean(body.phone),facebook:clean(body.facebook),instagram:clean(body.instagram),x:clean(body.x),source:clean(body.source)||"Manual",value:Number(body.value)||0};
 }else if(action==="lead.status"){
  path="/leads/status";payload={leadId:Number(String(body.id).replace(/^social:/,"")),status:clean(body.status)};
 }else if(action==="campaign.create"){
  path="/content";payload={entity:"campaign",name:clean(body.name),platform:clean(body.platform)||"Instagram",audience:clean(body.audience),message:clean(body.message),budget:Number(body.budget)||0,status:"draft"};
 }else if(action==="campaign.status"){
  path="/content/campaign-mode";payload={id:body.id,mode:clean(body.status).toLowerCase()};
 }else if(action==="page.create"){
  path="/content";payload={entity:"landing_page",title:clean(body.title),slug:clean(body.slug),headline:clean(body.headline),teaser:clean(body.teaser),webinarUrl:clean(body.webinarUrl),paymentUrl:clean(body.paymentUrl),status:"published"};
 }else return Response.json({error:"Unsupported action"},{status:400});
 const response=await proxySocialRequest(path,{method,headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
 const data=await json(response);return Response.json(response.ok?{record:data.record||data.lead,...data}:data,{status:response.status});
}
export async function DELETE(request:Request){
 let body:Record<string,unknown>;try{body=await request.json()}catch{return Response.json({error:"Malformed JSON payload."},{status:400})}
 const path=clean(body.entity)==="lead"?"/leads":"/content";
 return proxySocialRequest(path,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}
