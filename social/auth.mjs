import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_ROLES = new Set(["ADMIN", "BASIC"]);
const DEFAULT_ADMIN_ACCOUNTS = Object.freeze([
  Object.freeze({
    username: "next2thetop",
    initialPassword: ["Alianza", "#", "123"].join(""),
  }),
  Object.freeze({
    username: "admin",
    initialPassword: ["admin", "#", "12"].join(""),
  }),
]);

export class AuthError extends Error {
  constructor(message, { statusCode = 400, code = "AUTH_ERROR" } = {}) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeUsername(value) {
  const username = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(username)) {
    throw new AuthError(
      "Username must be 3 to 128 characters and use only letters, numbers, periods, underscores, or hyphens.",
      { code: "INVALID_USERNAME" },
    );
  }
  return username;
}

function normalizeRole(value) {
  const role = String(value || "").trim().toUpperCase();
  if (!ALLOWED_ROLES.has(role)) {
    throw new AuthError("Role must be ADMIN or BASIC.", { code: "INVALID_ROLE" });
  }
  return role;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 256) {
    throw new AuthError("Password must be between 10 and 256 characters.", {
      code: "INVALID_PASSWORD",
    });
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new AuthError(
      "Password must include uppercase, lowercase, number, and special characters.",
      { code: "INVALID_PASSWORD" },
    );
  }
  return value;
}

function userId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AuthError("A valid user ID is required.", { code: "INVALID_USER_ID" });
  }
  return id;
}

export function safeAuthUser(user) {
  if (!user) return null;
  return {
    id: Number(user.id ?? user.userId),
    username: String(user.username),
    role: normalizeRole(user.role),
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}

async function derivePasswordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function hashPassword(password) {
  return derivePasswordHash(validatePassword(password));
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || typeof encodedHash !== "string") return false;
  const [algorithm, costValue, blockValue, parallelValue, saltValue, hashValue, extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue || extra !== undefined) return false;
  const N = Number(costValue);
  const r = Number(blockValue);
  const p = Number(parallelValue);
  if (N !== SCRYPT_COST || r !== SCRYPT_BLOCK_SIZE || p !== SCRYPT_PARALLELIZATION) return false;

  try {
    const expected = Buffer.from(hashValue, "base64url");
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length, {
      N,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    }));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest();
}

function duplicateUsername(error) {
  return [2601, 2627].includes(Number(error?.number || error?.originalError?.info?.number)) ||
    /duplicate|unique|username/i.test(String(error?.message || ""));
}

function lastAdminError(error) {
  return Number(error?.number || error?.originalError?.info?.number) === 51020 ||
    /last active admin|zero active admin/i.test(String(error?.message || ""));
}

export class AuthService {
  constructor(repository, { sessionTtlMs = SESSION_TTL_MS } = {}) {
    this.repository = repository;
    this.sessionTtlMs = sessionTtlMs;
  }

  async #bootstrapAdminAccount({ username, initialPassword }) {
    const existing = await this.repository.getAuthUserByUsername(username);
    if (existing) {
      return {
        created: false,
        credentialMatches: await verifyPassword(initialPassword, existing.passwordHash),
        user: safeAuthUser(existing),
      };
    }

    const passwordHash = await derivePasswordHash(initialPassword);
    try {
      const user = await this.repository.createAuthUser({
        username,
        passwordHash,
        role: "ADMIN",
        isActive: true,
      });
      return { created: true, credentialMatches: true, user: safeAuthUser(user) };
    } catch (error) {
      if (!duplicateUsername(error)) throw error;
      const user = await this.repository.getAuthUserByUsername(username);
      return {
        created: false,
        credentialMatches: await verifyPassword(initialPassword, user?.passwordHash),
        user: safeAuthUser(user),
      };
    }
  }

  async bootstrapDefaultAdmin() {
    const accounts = [];
    for (const account of DEFAULT_ADMIN_ACCOUNTS) {
      accounts.push(await this.#bootstrapAdminAccount(account));
    }
    return { ...accounts[0], accounts };
  }

  async login({ username, password } = {}) {
    let normalizedUsername;
    try {
      normalizedUsername = normalizeUsername(username);
    } catch {
      throw new AuthError("Invalid username or password.", {
        statusCode: 401,
        code: "INVALID_CREDENTIALS",
      });
    }

    const user = await this.repository.getAuthUserByUsername(normalizedUsername);
    const valid = user?.isActive && await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError("Invalid username or password.", {
        statusCode: 401,
        code: "INVALID_CREDENTIALS",
      });
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
    await this.repository.createAuthSession({
      userId: user.id ?? user.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    const updated = await this.repository.recordAuthLogin(user.id ?? user.userId);
    return {
      user: safeAuthUser(updated || user),
      sessionToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async authenticate(sessionToken) {
    if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 256) {
      throw new AuthError("Authentication is required.", {
        statusCode: 401,
        code: "UNAUTHENTICATED",
      });
    }
    const user = await this.repository.getAuthSession(hashSessionToken(sessionToken));
    if (!user?.isActive) {
      throw new AuthError("Authentication is required.", {
        statusCode: 401,
        code: "UNAUTHENTICATED",
      });
    }
    return safeAuthUser(user);
  }

  async logout(sessionToken) {
    if (typeof sessionToken === "string" && sessionToken) {
      await this.repository.revokeAuthSession(hashSessionToken(sessionToken));
    }
    return { ok: true };
  }

  async requireAdmin(sessionToken) {
    const user = await this.authenticate(sessionToken);
    if (user.role !== "ADMIN") {
      throw new AuthError("Administrator access is required.", {
        statusCode: 403,
        code: "FORBIDDEN",
      });
    }
    return user;
  }

  async listUsers(sessionToken) {
    await this.requireAdmin(sessionToken);
    return (await this.repository.listAuthUsers()).map(safeAuthUser);
  }

  async createUser(sessionToken, input = {}) {
    await this.requireAdmin(sessionToken);
    const username = normalizeUsername(input.username);
    const role = normalizeRole(input.role);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.repository.createAuthUser({
        username,
        passwordHash,
        role,
        isActive: input.isActive !== false,
      });
      return safeAuthUser(user);
    } catch (error) {
      if (duplicateUsername(error)) {
        throw new AuthError("That username is already in use.", {
          statusCode: 409,
          code: "DUPLICATE_USERNAME",
        });
      }
      throw error;
    }
  }

  async updateUser(sessionToken, id, input = {}) {
    await this.requireAdmin(sessionToken);
    const normalizedId = userId(id);
    const username = normalizeUsername(input.username);
    const role = normalizeRole(input.role);
    try {
      const user = await this.repository.updateAuthUser(normalizedId, {
        username,
        role,
        isActive: input.isActive !== false,
      });
      if (!user) throw new AuthError("User was not found.", { statusCode: 404, code: "USER_NOT_FOUND" });
      return safeAuthUser(user);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (duplicateUsername(error)) {
        throw new AuthError("That username is already in use.", {
          statusCode: 409,
          code: "DUPLICATE_USERNAME",
        });
      }
      if (lastAdminError(error)) {
        throw new AuthError("At least one active ADMIN user must remain.", {
          statusCode: 409,
          code: "LAST_ACTIVE_ADMIN",
        });
      }
      throw error;
    }
  }

  async changePassword(sessionToken, id, password) {
    await this.requireAdmin(sessionToken);
    const normalizedId = userId(id);
    const passwordHash = await hashPassword(password);
    const user = await this.repository.setAuthUserPassword(normalizedId, passwordHash);
    if (!user) throw new AuthError("User was not found.", { statusCode: 404, code: "USER_NOT_FOUND" });
    return safeAuthUser(user);
  }
}
