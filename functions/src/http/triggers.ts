/**
 * HTTP triggers for starting durable orchestrations.
 * These endpoints are called by the digital worker when 
 * stateful workflows are needed.
 */

import { app, HttpRequest, HttpResponse, InvocationContext } from '@azure/functions';
import * as df from 'durable-functions';

// Start Major Incident Bridge orchestration
app.http('startIncidentBridge', {
  methods: ['POST'],
  route: 'orchestrations/incident-bridge',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponse> => {
    const body = await request.json() as any;
    const client = df.getClient(context);
    
    const instanceId = await client.startNew('majorIncidentBridgeOrchestrator', {
      instanceId: `bridge-${body.incidentNumber}`,
      input: body,
    });
    
    return new HttpResponse({
      status: 202,
      jsonBody: { instanceId, statusQueryGetUri: `/api/orchestrations/status/${instanceId}` },
    });
  },
});

// Check orchestration status
app.http('orchestrationStatus', {
  methods: ['GET'],
  route: 'orchestrations/status/{instanceId}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponse> => {
    const instanceId = request.params.instanceId;
    const client = df.getClient(context);
    
    const status = await client.getStatus(instanceId!);
    
    return new HttpResponse({
      status: 200,
      jsonBody: status,
    });
  },
});

// Send external event (e.g., approval received)
app.http('sendEvent', {
  methods: ['POST'],
  route: 'orchestrations/{instanceId}/events/{eventName}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponse> => {
    const { instanceId, eventName } = request.params;
    const body = await request.json();
    const client = df.getClient(context);
    
    await client.raiseEvent(instanceId!, eventName!, body);
    
    return new HttpResponse({
      status: 202,
      jsonBody: { acknowledged: true },
    });
  },
});
