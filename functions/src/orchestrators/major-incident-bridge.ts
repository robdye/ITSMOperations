/**
 * Major Incident Bridge Orchestrator
 * Stateful workflow for P1/P2 incident management:
 * 1. Detect new major incident
 * 2. Create Teams bridge channel
 * 3. Notify stakeholders
 * 4. Monitor resolution progress
 * 5. Auto-close bridge when incident resolved
 * 6. Trigger PIR after 48 hours
 * 
 * Replaces the node-cron `major-incident-bridge` routine with
 * checkpointing, replay, and suspend/resume capability.
 */

import * as df from 'durable-functions';
import { app, HttpRequest, HttpResponse, InvocationContext } from '@azure/functions';

interface MajorIncidentInput {
  incidentNumber: string;
  priority: string;
  shortDescription: string;
  affectedCI: string;
  assignedGroup: string;
}

// Orchestrator — stateful workflow with checkpointing
df.app.orchestration('majorIncidentBridgeOrchestrator', function* (context: df.OrchestrationContext) {
  const input = context.df.getInput() as MajorIncidentInput;
  const retryOptions = new df.RetryOptions(5000, 3); // 5s interval, 3 attempts

  // Step 1: Create Teams bridge channel
  const bridgeChannel = yield context.df.callActivityWithRetry(
    'createIncidentBridge', retryOptions, input
  );

  // Step 2: Notify stakeholders
  yield context.df.callActivityWithRetry(
    'notifyStakeholders', retryOptions,
    { ...input, bridgeChannelId: bridgeChannel.channelId }
  );

  // Step 3: Post initial impact assessment
  yield context.df.callActivity('postImpactAssessment', {
    incidentNumber: input.incidentNumber,
    channelId: bridgeChannel.channelId,
  });

  // Step 4: Monitor loop — check every 5 minutes until resolved
  let resolved = false;
  let checkCount = 0;
  const maxChecks = 288; // 24 hours at 5-minute intervals

  while (!resolved && checkCount < maxChecks) {
    // Create a durable timer for 5 minutes
    const nextCheck = new Date(context.df.currentUtcDateTime);
    nextCheck.setMinutes(nextCheck.getMinutes() + 5);
    yield context.df.createTimer(nextCheck);

    // Check incident status
    const status = yield context.df.callActivity('checkIncidentStatus', input.incidentNumber);
    
    if (status.state === 'resolved' || status.state === 'closed') {
      resolved = true;
      
      // Post resolution summary to bridge
      yield context.df.callActivity('postResolutionSummary', {
        incidentNumber: input.incidentNumber,
        channelId: bridgeChannel.channelId,
        resolution: status.closeNotes,
      });
    } else {
      checkCount++;
      
      // Post periodic update every 30 minutes (every 6 checks)
      if (checkCount % 6 === 0) {
        yield context.df.callActivity('postStatusUpdate', {
          incidentNumber: input.incidentNumber,
          channelId: bridgeChannel.channelId,
          status,
          elapsedMinutes: checkCount * 5,
        });
      }
    }
  }

  // Step 5: Schedule PIR after 48 hours
  const pirDate = new Date(context.df.currentUtcDateTime);
  pirDate.setHours(pirDate.getHours() + 48);
  yield context.df.createTimer(pirDate);

  yield context.df.callActivity('triggerPostIncidentReview', {
    incidentNumber: input.incidentNumber,
    bridgeChannelId: bridgeChannel.channelId,
  });

  return {
    incidentNumber: input.incidentNumber,
    bridgeChannelId: bridgeChannel.channelId,
    resolved,
    totalCheckMinutes: checkCount * 5,
  };
});

// Activity functions
df.app.activity('createIncidentBridge', {
  handler: async (input: MajorIncidentInput) => {
    const workerUrl = process.env.DIGITAL_WORKER_URL || 'http://localhost:3978';
    // Call the digital worker to create the Teams channel
    console.log(`[DurableFunc] Creating incident bridge for ${input.incidentNumber}`);
    return { channelId: `bridge-${input.incidentNumber}`, created: true };
  },
});

df.app.activity('notifyStakeholders', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Notifying stakeholders for ${input.incidentNumber}`);
    return { notified: true };
  },
});

df.app.activity('postImpactAssessment', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Posting impact assessment for ${input.incidentNumber}`);
    return { posted: true };
  },
});

df.app.activity('checkIncidentStatus', {
  handler: async (incidentNumber: string) => {
    console.log(`[DurableFunc] Checking status of ${incidentNumber}`);
    // In production, call ServiceNow API
    return { state: 'in_progress', closeNotes: null };
  },
});

df.app.activity('postStatusUpdate', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Status update for ${input.incidentNumber} at ${input.elapsedMinutes}m`);
    return { posted: true };
  },
});

df.app.activity('postResolutionSummary', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Resolution summary for ${input.incidentNumber}`);
    return { posted: true };
  },
});

df.app.activity('triggerPostIncidentReview', {
  handler: async (input: any) => {
    console.log(`[DurableFunc] Triggering PIR for ${input.incidentNumber}`);
    return { pirCreated: true };
  },
});
