export const AUTH_COOKIE_NAME = "crm360_session";
export const AUTH_SESSION_HEADER = "x-crm-session-token";
export const VERIFIED_USER_ID_HEADER = "x-crm-user-id";
export const VERIFIED_USERNAME_HEADER = "x-crm-username";
export const VERIFIED_ROLE_HEADER = "x-crm-user-role";

export type AuthRole = "ADMIN" | "BASIC";

export type AuthUser = {
  id: number;
  username: string;
  role: AuthRole;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  lastLoginAt: string | null;
};
