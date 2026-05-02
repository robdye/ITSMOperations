// Pure-function intent detection. Lives in its own module so it is
// trivially unit-testable and so agent.ts stays small. Each helper returns
// a boolean — agent.ts uses these to inject mandatory tool-execution rules
// into the system prompt.

/** "email me / send me a report by mail" — triggers send_email rules. */
export function asksEmailSelf(text: string): boolean {
  return (
    /\b(email|send)\b[\s\S]{0,120}\b(me|myself|my mail|my email)\b/i.test(text) ||
    /\bemail me\b/i.test(text)
  );
}

/** Generic email-content request that should still trigger send_email. */
export function asksEmailRequest(text: string): boolean {
  return (
    /\b(email|mail)\b/i.test(text) &&
    /\b(send|latest|overview|incident|report|brief)\b/i.test(text)
  );
}

/** PowerPoint / deck / slides — triggers send_presentation. */
export function asksPresentation(text: string): boolean {
  return /\b(power\s*point|powerpoint|pptx?|presentation|deck|slide\s*deck|slides)\b/i.test(text);
}

/**
 * Schedule a meeting / book a CAB / set up a bridge — triggers
 * schedule_teams_meeting (or find_meeting_time first when time is fuzzy).
 *
 * Note: this matches "schedule a call" / "book a call" — those are meetings.
 * The narrower "call me" / "ring me" intent is asksTeamsCall().
 */
export function asksMeeting(text: string): boolean {
  return (
    /\b(schedule|set\s*up|book|arrange|create|send)\b[\s\S]{0,40}\b(meeting|call|bridge|sync|catch[-\s]?up|stand[-\s]?up|cab|review|invite|calendar\s*invite)\b/i.test(
      text,
    ) ||
    /\b(invite|invite\s*me|book\s*a\s*time)\b[\s\S]{0,40}\b(call|meeting|bridge)\b/i.test(text)
  );
}

/**
 * "Call me on Teams" / "ring me" / "page me" — triggers call_me_on_teams.
 * Excludes scheduling-style language ("schedule a call", "book a call"),
 * which is handled by asksMeeting().
 */
export function asksTeamsCall(text: string): boolean {
  if (asksMeeting(text)) return false;
  return (
    /\b(call|ring|phone|dial)\s+(me|us)\b/i.test(text) ||
    /\b(can|could|would|please)\s+you\s+(call|ring|phone|dial)\s+(me|us)\b/i.test(text) ||
    /\bpage\s+me\b/i.test(text) ||
    /\b(start|begin|initiate)\s+(a\s+)?(teams\s+)?call\b/i.test(text)
  );
}
