/**
 * Org / user / token / usage store (JSON under data/).
 * Free-stack: no paid auth providers required.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ROOT = process.env.PROJECT_ROOT
  ? path.resolve(process.env.PROJECT_ROOT)
  : path.resolve(__dirname, "..");

function dataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
}

function accountsPath(): string {
  return path.join(dataDir(), "accounts.json");
}

export const DEMO_TOKEN = "demo";
export const DEMO_ORG_ID = "org_demo";
export const DEMO_EMAIL = "demo@localhost";

type Org = {
  id: string;
  name: string;
  created_at: string;
  usage: Record<string, { diffs?: number }>;
};

type User = {
  email: string;
  password_hash: string;
  org_id: string;
  created_at: string;
};

type Token = {
  token: string;
  user_email: string;
  org_id: string;
  created_at: string;
};

export type AuthContext = {
  token: string;
  user_email: string;
  org_id: string;
  org: Org;
};

export type UsageSnapshot = {
  org_id: string;
  month: string;
  diffs_used: number;
};

function utcnow(): string {
  return new Date().toISOString();
}

function monthKey(when = new Date()): string {
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function hashPassword(password: string, salt?: string): string {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const digest = crypto.pbkdf2Sync(password, s, 120_000, 32, "sha256").toString("hex");
  return `${s}$${digest}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const salt = stored.split("$")[0];
  if (!salt || !stored.includes("$")) return false;
  const computed = hashPassword(password, salt);
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(stored));
}

function safeVerify(password: string, stored: string): boolean {
  try {
    return verifyPassword(password, stored);
  } catch {
    return false;
  }
}

export class AccountsStore {
  orgs: Record<string, Org> = {};
  users: Record<string, User> = {};
  tokens: Record<string, Token> = {};

  load(): void {
    fs.mkdirSync(dataDir(), { recursive: true });
    const p = accountsPath();
    if (!fs.existsSync(p)) {
      this._ensureDemo();
      this._persist();
      return;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    this.orgs = raw.orgs || {};
    this.users = raw.users || {};
    this.tokens = raw.tokens || {};
    for (const org of Object.values(this.orgs)) {
      delete (org as { plan?: string }).plan;
    }
    this._ensureDemo();
    this._persist();
  }

  private _ensureDemo(): void {
    if (!this.orgs[DEMO_ORG_ID]) {
      this.orgs[DEMO_ORG_ID] = {
        id: DEMO_ORG_ID,
        name: "Demo Org",
        created_at: utcnow(),
        usage: {},
      };
    }
    if (!this.users[DEMO_EMAIL]) {
      this.users[DEMO_EMAIL] = {
        email: DEMO_EMAIL,
        password_hash: hashPassword("demo"),
        org_id: DEMO_ORG_ID,
        created_at: utcnow(),
      };
    }
    if (!this.tokens[DEMO_TOKEN]) {
      this.tokens[DEMO_TOKEN] = {
        token: DEMO_TOKEN,
        user_email: DEMO_EMAIL,
        org_id: DEMO_ORG_ID,
        created_at: utcnow(),
      };
    }
  }

  private _persist(): void {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(
      accountsPath(),
      JSON.stringify({ orgs: this.orgs, users: this.users, tokens: this.tokens }, null, 2)
    );
  }

  signup(email: string, password: string, orgName: string) {
    const key = email.trim().toLowerCase();
    if (!key || !key.includes("@")) throw new Error("Valid email required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");
    if (!orgName.trim()) throw new Error("org_name required");
    if (this.users[key]) throw new Error("Email already registered");

    const orgId = `org_${crypto.randomBytes(6).toString("hex")}`;
    const token = crypto.randomBytes(24).toString("base64url");
    const now = utcnow();
    this.orgs[orgId] = {
      id: orgId,
      name: orgName.trim(),
      created_at: now,
      usage: {},
    };
    this.users[key] = {
      email: key,
      password_hash: hashPassword(password),
      org_id: orgId,
      created_at: now,
    };
    this.tokens[token] = {
      token,
      user_email: key,
      org_id: orgId,
      created_at: now,
    };
    this._persist();
    return {
      email: key,
      org_id: orgId,
      org_name: orgName.trim(),
      token,
    };
  }

  login(email: string, password: string) {
    const key = email.trim().toLowerCase();
    const user = this.users[key];
    if (!user || !safeVerify(password, user.password_hash)) {
      throw new Error("Invalid email or password");
    }
    const org = this.orgs[user.org_id];
    const token = crypto.randomBytes(24).toString("base64url");
    this.tokens[token] = {
      token,
      user_email: key,
      org_id: user.org_id,
      created_at: utcnow(),
    };
    this._persist();
    return {
      email: key,
      org_id: user.org_id,
      org_name: org.name,
      token,
    };
  }

  resolveToken(token: string | undefined | null): AuthContext | null {
    if (!token) return null;
    const entry = this.tokens[token];
    if (!entry) return null;
    const org = this.orgs[entry.org_id];
    if (!org) return null;
    return {
      token,
      user_email: entry.user_email,
      org_id: entry.org_id,
      org,
    };
  }

  usageSnapshot(orgId: string): UsageSnapshot {
    const org = this.orgs[orgId];
    const month = monthKey();
    const used = Number(org.usage?.[month]?.diffs || 0);
    return {
      org_id: orgId,
      month,
      diffs_used: used,
    };
  }

  recordDiff(orgId: string): UsageSnapshot {
    const org = this.orgs[orgId];
    const month = monthKey();
    if (!org.usage) org.usage = {};
    if (!org.usage[month]) org.usage[month] = { diffs: 0 };
    org.usage[month].diffs = Number(org.usage[month].diffs || 0) + 1;
    this._persist();
    return this.usageSnapshot(orgId);
  }
}

export const accounts = new AccountsStore();
