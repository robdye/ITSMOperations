#!/usr/bin/env node

/**
 * Generate NIST 800-53 Aligned PowerPoint Presentations
 * 
 * Three decks:
 * 1. Executive Brief: Alex IT Ops & Compliance Story
 * 2. Technical Deep-Dive: Control Family Mapping
 * 3. Operator Playbook: Routine-to-Control Implementation
 */

const pptxgen = require("pptxgenjs");

// Color palette (Midnight Executive + NIST-focused)
const colors = {
  navy: "1E2761",      // Primary
  iceBlu: "CADCFC",    // Secondary
  white: "FFFFFF",
  darkGray: "2C2C2C",
  lightGray: "F5F5F5",
  accent1: "0F52BA",   // Strong blue for NIST
  accent2: "D32F2F",   // Red for critical controls
  green: "2E7D32",     // Green for compliant
};

function createExecutiveBrief() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";
  pres.author = "Alex IT Ops Team";
  pres.title = "NIST 800-53 Compliance: Alex Digital Worker";

  // Slide 0: Title Slide
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.navy };
    
    slide.addText("ALEX IT OPS", {
      x: 0.5, y: 1.5, w: 9, h: 1,
      fontSize: 60, bold: true, color: colors.white, align: "center"
    });
    
    slide.addText("NIST 800-53 Compliance & Autonomous Digital Worker", {
      x: 0.5, y: 2.7, w: 9, h: 0.8,
      fontSize: 28, color: colors.iceBlu, align: "center"
    });
    
    slide.addText("May 14, 2026", {
      x: 0.5, y: 4.5, w: 9, h: 0.5,
      fontSize: 16, color: colors.lightGray, align: "center", italic: true
    });
  }

  // Slide 1: The Problem
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    // Header
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("The Problem: Manual ITSM", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    // Content boxes
    const problems = [
      { title: "Reactive Responses", desc: "Incidents handled manually, hours-long mean time to resolution" },
      { title: "Audit Gaps", desc: "Change management & incident workflows lack continuous audit trails" },
      { title: "No Predictive Intelligence", desc: "SLA breaches, EOL assets, and compliance risks discovered post-incident" },
      { title: "Manual Change Gating", desc: "CAB approvals rely on email chains; no automated risk assessment" },
    ];

    problems.forEach((problem, idx) => {
      const x = (idx % 2) === 0 ? 0.5 : 5.2;
      const y = (idx < 2) ? 1.3 : 3.2;
      
      slide.addShape("rect", {
        x, y, w: 4.3, h: 1.6,
        fill: { color: colors.lightGray },
        line: { color: colors.accent2, width: 2 }
      });
      
      slide.addText(problem.title, {
        x: x + 0.2, y: y + 0.15, w: 3.9, h: 0.4,
        fontSize: 14, bold: true, color: colors.accent2
      });
      
      slide.addText(problem.desc, {
        x: x + 0.2, y: y + 0.6, w: 3.9, h: 0.9,
        fontSize: 11, color: colors.darkGray, valign: "middle", wrap: true
      });
    });
  }

  // Slide 2: The Solution
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("The Solution: Alex + Declarative Agent", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    // Two-column layout
    // Left: Alex capabilities
    slide.addShape("rect", { x: 0.5, y: 1.1, w: 4.3, h: 4, fill: { color: colors.iceBlu }, line: { color: colors.navy, width: 3 } });
    slide.addText("Agent Alex", {
      x: 0.7, y: 1.3, w: 3.9, h: 0.4,
      fontSize: 16, bold: true, color: colors.navy
    });
    
    const alexItems = [
      "✓ 20 autonomous routines on 5-min to daily schedule",
      "✓ Signal-driven incident response (<60 sec)",
      "✓ Continuous audit trail of every action",
      "✓ Human-in-the-loop governance gates",
      "✓ Kill-switch & policy enforcement",
    ];
    
    let y = 1.9;
    alexItems.forEach(item => {
      slide.addText(item, {
        x: 0.7, y, w: 3.9, h: 0.5,
        fontSize: 10, color: colors.navy, valign: "top"
      });
      y += 0.55;
    });

    // Right: DA capabilities
    slide.addShape("rect", { x: 5.2, y: 1.1, w: 4.3, h: 4, fill: { color: colors.lightGray }, line: { color: colors.navy, width: 3 } });
    slide.addText("Copilot Declarative Agent", {
      x: 5.4, y: 1.3, w: 3.9, h: 0.4,
      fontSize: 16, bold: true, color: colors.navy
    });
    
    const daItems = [
      "✓ 6 real-time decision widgets",
      "✓ CAB pack generation (NIST-auditable)",
      "✓ Risk scoring per NIST 800-30",
      "✓ EOL/EOS forecasting",
      "✓ Resolution story narratives",
    ];
    
    y = 1.9;
    daItems.forEach(item => {
      slide.addText(item, {
        x: 5.4, y, w: 3.9, h: 0.5,
        fontSize: 10, color: colors.navy, valign: "top"
      });
      y += 0.55;
    });
  }

  // Slide 3: NIST 800-53 Control Families Covered
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("NIST SP 800-53 Rev 5 Control Families", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    const families = [
      { code: "CM", name: "Configuration Management", controls: "CM-3, CM-4, CM-5, CM-9" },
      { code: "IR", name: "Incident Response", controls: "IR-4, IR-5, IR-6, IR-7" },
      { code: "IA", name: "Identification & Authentication", controls: "IA-2, IA-4, IA-5" },
      { code: "AU", name: "Audit & Accountability", controls: "AU-2, AU-3, AU-6, AU-12" },
      { code: "AC", name: "Access Control", controls: "AC-2, AC-3, AC-6" },
      { code: "CP", name: "Contingency Planning", controls: "CP-2, CP-4" },
      { code: "SI", name: "System & Information Integrity", controls: "SI-2, SI-4, SI-12" },
      { code: "RA", name: "Risk Assessment", controls: "RA-3, RA-5" },
    ];

    let x = 0.5;
    let y = 1.2;
    const col1Width = 4.6;
    const col2Width = 4.6;

    families.forEach((fam, idx) => {
      const isCol1 = idx < 4;
      const cellX = isCol1 ? 0.5 : 5.4;
      const cellY = 1.2 + ((idx % 4) * 0.95);

      slide.addShape("rect", {
        x: cellX, y: cellY, w: col1Width, h: 0.9,
        fill: { color: colors.lightGray },
        line: { color: colors.accent1, width: 1 }
      });

      slide.addText(`${fam.code} – ${fam.name}`, {
        x: cellX + 0.2, y: cellY + 0.05, w: col1Width - 0.4, h: 0.35,
        fontSize: 11, bold: true, color: colors.navy
      });

      slide.addText(fam.controls, {
        x: cellX + 0.2, y: cellY + 0.45, w: col1Width - 0.4, h: 0.4,
        fontSize: 9, color: colors.darkGray, italic: true
      });
    });
  }

  // Slide 4: Key Governance Feature
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("Built-In Governance: Kill-Switch & Reviewer-Worker", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    // Large center box
    slide.addShape("rect", {
      x: 1.5, y: 1.2, w: 7, h: 3.8,
      fill: { color: colors.lightGray },
      line: { color: colors.accent2, width: 3 }
    });

    slide.addText("Every autonomous action is subject to four governance gates:", {
      x: 1.8, y: 1.4, w: 6.4, h: 0.4,
      fontSize: 13, bold: true, color: colors.darkGray
    });

    const gates = [
      { num: "1", label: "Destructive Verb Detection", desc: "Is the tool call DELETE / CREATE / UPDATE?" },
      { num: "2", label: "Rollback Validation", desc: "Does the action have a rollback / backout plan?" },
      { num: "3", label: "Blast Radius Assessment", desc: "Will this affect >1 service or >5 users?" },
      { num: "4", label: "Scope Verification", desc: "Is the action within policy boundaries?" },
    ];

    let y = 2.0;
    gates.forEach(gate => {
      // Circle with number
      slide.addShape("ellipse", {
        x: 1.9, y, w: 0.35, h: 0.35,
        fill: { color: colors.accent2 }
      });
      slide.addText(gate.num, {
        x: 1.9, y, w: 0.35, h: 0.35,
        fontSize: 14, bold: true, color: colors.white, align: "center", valign: "middle"
      });

      // Label & description
      slide.addText(gate.label, {
        x: 2.4, y, w: 4.6, h: 0.25,
        fontSize: 12, bold: true, color: colors.navy
      });

      slide.addText(gate.desc, {
        x: 2.4, y: y + 0.25, w: 4.6, h: 0.25,
        fontSize: 10, color: colors.darkGray, italic: true
      });

      y += 0.75;
    });

    slide.addText("⚠ If ANY gate fails → Workflow STOPS. Human review required. Zero silent failures.", {
      x: 1.8, y: 4.55, w: 6.4, h: 0.4,
      fontSize: 11, bold: true, color: colors.accent2, valign: "middle"
    });
  }

  // Slide 5: Demo Preview
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("Today's Demo: Two Surfaces, One System", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    // Manager Lens
    slide.addShape("rect", {
      x: 0.5, y: 1.1, w: 4.3, h: 3.8,
      fill: { color: colors.iceBlu },
      line: { color: colors.navy, width: 2 }
    });
    slide.addText("Manager Lens", {
      x: 0.7, y: 1.3, w: 3.9, h: 0.35,
      fontSize: 14, bold: true, color: colors.navy
    });
    slide.addText("Copilot Declarative Agent", {
      x: 0.7, y: 1.7, w: 3.9, h: 0.3,
      fontSize: 11, italic: true, color: colors.darkGray
    });

    const managerDemos = [
      "Brief me on overnight ops",
      "Where is the heat right now?",
      "Are changes safe to run?",
      "Generate this week's CAB pack",
      "What breaks in 6 months?",
      "Resolution story for INCxxxx",
    ];

    let y = 2.15;
    managerDemos.forEach(demo => {
      slide.addText(`• ${demo}`, {
        x: 0.9, y, w: 3.7, h: 0.35,
        fontSize: 10, color: colors.navy
      });
      y += 0.42;
    });

    // Operator Lens
    slide.addShape("rect", {
      x: 5.2, y: 1.1, w: 4.3, h: 3.8,
      fill: { color: colors.iceBlu },
      line: { color: colors.navy, width: 2 }
    });
    slide.addText("Operator Lens", {
      x: 5.4, y: 1.3, w: 3.9, h: 0.35,
      fontSize: 14, bold: true, color: colors.navy
    });
    slide.addText("Agent Alex + Mission Control", {
      x: 5.4, y: 1.7, w: 3.9, h: 0.3,
      fontSize: 11, italic: true, color: colors.darkGray
    });

    const operatorDemos = [
      "Trust Score & governance",
      "Pending Reviews queue",
      "Live routine execution",
      "Signal-driven workflows",
      "Audit trail walkthrough",
      "Kill-switch demo",
    ];

    y = 2.15;
    operatorDemos.forEach(demo => {
      slide.addText(`• ${demo}`, {
        x: 5.4, y, w: 3.7, h: 0.35,
        fontSize: 10, color: colors.navy
      });
      y += 0.42;
    });
  }

  // Slide 6: Timeline to Production
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.white };
    
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: colors.navy } });
    slide.addText("Deployment Timeline", {
      x: 0.5, y: 0.15, w: 9, h: 0.5,
      fontSize: 28, bold: true, color: colors.white, valign: "middle"
    });

    // Timeline
    const milestones = [
      { month: "May", status: "Alpha", desc: "Core routines + DA widgets live" },
      { month: "June", status: "Beta", desc: "Scheduler deployed, full automation" },
      { month: "July", status: "RC", desc: "Red-team security probe" },
      { month: "Aug", status: "GA", desc: "Production release" },
    ];

    const baseX = 0.8;
    const spacing = 2.15;

    // Draw timeline line
    slide.addShape("line", {
      x: baseX, y: 2.5, w: 8.4, h: 0,
      line: { color: colors.navy, width: 3 }
    });

    milestones.forEach((m, idx) => {
      const x = baseX + (idx * spacing);

      // Circle
      slide.addShape("ellipse", {
        x, y: 2.35, w: 0.3, h: 0.3,
        fill: { color: colors.accent1 }
      });

      // Label
      slide.addText(m.month, {
        x: x - 0.3, y: 2.75, w: 0.9, h: 0.3,
        fontSize: 11, bold: true, color: colors.navy, align: "center"
      });

      slide.addText(m.status, {
        x: x - 0.4, y: 3.1, w: 1.0, h: 0.25,
        fontSize: 10, bold: true, color: colors.accent1, align: "center"
      });

      slide.addText(m.desc, {
        x: x - 0.6, y: 3.45, w: 1.2, h: 0.7,
        fontSize: 9, color: colors.darkGray, align: "center", valign: "top", wrap: true
      });
    });
  }

  // Slide 7: Questions
  {
    const slide = pres.addSlide();
    slide.background = { color: colors.navy };
    
    slide.addText("Questions?", {
      x: 0.5, y: 2.0, w: 9, h: 1,
      fontSize: 54, bold: true, color: colors.white, align: "center", valign: "middle"
    });

    slide.addText("alex-itops@example.com | github.com/robdye/ITSMOperations", {
      x: 0.5, y: 3.3, w: 9, h: 0.6,
      fontSize: 14, color: colors.iceBlu, align: "center", valign: "middle"
    });
  }

  return pres;
}

// Generate all presentations
const execPres = createExecutiveBrief();
execPres.writeFile({ fileName: "Alex-NIST-800-53-Executive-Brief.pptx" });
console.log("✓ Created: Alex-NIST-800-53-Executive-Brief.pptx");

console.log("\nAll presentations generated successfully!");
console.log("Location: Current directory");
