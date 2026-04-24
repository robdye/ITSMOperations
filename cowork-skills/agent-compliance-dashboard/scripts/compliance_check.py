"""
compliance_check.py — Deterministic compliance scoring for agent packages.

Applies organizational governance rules to each package and produces
a scored compliance report. Zero AI tokens — pure rule evaluation.

Usage:
    python compliance_check.py input.json [--cmdb cmdb.json] [--output report.json]

Input:  JSON array of copilotPackageDetail objects
Output: JSON report with per-agent scores and findings
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


RULES = {
    "R1_SENSITIVITY": {"name": "Sensitivity Classification", "max_points": 15},
    "R2_SCOPE": {"name": "Scope Appropriateness", "max_points": 20},
    "R3_STALENESS": {"name": "Staleness", "max_points": 15},
    "R4_CMDB": {"name": "CMDB Registration", "max_points": 15},
    "R5_OWNER": {"name": "Owner Assignment", "max_points": 15},
    "R6_DESCRIPTION": {"name": "Description Quality", "max_points": 10},
    "R7_VERSION": {"name": "Version Hygiene", "max_points": 10},
}

GRADE_THRESHOLDS = [
    (90, "A"), (75, "B"), (50, "C"), (25, "D"), (0, "F"),
]


def grade_from_score(score: int) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "F"


def check_r1(pkg: dict) -> tuple[int, str, str]:
    sensitivity = pkg.get("sensitivity", "")
    if sensitivity:
        return 15, "PASS", f"Sensitivity classified as '{sensitivity}'"
    return 0, "FAIL", "Missing sensitivity classification"


def check_r2(pkg: dict) -> tuple[int, str, str]:
    available_to = pkg.get("availableTo", "none")
    pkg_type = pkg.get("type", "custom")
    if pkg_type != "custom":
        return 20, "PASS", f"Non-custom agent ({pkg_type}), scope policy N/A"
    if available_to == "none":
        return 20, "PASS", "Scoped to no users (not deployed)"
    if available_to == "some":
        return 10, "WARN", "Custom agent available to some users — verify group scoping"
    if available_to == "all":
        return 0, "FAIL", "Custom agent available to ALL users without documented CISO approval"
    return 20, "PASS", "Properly scoped"


def check_r3(pkg: dict, now: datetime) -> tuple[int, str, str]:
    last_mod = pkg.get("lastModifiedDateTime", "")
    if not last_mod:
        return 0, "FAIL", "No lastModifiedDateTime recorded"
    dt = datetime.fromisoformat(last_mod.replace("Z", "+00:00"))
    days = (now - dt).days
    if days <= 90:
        return 15, "PASS", f"Updated {days} days ago"
    if days <= 180:
        return 10, "WARN", f"Last updated {days} days ago (approaching stale threshold)"
    return 0, "FAIL", f"Stale — last updated {days} days ago (>{180} day threshold)"


def check_r4(pkg: dict, cmdb_app_ids: set) -> tuple[int, str, str]:
    app_id = pkg.get("appId", "")
    if not cmdb_app_ids:
        return -1, "SKIP", "CMDB data not available for cross-reference"
    if app_id and app_id in cmdb_app_ids:
        return 15, "PASS", f"Agent registered in CMDB (appId: {app_id[:8]}...)"
    return 0, "FAIL", "Agent not found in CMDB — register as CI"


def check_r5(pkg: dict) -> tuple[int, str, str]:
    # Check acquireUsersAndGroups or publisher as proxy for ownership
    acquire = pkg.get("acquireUsersAndGroups", [])
    publisher = pkg.get("publisher", "")
    if acquire:
        return 15, "PASS", f"Owner assigned ({len(acquire)} users/groups)"
    if publisher:
        return 10, "WARN", f"Publisher set ({publisher}) but no explicit owner"
    return 0, "FAIL", "No owner or publisher assigned"


def check_r6(pkg: dict) -> tuple[int, str, str]:
    short = pkg.get("shortDescription", "")
    long = pkg.get("longDescription", "")
    if short and long:
        return 10, "PASS", "Both descriptions populated"
    if short:
        return 5, "WARN", "Only short description populated"
    return 0, "FAIL", "No description provided"


def check_r7(pkg: dict) -> tuple[int, str, str]:
    version = pkg.get("version", "")
    if not version:
        return 0, "FAIL", "No version specified"
    parts = version.split(".")
    if len(parts) >= 2 and all(p.isdigit() for p in parts):
        return 10, "PASS", f"Version {version} follows semver"
    return 5, "WARN", f"Version '{version}' may not follow semver convention"


def assess(packages: list[dict], cmdb_app_ids: set | None = None) -> dict:
    now = datetime.now(timezone.utc)
    if cmdb_app_ids is None:
        cmdb_app_ids = set()

    results = []
    summary = {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}

    for pkg in packages:
        findings = {}
        total_earned = 0
        total_possible = 0

        checks = [
            ("R1_SENSITIVITY", check_r1(pkg)),
            ("R2_SCOPE", check_r2(pkg)),
            ("R3_STALENESS", check_r3(pkg, now)),
            ("R4_CMDB", check_r4(pkg, cmdb_app_ids)),
            ("R5_OWNER", check_r5(pkg)),
            ("R6_DESCRIPTION", check_r6(pkg)),
            ("R7_VERSION", check_r7(pkg)),
        ]

        for rule_id, (points, status, detail) in checks:
            max_pts = RULES[rule_id]["max_points"]
            if status == "SKIP":
                findings[rule_id] = {"status": status, "detail": detail, "points": "N/A"}
                continue
            total_earned += max(points, 0)
            total_possible += max_pts
            findings[rule_id] = {
                "status": status,
                "points": f"{points}/{max_pts}",
                "detail": detail,
            }

        score = round((total_earned / total_possible) * 100) if total_possible > 0 else 0
        grade = grade_from_score(score)
        summary[grade] += 1

        results.append({
            "packageId": pkg.get("id", ""),
            "displayName": pkg.get("displayName", ""),
            "type": pkg.get("type", ""),
            "score": score,
            "grade": grade,
            "findings": findings,
        })

    results.sort(key=lambda r: r["score"])

    return {
        "audit_date": now.isoformat(),
        "total_packages": len(results),
        "grade_distribution": summary,
        "overall_compliance_pct": round(
            sum(1 for r in results if r["grade"] in ("A", "B")) / max(len(results), 1) * 100
        ),
        "results": results,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} input.json [--cmdb cmdb.json] [--output report.json]", file=sys.stderr)
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path("compliance-report.json")
    cmdb_ids: set = set()

    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--cmdb" and i + 1 < len(args):
            with open(args[i + 1], "r", encoding="utf-8") as f:
                cmdb_data = json.load(f)
                cmdb_ids = {ci.get("appId", "") for ci in cmdb_data if ci.get("appId")}
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1])
            i += 2
        else:
            i += 1

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    packages = data.get("value", data) if isinstance(data, dict) else data
    report = assess(packages, cmdb_ids if cmdb_ids else None)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    dist = report["grade_distribution"]
    print(f"Compliance audit complete: {report['total_packages']} packages")
    print(f"  A: {dist['A']} | B: {dist['B']} | C: {dist['C']} | D: {dist['D']} | F: {dist['F']}")
    print(f"  Overall compliance: {report['overall_compliance_pct']}%")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
