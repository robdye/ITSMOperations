/**
 * EndOfLife.date API client.
 * Provides product lifecycle data for asset compliance tracking.
 * API docs: https://endoflife.date/docs/api/v1/
 */

const EOL_BASE = "https://endoflife.date/api/v1";

async function eolGet(path: string): Promise<any> {
  const url = `${EOL_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`EndOfLife API ${path} failed (${res.status})`);
  }
  return res.json();
}

/** Get all products tracked by endoflife.date */
export async function getAllProducts(): Promise<string[]> {
  const data = await eolGet("/products");
  // v1 API wraps results in { result: [...] }
  const list = data?.result ?? (Array.isArray(data) ? data : []);
  return list.map((p: any) => p.name || p);
}

/** Get lifecycle data for a specific product */
export async function getProduct(product: string): Promise<any> {
  const data = await eolGet(`/products/${encodeURIComponent(product)}`);
  // v1 wraps in { result: { name, releases: [...] } }
  return data?.result ?? data;
}

/** Check EOL status for a specific product version */
export async function checkEolStatus(product: string, version: string): Promise<any> {
  const raw = await eolGet(`/products/${encodeURIComponent(product)}/releases/${encodeURIComponent(version)}`);
  if (!raw) return null;
  // v1 wraps in { result: { ... } }
  const data = raw?.result ?? raw;
  if (!data || !data.name) return null;

  // Enrich with risk classification
  const now = new Date();
  let status: "supported" | "at-risk" | "non-compliant" = "supported";
  let threatLikelihood = 1;

  // v1 uses eolFrom/eoasFrom instead of eol/support
  const eolRaw = data.eolFrom || data.eol;
  const eosRaw = data.eoasFrom || data.support;
  const eolDate = eolRaw ? new Date(eolRaw) : null;
  const eosDate = eosRaw ? new Date(eosRaw) : null;
  const isEol = data.isEol === true;
  const isEoas = data.isEoas === true;
  const isMaintained = data.isMaintained;

  if (isEol || (eolDate && eolDate <= now) || isMaintained === false) {
    status = "non-compliant";
    threatLikelihood = 5;
  } else if (isEoas || (eosDate && eosDate <= now)) {
    // Active support ended but security support still available
    status = "at-risk";
    threatLikelihood = 3;
  } else if (eolDate) {
    const monthsToEol = (eolDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (monthsToEol <= 6) {
      status = "at-risk";
      threatLikelihood = 4;
    } else if (monthsToEol <= 12) {
      status = "at-risk";
      threatLikelihood = 3;
    } else if (monthsToEol <= 24) {
      threatLikelihood = 2;
    }
  }

  return {
    ...data,
    _riskClassification: {
      status,
      threatLikelihood,
      statusEmoji: status === "supported" ? "🟢" : status === "at-risk" ? "🟡" : "🔴",
      eolDate: eolDate?.toISOString().split("T")[0] ?? "Unknown",
      eosDate: eosDate?.toISOString().split("T")[0] ?? "Unknown",
      daysToEol: eolDate ? Math.ceil((eolDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
      nistControl: status === "non-compliant" ? "CM-3: Immediate remediation required" :
                   status === "at-risk" ? "CM-2: Baseline update and migration planning required" :
                   "CM-2: Compliant with baseline configuration",
    },
  };
}

/**
 * Map common software names to endoflife.date product identifiers.
 * Users may say "Windows Server 2019" but the API key is "windows-server".
 */
export function normalizeProductName(input: string): string {
  const lower = input.toLowerCase().trim();
  // Ordered: longer/more-specific keys first to avoid partial matches
  const map: [string, string][] = [
    ["windows 2000 server", "windows-server"],
    ["windows 2003 standard", "windows-server"],
    ["windows server", "windows-server"],
    ["windows-server", "windows-server"],
    ["windows 2000", "windows"],
    ["windows xp", "windows"],
    ["windows vista", "windows"],
    ["sql server", "mssqlserver"],
    [".net framework", "dotnetfx"],
    ["oracle linux", "oracle-linux"],
    ["oracle database", "oracle-database"],
    ["oracle db", "oracle-database"],
    ["vmware esxi", "esxi"],
    ["node.js", "nodejs"],
    ["nodejs", "nodejs"],
    ["linux red hat", "rhel"],
    ["red hat", "rhel"],
    ["redhat", "rhel"],
    ["hp/ux", "hpux"],
    ["hp-ux", "hpux"],
    ["solaris", "oracle-solaris"],
    ["os/400", "ibm-i"],
    ["aix", "ibm-aix"],
    ["windows", "windows"],
    ["ubuntu", "ubuntu"],
    ["rhel", "rhel"],
    ["centos", "centos"],
    ["debian", "debian"],
    ["suse", "sles"],
    ["node", "nodejs"],
    ["java", "java"],
    ["openjdk", "java"],
    ["python", "python"],
    [".net", "dotnet"],
    ["dotnet", "dotnet"],
    ["postgresql", "postgresql"],
    ["postgres", "postgresql"],
    ["mysql", "mysql"],
    ["mongodb", "mongodb"],
    ["redis", "redis"],
    ["nginx", "nginx"],
    ["apache", "apache"],
    ["tomcat", "tomcat"],
    ["kubernetes", "kubernetes"],
    ["k8s", "kubernetes"],
    ["docker", "docker-engine"],
    ["elasticsearch", "elasticsearch"],
    ["esxi", "esxi"],
    ["vcenter", "vcenter"],
    ["citrix", "citrix-vad"],
    ["iis", "iis"],
    ["exchange", "exchange"],
    ["sharepoint", "sharepoint"],
    ["office", "office"],
  ];

  for (const [key, val] of map) {
    if (lower.includes(key)) return val;
  }
  return lower.replace(/\s+/g, "-");
}

/**
 * Extract a usable version string from ServiceNow OS/OS_version fields.
 * ServiceNow stores messy values like "Enterprise Server 3", "5.2 build 3790",
 * "Professional", "V5R2", etc. We need to extract something endoflife.date understands.
 */
export function extractVersion(osName: string, osVersion: string): string {
  const os = osName.toLowerCase();
  const ver = osVersion.trim();

  // Windows: extract version from the OS name itself (e.g. "Windows 2000 Server" → "2000")
  if (os.includes("windows")) {
    // Try extracting year/version from OS name: Windows 2000, Windows XP, Windows 2003
    const yearMatch = os.match(/windows\s*(server\s*)?(\d{4})/);
    if (yearMatch) return yearMatch[2];
    if (os.includes("xp")) return "xp";
    if (os.includes("vista")) return "vista";
    if (os.includes("10")) return "10";
    if (os.includes("11")) return "11";
    // Try the version field
    if (ver) {
      const verYear = ver.match(/(\d{4})/);
      if (verYear) return verYear[1];
    }
  }

  // Red Hat / Linux: extract major version number
  if (os.includes("red hat") || os.includes("rhel") || os.includes("linux red hat")) {
    // Version might be in os_version like "Enterprise Server 3" or "8.4"
    const numMatch = ver.match(/(\d+)/);
    if (numMatch) return numMatch[1];
  }

  // For most products, try to extract the first numeric version
  if (ver) {
    // Extract leading version number (e.g. "5.2 build 3790" → "5.2", "V5R2" → "5")
    const leadingNum = ver.match(/v?(\d+(?:\.\d+)?)/i);
    if (leadingNum) return leadingNum[1];
  }

  // Last resort: try to extract a version from the OS name itself
  const nameNum = os.match(/(\d+(?:\.\d+)?)/);
  if (nameNum) return nameNum[1];

  return "";
}
