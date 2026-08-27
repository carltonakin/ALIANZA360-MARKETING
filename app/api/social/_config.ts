type RuntimeEnv = NodeJS.ProcessEnv & {
  NODE_ENV?: string;
  SOCIAL_LISTENER_SERVICE_URL?: string;
  SOCIAL_LISTENER_SERVICE_TOKEN?: string;
};

export type ResolvedSocialConfig = {
  serviceUrl: string;
  serviceToken: string;
  source: "environment";
  updatedAt: null;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function permittedServiceUrl(value: string, nodeEnvironment?: string) {
  if (nodeEnvironment?.trim().toLowerCase() !== "production") return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

export function isSocialConfigAdmin(request: Request) {
  return request.headers.get("x-crm-user-role") === "ADMIN";
}

export async function resolveSocialListenerConfig(): Promise<ResolvedSocialConfig | null> {
  const env = process.env as RuntimeEnv;
  const serviceUrl = env.SOCIAL_LISTENER_SERVICE_URL?.trim().replace(/\/$/, "");
  const serviceToken = env.SOCIAL_LISTENER_SERVICE_TOKEN?.trim();

  if (
    !serviceUrl ||
    !serviceToken ||
    !permittedServiceUrl(serviceUrl, env.NODE_ENV)
  ) {
    return null;
  }

  return {
    serviceUrl,
    serviceToken,
    source: "environment",
    updatedAt: null,
  };
}

export async function socialConfigSummary() {
  const value = await resolveSocialListenerConfig();
  return value
    ? {
        configured: true,
        serviceUrl: value.serviceUrl,
        tokenStored: true,
        source: value.source,
        updatedAt: null,
      }
    : {
        configured: false,
        serviceUrl: "",
        tokenStored: false,
        source: null,
        updatedAt: null,
      };
}

export async function saveSocialListenerConfig() {
  throw new Error("Backend credentials are managed through environment variables.");
}

export async function removeSocialListenerConfig() {
  throw new Error("Backend credentials are managed through environment variables.");
}
