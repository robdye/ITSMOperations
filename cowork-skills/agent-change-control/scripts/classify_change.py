"""
classify_change.py — Deterministic change classification for agent lifecycle events.

Takes an agent event type and package metadata, produces a structured
change record with ITIL classification, NIST alignment, and risk scoring.

Usage:
    python classify_change.py --event "deploy" --package package.json [--output change.json]

Zero AI tokens — pure rule-based classification.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


# Event → ITIL classification mapping
EVENT_CLASSIFICATION = {
    "deploy": {"itil_type": "Normal", "default_likelihood": 3, "default_impact": 3},
    "update": {"itil_type": "Standard", "default_likelihood": 2, "default_impact": 2},
    "block": {"itil_type": "Emergency", "default_likelihood": 4, "default_impact": 4},
    "unblock": {"itil_type": "Normal", "default_likelihood": 5, "default_impact": 3},
    "scope_change": {"itil_type": "Normal", "default_likelihood": 3, "default_impact": 4},
    "reassign": {"itil_type": "Standard", "default_likelihood": 1, "default_impact": 1},
}

# Risk tier thresholds
RISK_TIERS = [
    (5, "Low", "Standard change. Auto-approve if pre-authorized."),
    (12, "Medium", "Normal change. Change Manager approval required."),
    (19, "High", "CAB review mandatory. Detailed impact analysis required."),
    (25, "Critical", "CISO and CTO sign-off. Board notification."),
]

# NIST CM-3 sub-controls by risk tier
NIST_CONTROLS = {
    "Low": ["CM-3(a) Determine types of changes", "CM-3(b) Review proposed changes"],
    "Medium": ["CM-3(a)", "CM-3(b)", "CM-3(d) Document change decisions", "CM-3(f) Audit trail"],
    "High": ["CM-3(a)", "CM-3(b)", "CM-3(c) Security impact analysis", "CM-3(d)", "CM-3(e) Retention", "CM-3(f)", "CM-4 Impact Analysis"],
    "Critical": ["CM-3(a)", "CM-3(b)", "CM-3(c)", "CM-3(d)", "CM-3(e)", "CM-3(f)", "CM-4", "CM-5 Access Restrictions for Change"],
}


def classify(event: str, package: dict) -> dict:
    """Produce a structured change record from event type and package metadata."""
    config = EVENT_CLASSIFICATION.get(event, EVENT_CLASSIFICATION["deploy"])

    # Adjust impact based on scope
    available_to = package.get("availableTo", "none")
    impact = config["default_impact"]
    if available_to == "all":
        impact = max(impact, 4)
    elif available_to == "some":
        impact = max(impact, 2)

    # Adjust impact for custom agents (higher governance bar)
    pkg_type = package.get("type", "custom")
    if pkg_type == "custom":
        impact = min(impact + 1, 5)

    likelihood = config["default_likelihood"]
    score = likelihood * impact

    # Determine risk tier
    tier = "Critical"
    tier_guidance = RISK_TIERS[-1][2]
    for threshold, name, guidance in RISK_TIERS:
        if score <= threshold:
            tier = name
            tier_guidance = guidance
            break

    # PIR schedule
    pir_days = {"Standard": 5, "Normal": 3, "Emergency": 1}.get(config["itil_type"], 3)

    return {
        "change_id": f"CR-AGENT-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": event,
        "itil_classification": config["itil_type"],
        "package": {
            "id": package.get("id", ""),
            "displayName": package.get("displayName", ""),
            "type": pkg_type,
            "version": package.get("version", ""),
            "availableTo": available_to,
            "publisher": package.get("publisher", ""),
        },
        "risk_assessment": {
            "threat_likelihood": likelihood,
            "business_impact": impact,
            "risk_score": score,
            "risk_tier": tier,
            "guidance": tier_guidance,
        },
        "nist_controls": NIST_CONTROLS.get(tier, NIST_CONTROLS["Low"]),
        "approvals_required": _approvals(tier),
        "pir_schedule_days": pir_days,
        "backout_plan": _backout(event),
    }


def _approvals(tier: str) -> list[str]:
    approvals = ["Change Requestor"]
    if tier in ("Medium", "High", "Critical"):
        approvals.append("Change Manager")
    if tier in ("High", "Critical"):
        approvals.append("Change Advisory Board (CAB)")
    if tier == "Critical":
        approvals.extend(["CISO", "CTO"])
    return approvals


def _backout(event: str) -> str:
    plans = {
        "deploy": "Delete the agent package via DELETE /copilot/admin/catalog/packages/{id}",
        "update": "Revert to previous version via POST /copilot/admin/catalog/packages/{id}/update with prior ZIP",
        "block": "Unblock via POST /copilot/admin/catalog/packages/{id}/unblock",
        "unblock": "Re-block via POST /copilot/admin/catalog/packages/{id}/block",
        "scope_change": "Revert availableTo via PATCH /copilot/admin/catalog/packages/{id}",
        "reassign": "Reassign back to original owner via POST /copilot/admin/catalog/packages/{id}/reassign",
    }
    return plans.get(event, "Manually revert via M365 Admin Center")


def main() -> None:
    event = "deploy"
    package_path = None
    output_path = Path("change.json")

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--event" and i + 1 < len(args):
            event = args[i + 1]
            i += 2
        elif args[i] == "--package" and i + 1 < len(args):
            package_path = Path(args[i + 1])
            i += 2
        elif args[i] == "--output" and i + 1 < len(args):
            output_path = Path(args[i + 1])
            i += 2
        else:
            i += 1

    if package_path and package_path.exists():
        with open(package_path, "r", encoding="utf-8") as f:
            package = json.load(f)
    else:
        package = {"displayName": "Unknown Agent", "type": "custom", "availableTo": "some"}

    result = classify(event, package)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"Change classified: {result['itil_classification']} | Risk: {result['risk_assessment']['risk_tier']} ({result['risk_assessment']['risk_score']}/25)")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
