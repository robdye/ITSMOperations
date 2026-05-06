// ITSM Operations — Change Window Planner (Phase E)
//
// Spec: change-manager consults `enrichment.holidays.isHolidayOn` before
// proposing a change window. A national holiday in the resolver group's
// country is a hard refusal — the proposed window is rejected and the
// caller is asked to pick a different date.
//
// This is the only sanctioned consumer of `enrichmentBridge.isHolidayOn`
// from the change-manager surface area. The bridge in turn is the only
// path to the external Nager.Date API.

import { isHolidayOn, type EnrichmentEnvelope, type PublicHoliday } from './enrichment-bridge';
import type { TurnContext } from '@microsoft/agents-hosting';
import { appendEnrichment } from './case-manager';

export interface ProposedChangeWindow {
  /** YYYY-MM-DD — the day the change starts. */
  date: string;
  /** ISO 3166-1 alpha-2 country code of the resolver group. */
  country: string;
  /** Optional case id — when present, the holiday consult is appended via case-manager. */
  caseId?: string;
  /** Optional caller agent id (for audit attribution). Defaults to 'change-manager'. */
  callerAgentId?: string;
}

export interface ChangeWindowVerdict {
  ok: boolean;
  reason: string;
  /** Echoed input. */
  date: string;
  country: string;
  /** Populated when `ok === false` and a holiday matched. */
  holiday?: PublicHoliday;
  /** Provenance from the enrichment server. */
  provenance: EnrichmentEnvelope<unknown>['provenance'];
}

/**
 * Consult the holidays enrichment and approve / refuse the window.
 *
 * Approval criteria:
 *   - The date is NOT a national holiday in the resolver group's country.
 *
 * On refusal:
 *   - The verdict carries the matched holiday so the caller can surface
 *     it in the worknote (e.g. "refused — 2024-12-25 is Christmas Day in
 *     United Kingdom").
 *
 * Side effects:
 *   - When `caseId` is provided, the consult result is appended to the
 *     case via `case-manager.appendEnrichment` so the audit trail records
 *     who consulted what + the citation.
 */
export async function evaluateChangeWindow(
  args: ProposedChangeWindow,
  context?: TurnContext,
): Promise<ChangeWindowVerdict> {
  const callerAgentId = args.callerAgentId ?? 'change-manager';
  const env = await isHolidayOn(
    { country: args.country, date: args.date },
    callerAgentId,
    context,
  );

  const verdict: ChangeWindowVerdict = env.data.isHoliday
    ? {
        ok: false,
        reason: `Refused — ${args.date} is a national holiday (${env.data.holiday?.name ?? 'unknown'}) in ${args.country}.`,
        date: args.date,
        country: args.country,
        holiday: env.data.holiday,
        provenance: env.provenance,
      }
    : {
        ok: true,
        reason: `${args.date} is not a national holiday in ${args.country}; window may proceed.`,
        date: args.date,
        country: args.country,
        provenance: env.provenance,
      };

  if (args.caseId) {
    try {
      await appendEnrichment(args.caseId, {
        source: 'enrichment:nager-holidays',
        summary: verdict.reason,
        detail: {
          country: verdict.country,
          date: verdict.date,
          isHoliday: env.data.isHoliday,
          holiday: env.data.holiday,
          sourceUrl: env.provenance.sourceUrl,
          fixtureUsed: env.provenance.fixtureUsed,
        },
      });
    } catch (err) {
      console.warn(
        `[change-window-planner] Failed to append enrichment to case ${args.caseId}: ${(err as Error).message}`,
      );
    }
  }

  return verdict;
}
