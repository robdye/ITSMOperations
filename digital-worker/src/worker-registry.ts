// ITSM Operations — Worker Registry & Intent Router
// Classifies user messages to the appropriate ITIL 4 child worker.
// Uses keyword/pattern matching initially; can upgrade to LLM classification later.

import { WorkerDefinition } from './agent-harness';
import {
  incidentManager,
  changeManager,
  problemManager,
  assetCmdbManager,
  slaManager,
  knowledgeManager,
  vendorManager,
  serviceDeskManager,
  monitoringManager,
  releaseManager,
  capacityManager,
  continuityManager,
  securityManager,
  commandCenter,
} from './worker-definitions';

// ── Intent Classification ──

interface ClassificationResult {
  worker: WorkerDefinition;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// Keyword patterns for each practice domain
const PATTERNS: Array<{
  worker: WorkerDefinition;
  keywords: RegExp[];
  negativeKeywords?: RegExp[];
}> = [
  {
    worker: incidentManager,
    keywords: [
      /\bincident/i,
      /\bp[12]\b/i,
      /\bp1\b/i,
      /\bp2\b/i,
      /\bINC\d+/i,
      /\boutage/i,
      /\bdown\b/i,
      /\bescalat/i,
      /\btriage\b/i,
      /\bsev(erity)?\s*[12]/i,
      /\bmajor incident/i,
      /\bincident bridge/i,
      /\bwar room/i,
    ],
  },
  {
    worker: changeManager,
    keywords: [
      /\bchange\b/i,
      /\bCHG\d+/i,
      /\bRFC\b/i,
      /\bCAB\b/i,
      /\bblast radius/i,
      /\bcollision/i,
      /\bPIR\b/i,
      /\bpost.implementation/i,
      /\bmaintenance window/i,
      /\bbackout/i,
      /\brollback/i,
      /\bchange.*risk/i,
      /\bchange.*dashboard/i,
      /\bchange.*metric/i,
      /\bchange.*agenda/i,
    ],
  },
  {
    worker: problemManager,
    keywords: [
      /\bproblem\b/i,
      /\bknown error/i,
      /\broot cause/i,
      /\bRCA\b/i,
      /\bworkaround/i,
      /\bKEDB\b/i,
      /\brecurring/i,
      /\bpattern/i,
    ],
    negativeKeywords: [
      /\bproblem.*change/i,  // "problem with the change" → change domain
    ],
  },
  {
    worker: assetCmdbManager,
    keywords: [
      /\basset/i,
      /\bCMDB\b/i,
      /\bconfiguration item/i,
      /\bCI\b/i,
      /\bwarranty/i,
      /\bEOL\b/i,
      /\bend.of.life/i,
      /\bend.of.support/i,
      /\blifecycle/i,
      /\binventory/i,
      /\bdependenc/i,
      /\brelationship/i,
      /\bupstream/i,
      /\bdownstream/i,
    ],
  },
  {
    worker: slaManager,
    keywords: [
      /\bSLA\b/i,
      /\bbreach/i,
      /\bcompliance\s+rate/i,
      /\bservice level/i,
      /\bOLA\b/i,
      /\bresponse time/i,
      /\bresolution time/i,
    ],
  },
  {
    worker: knowledgeManager,
    keywords: [
      /\bknowledge\s*(base|article)/i,
      /\brunbook/i,
      /\bKB\b/i,
      /\bself.service/i,
      /\bdeflection/i,
      /\barticle/i,
      /\bprocedure/i,
      /\bdocumentation/i,
    ],
  },
  {
    worker: vendorManager,
    keywords: [
      /\bvendor/i,
      /\blicen[sc]/i,
      /\bcontract/i,
      /\bsupplier/i,
      /\brenewal/i,
      /\bsoftware.*compliance/i,
      /\bover.deployed/i,
      /\bunder.utiliz/i,
    ],
  },
  {
    worker: serviceDeskManager,
    keywords: [
      /\bservice desk/i,
      /\bcatalog/i,
      /\bservice request/i,
      /\bself.service/i,
      /\buser request/i,
      /\bticket/i,
      /\bhelp desk/i,
    ],
  },
  {
    worker: monitoringManager,
    keywords: [
      /\bmonitor/i,
      /\balert/i,
      /\bevent/i,
      /\bthreshold/i,
      /\bavailability/i,
      /\buptime/i,
      /\bhealth check/i,
    ],
  },
  {
    worker: releaseManager,
    keywords: [
      /\brelease/i,
      /\bdeploy/i,
      /\brollout/i,
      /\bgo.live/i,
      /\blaunch/i,
      /\bversion/i,
    ],
  },
  {
    worker: capacityManager,
    keywords: [
      /\bcapacity/i,
      /\bperformance/i,
      /\butilization/i,
      /\bthroughput/i,
      /\bscaling/i,
      /\bdemand/i,
    ],
  },
  {
    worker: continuityManager,
    keywords: [
      /\bcontinuity/i,
      /\bdisaster/i,
      /\brecovery/i,
      /\bBCP/i,
      /\bDR\b/i,
      /\bfailover/i,
      /\bRTO/i,
      /\bRPO/i,
      /\bbackup/i,
    ],
  },
  {
    worker: securityManager,
    keywords: [
      /\bsecurity/i,
      /\bvulnerabilit/i,
      /\bCVE/i,
      /\baccess review/i,
      /\bISO.27001/i,
      /\bthreat/i,
      /\bSIEM/i,
      /\bphishing/i,
    ],
  },
];

/**
 * Classify a user message to determine which ITIL 4 worker should handle it.
 * Returns the best-matching worker or the Command Center for cross-practice requests.
 */
export function classifyIntent(message: string): ClassificationResult {
  const lower = message.toLowerCase();

  // Score each worker
  const scores = PATTERNS.map(({ worker, keywords, negativeKeywords }) => {
    let score = 0;
    const matchedKeywords: string[] = [];

    for (const pattern of keywords) {
      if (pattern.test(message)) {
        score++;
        matchedKeywords.push(pattern.source);
      }
    }

    // Reduce score for negative keyword matches
    if (negativeKeywords) {
      for (const pattern of negativeKeywords) {
        if (pattern.test(message)) score -= 0.5;
      }
    }

    return { worker, score, matchedKeywords };
  });

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0];
  const secondBest = scores[1];

  // No matches → Command Center
  if (best.score === 0) {
    // Check for general briefing/status patterns
    if (/briefing|status|what.*happening|overview|summary|dashboard/i.test(lower)) {
      return {
        worker: commandCenter,
        confidence: 'medium',
        reason: 'General ITSM overview request → Command Center',
      };
    }
    return {
      worker: commandCenter,
      confidence: 'low',
      reason: 'No practice-specific keywords detected → Command Center',
    };
  }

  // Multiple strong matches → cross-practice → Command Center
  if (secondBest && secondBest.score > 0 && best.score - secondBest.score <= 1) {
    return {
      worker: commandCenter,
      confidence: 'medium',
      reason: `Cross-practice request: ${best.worker.id} (${best.score}) + ${secondBest.worker.id} (${secondBest.score}) → Command Center`,
    };
  }

  // Clear winner
  const confidence = best.score >= 3 ? 'high' : best.score >= 2 ? 'medium' : 'low';
  return {
    worker: best.worker,
    confidence,
    reason: `Matched ${best.worker.itilPractice}: ${best.matchedKeywords.join(', ')}`,
  };
}

/**
 * Get a worker by ID.
 */
export function getWorkerById(id: string): WorkerDefinition | undefined {
  return PATTERNS.find(p => p.worker.id === id)?.worker ?? (id === 'command-center' ? commandCenter : undefined);
}
