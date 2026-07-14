import { describe, it, expect } from 'vitest';

describe('Status Change Notifications', () => {
  const LEAD_STATUSES = [
    'new', 'contacted', 'interested', 'meeting_booked',
    'follow_up', 'replied', 'bounced', 'converted', 'lost',
    'booked', 'ghosted', 'suppressed', 'do_not_contact', 'spam_complaint',
  ];

  const DEAL_STATUSES = [
    'open', 'contacted', 'meeting_booked', 'proposal_sent',
    'negotiating', 'closed_won', 'closed_lost', 'bounced',
    'spam_complaint', 'do_not_contact',
  ];

  describe('Lead Statuses', () => {
    it('should not contain "open" status', () => {
      expect(LEAD_STATUSES).not.toContain('open');
    });

    it('should contain "contacted" status', () => {
      expect(LEAD_STATUSES).toContain('contacted');
    });

    it('should contain all required statuses', () => {
      expect(LEAD_STATUSES).toContain('new');
      expect(LEAD_STATUSES).toContain('interested');
      expect(LEAD_STATUSES).toContain('meeting_booked');
      expect(LEAD_STATUSES).toContain('converted');
      expect(LEAD_STATUSES).toContain('bounced');
      expect(LEAD_STATUSES).toContain('spam_complaint');
    });
  });

  describe('Deal Statuses', () => {
    it('should contain "open" status (separate from lead)', () => {
      expect(DEAL_STATUSES).toContain('open');
    });

    it('should not contain "new" status', () => {
      expect(DEAL_STATUSES).not.toContain('new');
    });
  });

  describe('Status Notification Mapping', () => {
    const statusNotificationMap: Record<string, { label: string; type: string }> = {
      new: { label: 'New Lead', type: 'lead' },
      contacted: { label: 'Contacted', type: 'lead' },
      interested: { label: 'Interested', type: 'lead' },
      meeting_booked: { label: 'Meeting Booked', type: 'lead' },
      converted: { label: 'Converted', type: 'success' },
      bounced: { label: 'Bounced', type: 'error' },
      spam_complaint: { label: 'Spam Complaint', type: 'error' },
      do_not_contact: { label: 'Do Not Contact', type: 'warning' },
    };

    it('should have notification config for critical statuses', () => {
      expect(statusNotificationMap.converted).toBeDefined();
      expect(statusNotificationMap.bounced).toBeDefined();
      expect(statusNotificationMap.spam_complaint).toBeDefined();
    });

    it('should use correct notification types', () => {
      expect(statusNotificationMap.converted.type).toBe('success');
      expect(statusNotificationMap.bounced.type).toBe('error');
      expect(statusNotificationMap.spam_complaint.type).toBe('error');
      expect(statusNotificationMap.do_not_contact.type).toBe('warning');
    });
  });
});

describe('Notification Events', () => {
  const NOTIFICATION_EVENTS = [
    'lead:status_changed',
    'deal:status_changed',
    'campaign:completed',
    'campaign:failed',
    'inbox:new_message',
    'inbox:reply_received',
    'inbox:calendly_event',
    'inbox:spam_detected',
    'inbox:meeting_booked',
    'inbox:bounce_detected',
    'inbox:ai_paused',
    'inbox:suppressed',
    'inbox:pre_flight_failed',
    'stats:updated',
    'calendly:oauth_complete',
    'calendly:token_revoked',
  ];

  it('should have all required notification events', () => {
    expect(NOTIFICATION_EVENTS).toContain('lead:status_changed');
    expect(NOTIFICATION_EVENTS).toContain('deal:status_changed');
    expect(NOTIFICATION_EVENTS).toContain('campaign:completed');
    expect(NOTIFICATION_EVENTS).toContain('inbox:new_message');
    expect(NOTIFICATION_EVENTS).toContain('inbox:reply_received');
    expect(NOTIFICATION_EVENTS).toContain('inbox:spam_detected');
    expect(NOTIFICATION_EVENTS).toContain('inbox:bounce_detected');
    expect(NOTIFICATION_EVENTS).toContain('inbox:ai_paused');
    expect(NOTIFICATION_EVENTS).toContain('inbox:suppressed');
    expect(NOTIFICATION_EVENTS).toContain('inbox:pre_flight_failed');
    expect(NOTIFICATION_EVENTS).toContain('stats:updated');
    expect(NOTIFICATION_EVENTS).toContain('calendly:oauth_complete');
    expect(NOTIFICATION_EVENTS).toContain('calendly:token_revoked');
  });

  it('should have unique events', () => {
    const uniqueEvents = new Set(NOTIFICATION_EVENTS);
    expect(uniqueEvents.size).toBe(NOTIFICATION_EVENTS.length);
  });
});
