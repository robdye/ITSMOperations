/**
 * CAB Voting Cycle Orchestrator
 * Stateful workflow for Change Advisory Board meetings:
 * 1. Gather changes requiring CAB review
 * 2. Generate review packs
 * 3. Send Adaptive Cards for voting
 * 4. Wait for votes (with timeout)
 * 5. Tally results and authorize/reject changes
 * 6. Notify requestors
 */

import * as df from 'durable-functions';

interface CabInput {
  meetingDate: string;
  changes: Array<{ number: string; description: string; risk: string }>;
}

df.app.orchestration('cabVotingCycleOrchestrator', function* (context: df.OrchestrationContext) {
  const input = context.df.getInput() as CabInput;
  const retryOptions = new df.RetryOptions(5000, 3);

  // Step 1: Generate review packs for all changes
  const reviewPacks = yield context.df.callActivity('generateReviewPacks', input.changes);

  // Step 2: Send voting cards to CAB members
  yield context.df.callActivityWithRetry(
    'sendVotingCards', retryOptions,
    { changes: input.changes, reviewPacks }
  );

  // Step 3: Wait for votes with 24-hour timeout
  const votingDeadline = new Date(context.df.currentUtcDateTime);
  votingDeadline.setHours(votingDeadline.getHours() + 24);
  
  // External event: wait for all votes or timeout
  const votingComplete = context.df.waitForExternalEvent('allVotesReceived');
  const timeout = context.df.createTimer(votingDeadline);
  
  const winner = yield context.df.Task.any([votingComplete, timeout]);
  
  // Step 4: Tally results
  const results = yield context.df.callActivity('tallyVotes', {
    changes: input.changes,
    timedOut: winner === timeout,
  });

  // Step 5: Update change records with authorization decisions
  yield context.df.callActivity('updateChangeAuthorizations', results);

  // Step 6: Notify requestors
  yield context.df.callActivity('notifyRequestors', results);

  return results;
});

// Activity functions
df.app.activity('generateReviewPacks', {
  handler: async (changes: any[]) => {
    console.log(`[DurableFunc] Generating review packs for ${changes.length} changes`);
    return changes.map(c => ({ number: c.number, pack: 'generated' }));
  },
});

df.app.activity('sendVotingCards', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Sending voting cards for ${input.changes.length} changes`);
    return { sent: true };
  },
});

df.app.activity('tallyVotes', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Tallying votes (timedOut: ${input.timedOut})`);
    return { tallied: true, approved: [], rejected: [], deferred: [] };
  },
});

df.app.activity('updateChangeAuthorizations', {
  handler: async (results: any) => {
    console.log('[DurableFunc] Updating change authorizations');
    return { updated: true };
  },
});

df.app.activity('notifyRequestors', {
  handler: async (results: any) => {
    console.log('[DurableFunc] Notifying requestors');
    return { notified: true };
  },
});
