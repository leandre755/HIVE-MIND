import { eventInboxService } from '../../../services/events/EventInboxService.js';

interface EventManagerContext {
  [key: string]: unknown;
}

export default {
  name: 'event_manager',
  description: 'Tools for the agent to manage its internal asynchronous events.',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'read_event_inbox',
        description: 'Reads all pending asynchronous events (emails, webhooks, system alerts).',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'clear_event_inbox',
        description:
          'Clears the event inbox. Call this AFTER processing the events to avoid being notified again.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
  ],

  async execute(_args: unknown, _context: EventManagerContext, toolName?: string) {
    if (toolName === 'read_event_inbox') {
      const events = await eventInboxService.getUnreadEvents(20);
      if (events.length === 0) return { success: true, message: 'Inbox is empty.' };
      return { success: true, message: `Inbox content:\n\n${JSON.stringify(events, null, 2)}` };
    }

    if (toolName === 'clear_event_inbox') {
      const count = await eventInboxService.clearInbox();
      return { success: true, message: `Inbox cleared (${count} events deleted).` };
    }
    return { success: false, message: 'Unknown tool' };
  },
};
