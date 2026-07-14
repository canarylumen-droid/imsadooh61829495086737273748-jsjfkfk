const STATUS_DISPLAY_NAMES: Record<string, string> = {
  new: '',
  cold: 'Cold',
  contacted: 'Contacted',
  replied: 'Replied',
  warm: 'Warm',
  booked: 'Booked',
  converted: 'Converted',
  not_interested: 'Not Interested',
  hardened: 'Verified',
  bouncy: 'Bounced',
  risky: 'Risky',
  unsubscribed: 'Unsubscribed',
  opened: 'Opened',
};

export function getLeadStatusDisplay(status: string): string {
  return STATUS_DISPLAY_NAMES[status] || status.replace(/_/g, ' ');
}
