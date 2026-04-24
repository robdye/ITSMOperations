"""
extract_inventory.py — Deterministic inventory extraction (zero AI tokens).

Reads a JSON export of M365 Package Management API packages and produces
a normalized CSV with risk scoring and staleness flags.

Usage:
    python extract_inventory.py input.json [--output inventory.csv]

Input:  JSON array of copilotPackageDetail objects (from GET /copilot/admin/catalog/packages)
Output: CSV with enriched columns including DaysSinceUpdate, StaleFlag, ScopeRisk
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


STALE_THRESHOLD_DAYS = 90

HEADERS = [
    "PackageId",
    "DisplayName",
    "Publisher",
    "Type",
    "Version",
    "Platform",
    "SupportedHosts",
    "ElementTypes",
    "IsBlocked",
    "AvailableTo",
    "DeployedTo",
    "LastModified",
    "ManifestId",
    "AppId",
    "DaysSinceUpdate",
    "StaleFlag",
    "ScopeRisk",
]


def parse_datetime(dt_str: str) -> datetime:
    """Parse ISO 8601 datetime string, handling Z suffix."""
    if not dt_str:
        return datetime.min.replace(tzinfo=timezone.utc)
    dt_str = dt_str.replace("Z", "+00:00")
    return datetime.fromisoformat(dt_str)


def score_scope_risk(available_to: str, pkg_type: str) -> str:
    """
    Classify scope risk:
    - HIGH: custom agent available to all users (shadow IT risk)
    - MEDIUM: available to some users or external agent available to all
    - LOW: properly scoped or Microsoft-published
    """
    if pkg_type == "custom" and available_to == "all":
        return "HIGH"
    if available_to == "all" and pkg_type == "external":
        return "MEDIUM"
    if available_to == "some":
        return "MEDIUM"
    return "LOW"


def extract(packages: list[dict], now: datetime | None = None) -> list[dict]:
    """Transform raw API packages into enriched inventory rows."""
    if now is None:
        now = datetime.now(timezone.utc)

    rows = []
    for pkg in packages:
        last_modified = parse_datetime(pkg.get("lastModifiedDateTime", ""))
        days_since = (now - last_modified).days if last_modified != datetime.min.replace(tzinfo=timezone.utc) else -1
        available_to = pkg.get("availableTo", "none")
        pkg_type = pkg.get("type", "unknownFutureValue")

        rows.append({
            "PackageId": pkg.get("id", ""),
            "DisplayName": pkg.get("displayName", ""),
            "Publisher": pkg.get("publisher", ""),
            "Type": pkg_type,
            "Version": pkg.get("version", ""),
            "Platform": pkg.get("platform", ""),
            "SupportedHosts": ", ".join(pkg.get("supportedHosts", [])),
            "ElementTypes": ", ".join(pkg.get("elementTypes", [])),
            "IsBlocked": str(pkg.get("isBlocked", False)),
            "AvailableTo": available_to,
            "DeployedTo": pkg.get("deployedTo", "none"),
            "LastModified": pkg.get("lastModifiedDateTime", ""),
            "ManifestId": pkg.get("manifestId", ""),
            "AppId": pkg.get("appId", ""),
            "DaysSinceUpdate": days_since if days_since >= 0 else "unknown",
            "StaleFlag": str(days_since > STALE_THRESHOLD_DAYS) if days_since >= 0 else "unknown",
            "ScopeRisk": score_scope_risk(available_to, pkg_type),
        })

    return rows


def write_csv(rows: list[dict], output_path: Path) -> None:
    """Write enriched rows to CSV."""
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} input.json [--output inventory.csv]", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path("inventory.csv")

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_path = Path(sys.argv[idx + 1])

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle both {"value": [...]} and plain [...] formats
    packages = data.get("value", data) if isinstance(data, dict) else data

    rows = extract(packages)
    write_csv(rows, output_path)

    # Print summary to stdout
    total = len(rows)
    stale = sum(1 for r in rows if r["StaleFlag"] == "True")
    high_risk = sum(1 for r in rows if r["ScopeRisk"] == "HIGH")
    blocked = sum(1 for r in rows if r["IsBlocked"] == "True")

    print(f"Inventory extracted: {total} packages")
    print(f"  Stale (>{STALE_THRESHOLD_DAYS}d): {stale}")
    print(f"  High scope risk:  {high_risk}")
    print(f"  Blocked:          {blocked}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
