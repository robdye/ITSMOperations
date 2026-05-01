// ITSM Operations — Tenant profile loader
// Minimal, file-based for the MVP slice. Cosmos-backed loader is a follow-up
// phase; the interface here is the contract that loader will implement.

import fs from 'fs';
import path from 'path';

export interface TenantProfile {
  tenantId: string;
  /** 'demo' pins models + temperature; 'prod' uses live runtime defaults. */
  profile: 'demo' | 'prod';
  /** Whether the demo-director may load and run scenarios. */
  allowDemoDirector: boolean;
  /** SNOW host allow-list (substring match). Empty = no SNOW writes allowed. */
  snowAllowList: string[];
}

const DEFAULT_TENANT_ID = process.env.TENANT_ID || 'default';

const profileDir = path.resolve(__dirname, 'tenant-profiles');

let cache = new Map<string, TenantProfile>();

function fallbackProfile(tenantId: string): TenantProfile {
  return {
    tenantId,
    profile: 'prod',
    allowDemoDirector: false,
    snowAllowList: [],
  };
}

export function loadTenantProfile(tenantId: string = DEFAULT_TENANT_ID): TenantProfile {
  const cached = cache.get(tenantId);
  if (cached) return cached;

  const file = path.join(profileDir, `${tenantId}.json`);
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TenantProfile>;
      const profile: TenantProfile = {
        tenantId,
        profile: raw.profile === 'demo' ? 'demo' : 'prod',
        allowDemoDirector: !!raw.allowDemoDirector,
        snowAllowList: Array.isArray(raw.snowAllowList) ? raw.snowAllowList : [],
      };
      cache.set(tenantId, profile);
      return profile;
    } catch (err) {
      console.warn(
        `[TenantProfile] Failed to parse ${file}, falling back to safe defaults:`,
        (err as Error).message,
      );
    }
  }

  const fallback = fallbackProfile(tenantId);
  cache.set(tenantId, fallback);
  return fallback;
}

export function isSnowHostAllowed(profile: TenantProfile, instanceUrl: string): boolean {
  if (!profile.snowAllowList || profile.snowAllowList.length === 0) return false;
  let host = instanceUrl;
  try {
    host = new URL(instanceUrl).host;
  } catch {
    /* keep raw string */
  }
  return profile.snowAllowList.some((pattern) => {
    if (pattern.startsWith('*.')) {
      return host.endsWith(pattern.slice(1));
    }
    return host === pattern || host.includes(pattern);
  });
}

/** Test-only. */
export function _resetTenantProfileCache(): void {
  cache = new Map();
}
