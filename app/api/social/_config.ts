import { env } from "cloudflare:workers";
type RuntimeEnv=typeof env&{SOCIAL_LISTENER_ADMIN_EMAIL?:string;SOCIAL_LISTENER_SERVICE_URL?:string;SOCIAL_LISTENER_SERVICE_TOKEN?:string};
export type ResolvedSocialConfig={serviceUrl:string;serviceToken:string;source:"environment";updatedAt:null};
export function isSocialConfigAdmin(request:Request){const runtime=env as RuntimeEnv;const expected=runtime.SOCIAL_LISTENER_ADMIN_EMAIL?.trim().toLowerCase();const actual=request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();return !expected||Boolean(actual&&actual===expected)}
export async function resolveSocialListenerConfig():Promise<ResolvedSocialConfig|null>{const runtime=env as RuntimeEnv;const serviceUrl=runtime.SOCIAL_LISTENER_SERVICE_URL?.trim().replace(/\/$/,"");const serviceToken=runtime.SOCIAL_LISTENER_SERVICE_TOKEN?.trim();return serviceUrl&&serviceToken?{serviceUrl,serviceToken,source:"environment",updatedAt:null}:null}
export async function socialConfigSummary(){const value=await resolveSocialListenerConfig();return value?{configured:true,serviceUrl:value.serviceUrl,tokenStored:true,source:value.source,updatedAt:null}:{configured:false,serviceUrl:"",tokenStored:false,source:null,updatedAt:null}}
export async function saveSocialListenerConfig(){throw new Error("Backend credentials are managed through environment variables.")}
export async function removeSocialListenerConfig(){throw new Error("Backend credentials are managed through environment variables.")}
