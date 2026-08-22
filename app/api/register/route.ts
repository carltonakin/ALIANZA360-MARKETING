import { proxySocialRequest } from "../social/_proxy";
export async function POST(request:Request){
 try{const body=await request.json() as Record<string,string>;if(!body.name?.trim()||!body.email?.trim()||!body.pageId)return Response.json({error:"Name, email and landing page are required"},{status:400});
  const externalEventId=`${body.pageId}:${body.email.trim().toLowerCase()}`;
  const response=await proxySocialRequest("/routine-leads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({routine:"landing_page_registration",externalEventId,name:body.name.trim(),email:body.email.trim(),phone:body.phone?.trim()||null,instagram:body.social?.trim()||null,source:"Landing Page",landingPageId:body.pageId,sourceDetail:`landing_page:${body.pageId}`})});
  const data=await response.json().catch(()=>({})) as Record<string,unknown>;return Response.json(response.ok?{ok:true,...data}:data,{status:response.status});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Registration failed"},{status:500})}
}
