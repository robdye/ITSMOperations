"""
identify_owned_agents.py — Find all agent packages owned by a specific user.

Scans the Package Management API inventory for packages where the specified
user appears as owner, acquirer, or publisher.

Usage:
    python identify_owned_agents.py inventory.json --user "user@contoso.com" [--output owned.json]

Zero AI tokens — pure data filtering.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


URGENCY_FACTORS = {
    "scope_all": 3,       # availableTo: all
    "type_custom": 2,     # custom agent (no vendor fallback)
    "high_usage": 2,      # active users > 50 (if data available)
    "critical_ci": 3,     # critical business service in CMDB
    "no_alt_owner": 2,    # no other user in acquireUsersAndGroups
}


def find_owned(packages: list[dict], user_identifier: str) -> list[dict]:
    """Find packages owned by the specified user."""
    user_lower = user_identifier.lower()
    owned = []

    for pkg in packages:
        ownership_signals = []

        # Check publisher
        publisher = pkg.get("publisher", "").lower()
        if user_lower in publisher:
            ownership_signals.append("publisher")

        # Check acquireUsersAndGroups
        acquirers = pkg.get("acquireUsersAndGroups", [])
        for entry in acquirers:
            entry_id = str(entry.get("id", "")).lower()
            entry_name = str(entry.get("displayName", "")).lower()
            if user_lower in entry_id or user_lower in entry_name:
                ownership_signals.append("acquireUsersAndGroups")
                break

        if not ownership_signals:
            continue

        # Calculate urgency
        urgency = 0
        urgency_factors = []

        if pkg.get("availableTo") == "all":
            urgency += URGENCY_FACTORS["scope_all"]
            urgency_factors.append("Org-wide scope")

        if pkg.get("type") == "custom":
            urgency += URGENCY_FACTORS["type_custom"]
            urgency_factors.append("Custom agent")

        other_owners = [a for a in acquirers if user_lower not in str(a.get("id", "")).lower()
                        and user_lower not in str(a.get("displayName", "")).lower()]
        if not other_owners:
            urgency += URGENCY_FACTORS["no_alt_owner"]
            urgency_factors.append("No alternative owner")

        # Determine SLA
        if urgency >= 7:
            sla = "1 business day (Critical)"
        elif urgency >= 4:
            sla = "3 business days (Elevated)"
        else:
            sla = "5 business days (Standard)"

        owned.append({
            "packageId": pkg.get("id", ""),
            "displayName": pkg.get("displayName", ""),
            "type": pkg.get("type", ""),
            "version": pkg.get("version", ""),
            "availableTo": pkg.get("availableTo", ""),
            "deployedTo": pkg.get("deployedTo", ""),
            "supportedHosts": pkg.get("supportedHosts", []),
            "lastModified": pkg.get("lastModifiedDateTime", ""),
            "isBlocked": pkg.get("isBlocked", False),
            "ownershipSignals": ownership_signals,
            "otherOwnerCount": len(other_owners),
            "urgencyScore": urgency,
            "urgencyFactors": urgency_factors,
            "transferSLA": sla,
            "suggestedNewOwners": [
                {"source": "alternative_acquirer", "id": a.get("id", ""), "name": a.get("displayName", "")}
                for a in other_owners[:3]
            ],
        })

    # Sort by urgency (highest first)
    owned.sort(key=lambda a: a["urgencyScore"], reverse=True)
    return owned


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} inventory.json --user user@contoso.com [--output owned.json]", file=sys.stderr)
        sys.exit(1)

    inventory_path = Path(sys.argv[1])
    user = ""
    output_path = Path("owned-agents.json")

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--user" and i + 1 < len(args):
            user = args[i + 1]
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1])
            i += 2
        else:
            i += 1

    if not user:
        print("Error: --user is required", file=sys.stderr)
        sys.exit(1)

    with open(inventory_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    packages = data.get("value", data) if isinstance(data, dict) else data
    owned = find_owned(packages, user)

    result = {
        "scan_date": datetime.now(timezone.utc).isoformat(),
        "departing_user": user,
        "total_agents_owned": len(owned),
        "urgency_breakdown": {
            "critical": sum(1 for a in owned if a["urgencyScore"] >= 7),
            "elevated": sum(1 for a in owned if 4 <= a["urgencyScore"] < 7),
            "standard": sum(1 for a in owned if a["urgencyScore"] < 4),
        },
        "agents": owned,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"Ownership scan for: {user}")
    print(f"  Agents owned: {len(owned)}")
    print(f"  Critical urgency: {result['urgency_breakdown']['critical']}")
    print(f"  Elevated urgency: {result['urgency_breakdown']['elevated']}")
    print(f"  Standard urgency: {result['urgency_breakdown']['standard']}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
