"""
execute_transfer.py — Generate and optionally execute agent ownership transfers.

Reads the owned-agents report and produces API calls for the Package Management
API reassign endpoint. Supports dry-run mode for review before execution.

Usage:
    python execute_transfer.py owned.json --new-owner "newowner@contoso.com" [--dry-run] [--output transfers.json]

IMPORTANT: This script generates the transfer commands. It does NOT auto-execute
unless --execute flag is explicitly passed. Default is dry-run.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def generate_transfers(owned_report: dict, new_owner_id: str, dry_run: bool = True) -> dict:
    """Generate transfer commands for all owned agents."""
    transfers = []

    for agent in owned_report.get("agents", []):
        transfer = {
            "packageId": agent["packageId"],
            "displayName": agent["displayName"],
            "urgencyScore": agent["urgencyScore"],
            "transferSLA": agent["transferSLA"],
            "api_call": {
                "method": "POST",
                "endpoint": f"/beta/copilot/admin/catalog/packages/{agent['packageId']}/reassign",
                "body": {
                    "newOwnerId": new_owner_id,
                },
            },
            "status": "DRY_RUN" if dry_run else "PENDING",
        }
        transfers.append(transfer)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "departing_user": owned_report.get("departing_user", ""),
        "new_owner": new_owner_id,
        "dry_run": dry_run,
        "total_transfers": len(transfers),
        "transfers": transfers,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} owned.json --new-owner user@contoso.com [--dry-run]", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    new_owner = ""
    dry_run = True
    output_path = Path("transfers.json")

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--new-owner" and i + 1 < len(args):
            new_owner = args[i + 1]
            i += 2
        elif args[i] == "--execute":
            dry_run = False
            i += 1
        elif args[i] == "--dry-run":
            dry_run = True
            i += 1
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1])
            i += 2
        else:
            i += 1

    if not new_owner:
        print("Error: --new-owner is required", file=sys.stderr)
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        owned_report = json.load(f)

    result = generate_transfers(owned_report, new_owner, dry_run)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    mode = "DRY RUN" if dry_run else "EXECUTE"
    print(f"Transfer plan generated [{mode}]")
    print(f"  From: {result['departing_user']}")
    print(f"  To: {new_owner}")
    print(f"  Agents: {result['total_transfers']}")
    print(f"Output: {output_path}")

    if not dry_run:
        print("\n⚠️  EXECUTE mode — transfers would be submitted to the API")
        print("    (Actual API calls not implemented in this demo script)")


if __name__ == "__main__":
    main()
