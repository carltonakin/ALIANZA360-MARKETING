import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AuthError,
  AuthService,
  hashPassword,
  verifyPassword,
} from "../social/auth.mjs";
import { safeAuthReturnTo } from "../app/auth/return-to.mjs";
import { InMemorySocialRepository } from "../social/core.mjs";
import { createSocialListenerApp } from "../social/server.mjs";

const migrationUrl = new URL("../sql/011_authentication_user_management.sql", import.meta.url);

class MemoryAuthRepository {
  constructor() {
    this.users = [];
    this.sessions = new Map();
    this.nextId = 1;
  }

  now() {
    return new Date().toISOString();
  }

  safe(user) {
    const value = { ...user };
    delete value.passwordHash;
    return value;
  }

  async getAuthUserByUsername(username) {
    return this.users.find((user) => user.username.toLowerCase() === String(username).toLowerCase()) || null;
  }

  async listAuthUsers() {
    return this.users.map((user) => this.safe(user));
  }

  async createAuthUser(input) {
    if (await this.getAuthUserByUsername(input.username)) {
      throw Object.assign(new Error("duplicate username"), { number: 2627 });
    }
    const timestamp = this.now();
    const user = {
      id: this.nextId++,
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: null,
    };
    this.users.push(user);
    return this.safe(user);
  }

  async updateAuthUser(id, input) {
    const user = this.users.find((item) => item.id === Number(id));
    if (!user) return null;
    const duplicate = this.users.find((item) => item.id !== user.id && item.username.toLowerCase() === input.username.toLowerCase());
    if (duplicate) throw Object.assign(new Error("duplicate username"), { number: 2627 });
    const removesAdmin = user.role === "ADMIN" && user.isActive && (input.role !== "ADMIN" || !input.isActive);
    const otherAdmin = this.users.some((item) => item.id !== user.id && item.role === "ADMIN" && item.isActive);
    if (removesAdmin && !otherAdmin) throw Object.assign(new Error("last active admin"), { number: 51020 });
    const revoke = !input.isActive || input.role !== user.role;
    Object.assign(user, input, { updatedAt: this.now() });
    if (revoke) this.revokeUserSessions(user.id);
    return this.safe(user);
  }

  async setAuthUserPassword(id, passwordHash) {
    const user = this.users.find((item) => item.id === Number(id));
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.updatedAt = this.now();
    this.revokeUserSessions(user.id);
    return this.safe(user);
  }

  async recordAuthLogin(id) {
    const user = this.users.find((item) => item.id === Number(id) && item.isActive);
    if (!user) return null;
    user.lastLoginAt = this.now();
    user.updatedAt = user.lastLoginAt;
    return user;
  }

  async createAuthSession({ userId, tokenHash, expiresAt }) {
    this.sessions.set(tokenHash.toString("hex"), { userId: Number(userId), expiresAt, revoked: false });
  }

  async getAuthSession(tokenHash) {
    const session = this.sessions.get(tokenHash.toString("hex"));
    if (!session || session.revoked || session.expiresAt <= new Date()) return null;
    return this.users.find((user) => user.id === session.userId && user.isActive) || null;
  }

  async revokeAuthSession(tokenHash) {
    const session = this.sessions.get(tokenHash.toString("hex"));
    if (session) session.revoked = true;
  }

  revokeUserSessions(userId) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) session.revoked = true;
    }
  }
}

test("scrypt password hashes are salted, adaptive, and verify without plaintext persistence", async () => {
  const first = await hashPassword("Strong#Pass123");
  const second = await hashPassword("Strong#Pass123");
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.doesNotMatch(first, /Strong#Pass123/);
  assert.equal(await verifyPassword("Strong#Pass123", first), true);
  assert.equal(await verifyPassword("Wrong#Pass123", first), false);
  assert.equal(await verifyPassword("Strong#Pass123", "malformed"), false);
});

test("login return paths allow only safe internal application locations", () => {
  assert.equal(safeAuthReturnTo(undefined), "/");
  assert.equal(safeAuthReturnTo(""), "/");
  assert.equal(safeAuthReturnTo("/"), "/");
  assert.equal(safeAuthReturnTo("/dashboard?view=Campaigns#active"), "/dashboard?view=Campaigns#active");
  assert.equal(safeAuthReturnTo("/login?returnTo=%2Fdashboard"), "/");
  assert.equal(safeAuthReturnTo("/api/auth/login"), "/");
  assert.equal(safeAuthReturnTo("https://example.com"), "/");
  assert.equal(safeAuthReturnTo("//example.com"), "/");
  assert.equal(safeAuthReturnTo("/\\example.com"), "/");
});

test("default admin bootstrap is idempotent and the required initial login creates a revocable session", async () => {
  const repository = new MemoryAuthRepository();
  const auth = new AuthService(repository);
  const first = await auth.bootstrapDefaultAdmin();
  const persistedHashes = new Map(repository.users.map((user) => [user.username, user.passwordHash]));
  const second = await auth.bootstrapDefaultAdmin();
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(first.accounts.map(({ created, user }) => ({ created, username: user.username })), [
    { created: true, username: "next2thetop" },
    { created: true, username: "admin" },
  ]);
  assert.equal(first.accounts.every((account) => account.credentialMatches), true);
  assert.equal(second.accounts.every((account) => account.credentialMatches), true);
  assert.equal(repository.users.length, 2);
  for (const user of repository.users) {
    assert.equal(user.role, "ADMIN");
    assert.equal(user.isActive, true);
    assert.equal(user.passwordHash, persistedHashes.get(user.username));
  }
  assert.notEqual(repository.users[0].passwordHash, ["Alianza", "#", "123"].join(""));
  assert.notEqual(repository.users[1].passwordHash, ["admin", "#", "12"].join(""));

  const login = await auth.login({ username: "next2thetop", password: "Alianza#123" });
  assert.equal(login.user.role, "ADMIN");
  assert.equal("passwordHash" in login.user, false);
  assert.ok(repository.users[0].lastLoginAt);
  assert.deepEqual(await auth.authenticate(login.sessionToken), login.user);
  await auth.logout(login.sessionToken);
  await assert.rejects(() => auth.authenticate(login.sessionToken), (error) => error instanceof AuthError && error.statusCode === 401);

  const addedAdminLogin = await auth.login({
    username: "admin",
    password: ["admin", "#", "12"].join(""),
  });
  assert.equal(addedAdminLogin.user.username, "admin");
  assert.equal(addedAdminLogin.user.role, "ADMIN");
  assert.equal(addedAdminLogin.user.isActive, true);

  await assert.rejects(
    () => hashPassword(["admin", "#", "12"].join("")),
    (error) => error instanceof AuthError && error.code === "INVALID_PASSWORD",
  );
});

test("wrong passwords and inactive accounts cannot authenticate", async () => {
  const repository = new MemoryAuthRepository();
  const auth = new AuthService(repository);
  await auth.bootstrapDefaultAdmin();
  await assert.rejects(
    () => auth.login({ username: "next2thetop", password: "Wrong#Password1" }),
    (error) => error instanceof AuthError && error.statusCode === 401 && error.message === "Invalid username or password.",
  );
  repository.users[0].isActive = false;
  await assert.rejects(
    () => auth.login({ username: "next2thetop", password: "Alianza#123" }),
    (error) => error instanceof AuthError && error.statusCode === 401,
  );
});

test("admins manage existing users while BASIC users and last-admin removal are blocked", async () => {
  const repository = new MemoryAuthRepository();
  const auth = new AuthService(repository);
  await auth.bootstrapDefaultAdmin();
  const admin = await auth.login({ username: "next2thetop", password: "Alianza#123" });
  const basic = await auth.createUser(admin.sessionToken, {
    username: "campaign.user",
    password: "Campaign#123",
    role: "BASIC",
    isActive: true,
  });
  assert.equal("passwordHash" in basic, false);
  const basicLogin = await auth.login({ username: "campaign.user", password: "Campaign#123" });
  await assert.rejects(
    () => auth.listUsers(basicLogin.sessionToken),
    (error) => error instanceof AuthError && error.statusCode === 403,
  );

  const edited = await auth.updateUser(admin.sessionToken, basic.id, {
    username: "campaign.editor",
    role: "BASIC",
    isActive: false,
  });
  assert.equal(edited.id, basic.id);
  assert.equal(repository.users.length, 3);
  assert.equal(edited.isActive, false);
  await assert.rejects(() => auth.authenticate(basicLogin.sessionToken), (error) => error.statusCode === 401);

  const secondaryAdmin = repository.users.find((user) => user.username === "admin");
  await auth.updateUser(admin.sessionToken, secondaryAdmin.id, {
    username: secondaryAdmin.username,
    role: "BASIC",
    isActive: true,
  });

  await assert.rejects(
    () => auth.updateUser(admin.sessionToken, admin.user.id, {
      username: admin.user.username,
      role: "BASIC",
      isActive: true,
    }),
    (error) => error instanceof AuthError && error.code === "LAST_ACTIVE_ADMIN",
  );
});

test("authentication migration creates unique users, hashed sessions, and transactional last-admin protection", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE dbo\.AppUsers/i);
  assert.match(sql, /PasswordHash NVARCHAR\(512\) NOT NULL/i);
  assert.match(sql, /CONSTRAINT UQ_AppUsers_Username UNIQUE \(Username\)/i);
  assert.match(sql, /Role IN \(N'ADMIN', N'BASIC'\)/i);
  assert.match(sql, /CREATE TABLE dbo\.AuthSessions/i);
  assert.match(sql, /TokenHash BINARY\(32\) NOT NULL/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.AuthUser_Update/i);
  assert.match(sql, /last active ADMIN/i);
  assert.match(sql, /BEGIN TRANSACTION[\s\S]*COMMIT TRANSACTION[\s\S]*ROLLBACK TRANSACTION/i);
  assert.match(sql, /CREATE OR ALTER PROCEDURE dbo\.AuthSession_Get/i);
  const listProcedure = sql.slice(sql.indexOf("CREATE OR ALTER PROCEDURE dbo.AuthUser_List"), sql.indexOf("CREATE OR ALTER PROCEDURE dbo.AuthUser_Create"));
  assert.doesNotMatch(listProcedure, /PasswordHash/i);
});

test("listener auth endpoints require service authentication and enforce ADMIN for user APIs", async () => {
  const repository = new MemoryAuthRepository();
  const auth = new AuthService(repository);
  const app = await createSocialListenerApp({
    env: { SERVICE_AUTH_TOKEN: "service-token" },
    repository: new InMemorySocialRepository(),
    adapters: {},
    authService: auth,
    logger: { info() {}, error() {}, log() {} },
  });
  const request = (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer service-token");
    return new Request(`http://listener.test${path}`, { ...init, headers });
  };

  assert.equal((await app.handle(new Request("http://listener.test/auth/me"))).status, 401);
  const loginResponse = await app.handle(request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "next2thetop", password: "Alianza#123" }),
  }));
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.role, "ADMIN");
  assert.doesNotMatch(JSON.stringify(login.user), /password|hash/i);

  const adminHeaders = { "x-crm-session-token": login.sessionToken };
  const createdResponse = await app.handle(request("/auth/users", {
    method: "POST",
    headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ username: "basic.api", password: "Basic#Pass123", role: "BASIC", isActive: true }),
  }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.user.role, "BASIC");
  assert.doesNotMatch(JSON.stringify(created), /passwordHash/i);

  const basicLoginResponse = await app.handle(request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "basic.api", password: "Basic#Pass123" }),
  }));
  const basicLogin = await basicLoginResponse.json();
  const forbidden = await app.handle(request("/auth/users", {
    headers: { "x-crm-session-token": basicLogin.sessionToken },
  }));
  assert.equal(forbidden.status, 403);

  const logout = await app.handle(request("/auth/logout", { method: "POST", headers: adminHeaders }));
  assert.equal(logout.status, 200);
  const expired = await app.handle(request("/auth/me", { headers: adminHeaders }));
  assert.equal(expired.status, 401);
});

test("Next.js auth boundary uses HttpOnly cookies, returns 401/403, and keeps bootstrap credentials server-only", async () => {
  const [proxy, loginRoute, authServer, loginPage, dashboard] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(proxy, /status: unavailable \? 503 : 401/);
  assert.match(proxy, /status: 403/);
  assert.match(proxy, /\/api\/admin\//);
  assert.match(proxy, /\/api\/social\/config/);
  assert.match(proxy, /pathname === "\/login"/);
  assert.match(proxy, /_next\/static/);
  assert.match(proxy, /safeAuthReturnTo/);
  assert.match(authServer, /httpOnly: true/);
  assert.match(authServer, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(loginRoute, /Response\.json\(\{ ok: true, user: body\.user \}/);
  assert.match(loginPage, /fetch\("\/api\/auth\/login"/);
  assert.match(loginPage, /URLSearchParams\(window\.location\.search\)/);
  assert.match(loginPage, /router\.replace\(returnTo\)/);
  assert.doesNotMatch(loginPage, /https?:\/\/(?:localhost|carlitoh-001-site7)/i);
  assert.doesNotMatch(`${loginRoute}\n${loginPage}\n${dashboard}`, /Alianza#123|admin#12|PasswordHash/);
  assert.match(dashboard, /authUser\?\.role === "ADMIN"/);
  assert.match(dashboard, /User Management/);
});
