// Unit tests for src/intent-detection.ts
//
// These pure regex helpers are how agent.ts decides whether to inject
// "MANDATORY EXECUTION RULES" into the system prompt for a given turn.
// Wrong intent → wrong tool → broken UX. So we lock the matrix down here.

import { describe, it, expect } from 'vitest';
import {
  asksEmailSelf,
  asksEmailRequest,
  asksPresentation,
  asksMeeting,
  asksTeamsCall,
} from '../intent-detection';

describe('asksEmailSelf', () => {
  it.each([
    'email me the latest report',
    'send me the briefing on email',
    'EMAIL ME the change list',
    'send the SLA breakdown to my email',
  ])('matches: %s', (s) => expect(asksEmailSelf(s)).toBe(true));

  it.each([
    'send the report to admin@contoso.com',
    'find Sarah in the directory',
    'mail me the SLA breakdown', // "mail me" without "email"/"send" is not enough
  ])('does not match: %s', (s) => expect(asksEmailSelf(s)).toBe(false));
});

describe('asksEmailRequest', () => {
  it('matches "send me the latest incident report by email"', () => {
    expect(asksEmailRequest('send me the latest incident report by email')).toBe(true);
  });
  it('matches "email the brief to me"', () => {
    expect(asksEmailRequest('email the brief to me')).toBe(true);
  });
  it('does not match a generic "open my mail" comment', () => {
    expect(asksEmailRequest('open my mail tomorrow')).toBe(false);
  });
});

describe('asksPresentation', () => {
  it.each([
    'create a powerpoint for the CAB',
    'build me a deck on Q2 incidents',
    'send me the slides',
    'I need a slide deck for tomorrow',
    'make a pptx of open changes',
  ])('matches: %s', (s) => expect(asksPresentation(s)).toBe(true));

  it.each([
    'show me the dashboard',
    'send me an email',
  ])('does not match: %s', (s) => expect(asksPresentation(s)).toBe(false));
});

describe('asksMeeting', () => {
  it.each([
    'schedule a CAB review for Monday afternoon',
    'book the CAB for Monday',
    'set up an incident bridge with Sarah',
    'create a Teams meeting for the post-mortem',
    'arrange a sync with the change advisory board',
    'send a calendar invite for tomorrow',
    'invite me to a call with Cecil',
    'book a time with the on-call team',
  ])('matches: %s', (s) => expect(asksMeeting(s)).toBe(true));

  it.each([
    'show me the change calendar',
    'how many meetings are scheduled today',
    'tell me about the CAB',
  ])('does not match: %s', (s) => expect(asksMeeting(s)).toBe(false));
});

describe('asksTeamsCall', () => {
  it.each([
    'can you call me on Teams',
    'call me',
    'ring me on Teams please',
    'phone me when the bridge is ready',
    'page me',
    'could you dial me',
    'start a Teams call',
    'initiate a call',
  ])('matches: %s', (s) => expect(asksTeamsCall(s)).toBe(true));

  // The killer ambiguity: "schedule a call" / "book a call" must NOT match —
  // those are meetings, not "ring me right now".
  it.each([
    'schedule a call with Sarah',
    'book a call for 2pm',
    'set up a call tomorrow',
    'arrange a call with the team',
  ])('defers to asksMeeting: %s', (s) => {
    expect(asksMeeting(s)).toBe(true);
    expect(asksTeamsCall(s)).toBe(false);
  });

  it.each([
    'show me incident counts',
    'what is the CAB calendar',
    'send me an email',
  ])('does not match: %s', (s) => expect(asksTeamsCall(s)).toBe(false));
});

describe('intent matrix exclusivity', () => {
  // For each test phrase, exactly one of meeting/call should fire (never both).
  it.each([
    ['schedule a CAB for Monday', { meeting: true, call: false }],
    ['call me on Teams', { meeting: false, call: true }],
    ['book a call with Sarah', { meeting: true, call: false }],
    ['ring me when ready', { meeting: false, call: true }],
  ] as const)('"%s" → meeting=%o', (phrase, expected) => {
    expect(asksMeeting(phrase)).toBe(expected.meeting);
    expect(asksTeamsCall(phrase)).toBe(expected.call);
    // Never both.
    expect(asksMeeting(phrase) && asksTeamsCall(phrase)).toBe(false);
  });
});
