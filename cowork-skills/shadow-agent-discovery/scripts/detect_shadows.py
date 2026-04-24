"""
detect_shadows.py — Deterministic shadow agent detection (zero AI tokens).

Compares Package Management API inventory against the Approved Agent Registry
to identify unregistered, expired, or modified agents.

Usage:
    python detect_shadows.py inventory.json registry.csv [--output shadows.json]

Input:
  - inventory.json: Package Management API export
  - registry.csv: Approved Agent Registry export (ManifestId, ApprovalDate, ReviewDate)
Output:
  - JSON report with classified findings
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


CLASSIFICATIONS = {
    "UNREGISTERED_CUSTOM": {"label": "Unregistered Custom Agent", "risk": "Critical", "deadline_days": 5},
    "UNREGISTERED_EXTERNAL": {"label": "Unregistered External Agent", "risk": "High", "deadline_days": 14},
    "EXPIRED_APPROVAL": {"label": "Expired Approval", "risk": "Medium", "deadline_days": 30},
    "MODIFIED_SINCE_APPROVAL": {"label": "Modified Since Approval", "risk": "Medium", "deadline_days": 30},
    "REGISTERED": {"label": "Registered & Current", "risk": "None", "deadline_days": 0},
}


def load_registry(registry_path: Path) -> dict[str, dict]:
    """Load the approved registry as a dict keyed by manifestId."""
    registry = {}
    if not registry_path.exists():
        return registry

    suffix = registry_path.suffix.lower()
    if suffix == ".csv":
        with open(registry_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                mid = row.get("ManifestId", "").strip()
                if mid:
                    registry[mid] = row
    elif suffix == ".json":
        with open(registry_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            entries = data if isinstance(data, list) else data.get("entries", [])
            for entry in entries:
                mid = entry.get("ManifestId", "").strip()
                if mid:
                    registry[mid] = entry
    return registry


def parse_date(date_str: str) -> datetime | None:
    """Parse various date formats."""
    if not date_str:
        return None
    for fmt in ["%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%d/%m/%Y"]:
        try:
            dt = datetime.strptime(date_str.replace("Z", "+00:00") if "Z" in date_str else date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def detect(packages: list[dict], registry: dict[str, dict]) -> dict:
    """Classify each package against the registry."""
    now = datetime.now(timezone.utc)
    findings = []
    stats = {"Critical": 0, "High": 0, "Medium": 0, "None": 0}

    for pkg in packages:
        manifest_id = pkg.get("manifestId", "")
        pkg_type = pkg.get("type", "custom")
        last_modified = parse_date(pkg.get("lastModifiedDateTime", ""))
        available_to = pkg.get("availableTo", "none")

        # Skip Microsoft 1st-party agents
        if pkg_type == "microsoft":
            stats["None"] += 1
            findings.append({
                "packageId": pkg.get("id", ""),
                "displayName": pkg.get("displayName", ""),
                "manifestId": manifest_id,
                "type": pkg_type,
                "classification": "REGISTERED",
                "risk": "None",
                "detail": "Microsoft 1st-party — exempt from registry",
            })
            continue

        reg_entry = registry.get(manifest_id)

        if not reg_entry:
            # Not in registry
            if pkg_type == "custom":
                cls = "UNREGISTERED_CUSTOM"
            else:
                cls = "UNREGISTERED_EXTERNAL"
        else:
            # In registry — check if still current
            review_date = parse_date(reg_entry.get("ReviewDate", ""))
            approval_date = parse_date(reg_entry.get("ApprovalDate", ""))

            if review_date and now > review_date:
                cls = "EXPIRED_APPROVAL"
            elif approval_date and last_modified and last_modified > approval_date:
                cls = "MODIFIED_SINCE_APPROVAL"
            else:
                cls = "REGISTERED"

        config = CLASSIFICATIONS[cls]
        stats[config["risk"]] += 1

        finding = {
            "packageId": pkg.get("id", ""),
            "displayName": pkg.get("displayName", ""),
            "manifestId": manifest_id,
            "type": pkg_type,
            "version": pkg.get("version", ""),
            "publisher": pkg.get("publisher", ""),
            "availableTo": available_to,
            "lastModified": pkg.get("lastModifiedDateTime", ""),
            "classification": cls,
            "classificationLabel": config["label"],
            "risk": config["risk"],
            "deadlineDays": config["deadline_days"],
            "scopeAlarm": available_to == "all" and cls != "REGISTERED",
        }

        if reg_entry:
            finding["registryEntry"] = {
                "approvedBy": reg_entry.get("ApprovedBy", ""),
                "approvalDate": reg_entry.get("ApprovalDate", ""),
                "approvalCR": reg_entry.get("ApprovalCR", ""),
                "reviewDate": reg_entry.get("ReviewDate", ""),
            }

        findings.append(finding)

    # Sort: Critical first, then High, Medium, None
    risk_order = {"Critical": 0, "High": 1, "Medium": 2, "None": 3}
    findings.sort(key=lambda f: risk_order.get(f["risk"], 4))

    total = len(findings)
    registered = stats["None"]
    shadow = total - registered

    return {
        "scan_date": now.isoformat(),
        "total_packages": total,
        "registered_count": registered,
        "shadow_count": shadow,
        "coverage_pct": round(registered / max(total, 1) * 100),
        "risk_breakdown": stats,
        "findings": findings,
    }


def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} inventory.json registry.csv [--output shadows.json]", file=sys.stderr)
        sys.exit(1)

    inventory_path = Path(sys.argv[1])
    registry_path = Path(sys.argv[2])
    output_path = Path("shadows.json")

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output_path = Path(sys.argv[idx + 1])

    with open(inventory_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    packages = data.get("value", data) if isinstance(data, dict) else data
    registry = load_registry(registry_path)

    report = detect(packages, registry)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"Shadow scan complete: {report['total_packages']} packages scanned")
    print(f"  Registered: {report['registered_count']} ({report['coverage_pct']}%)")
    print(f"  Shadow agents: {report['shadow_count']}")
    print(f"  Critical: {report['risk_breakdown']['Critical']} | High: {report['risk_breakdown']['High']} | Medium: {report['risk_breakdown']['Medium']}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
