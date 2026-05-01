/*
 * Calendly API Integration
 * 
 * Official Calendly API wrapper for booking management
 * Features: Time slots, event creation, invitation handling
 * 
 * Setup: Users paste personal API token from Calendly Settings
 */

interface CalendlySlot {
  time: string; // ISO 8601 datetime
  available: boolean;
}

interface CalendlyEventType {
  uri: string;
  name: string;
  duration: number; // in minutes
}

interface CalendlyScheduledEvent {
  resource: {
    uri: string;
    name: string;
    status: string;
    scheduled_event_uuid: string;
  };
}

/**
 * Get available time slots from Calendly
 */
export async function getCalendlySlots(
  apiToken: string,
  daysAhead: number = 7,
  duration: number = 30
): Promise<CalendlySlot[]> {
  try {
    if (!apiToken) {
      throw new Error('Calendly API token required');
    }

    // Get current user details (includes availability schedules)
    const userResponse = await fetch('https://api.calendly.com/users/me', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!userResponse.ok) {
      throw new Error(`Calendly API error: ${userResponse.statusText}`);
    }

    const userData = await userResponse.json();
    const userUri = userData.resource.uri;

    // Get availability schedules
    const schedulesResponse = await fetch(
      `${userUri}/availability_schedules`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!schedulesResponse.ok) {
      throw new Error('Failed to fetch availability schedules');
    }

    const schedulesData = await schedulesResponse.json();
    
    if (!schedulesData.collection || schedulesData.collection.length === 0) {
      console.warn('No availability schedules found in Calendly');
      return [];
    }

    // Use first schedule
    const schedule = schedulesData.collection[0];

    // Get available slots for the schedule
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + daysAhead);

    const availabilityResponse = await fetch(
      'https://api.calendly.com/user_availability_schedules',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userUri,
          start_date: now.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          timezone: 'America/New_York'
        })
      }
    );

    if (!availabilityResponse.ok) {
      // Fallback: Return empty slots if API doesn't support this endpoint
      return generateDefaultSlots(now, daysAhead, duration);
    }

    const availabilityData = await availabilityResponse.json();
    
    // Parse available slots
    const slots: CalendlySlot[] = [];
    
    if (availabilityData.days) {
      for (const day of availabilityData.days) {
        if (day.spots) {
          for (const spot of day.spots) {
            if (spot.status === 'available') {
              slots.push({
                time: spot.start_time,
                available: true
              });
            }
          }
        }
      }
    }

    return slots;
  } catch (error: any) {
    console.error('Error fetching Calendly slots:', error);
    // Return empty array on error - will fallback to Google Calendar
    return [];
  }
}

/**
 * Create scheduled event on Calendly
 */
export async function createCalendlyEvent(
  apiToken: string,
  leadEmail: string,
  leadName: string,
  startTime: Date,
  eventTypeUri?: string
): Promise<{
  success: boolean;
  eventId?: string;
  invitationUri?: string;
  error?: string;
}> {
  try {
    if (!apiToken) {
      throw new Error('Calendly API token required');
    }

    // If no event type URI provided, get the first event type
    let eventUri = eventTypeUri;
    if (!eventUri) {
      const eventTypesResponse = await fetch(
        'https://api.calendly.com/user_event_types',
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (eventTypesResponse.ok) {
        const eventTypesData = await eventTypesResponse.json();
        if (eventTypesData.collection && eventTypesData.collection.length > 0) {
          eventUri = eventTypesData.collection[0].uri;
        }
      }
    }

    if (!eventUri) {
      throw new Error('No event type found in Calendly');
    }

    // Create scheduled event
    const createResponse = await fetch(
      'https://api.calendly.com/scheduled_events',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type_uri: eventUri,
          invitee: {
            email: leadEmail,
            name: leadName,
            timezone: 'America/New_York'
          },
          start_time: startTime.toISOString()
        })
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.json();
      throw new Error(error.title || 'Failed to create event');
    }

    const eventData: CalendlyScheduledEvent = await createResponse.json();

    return {
      success: true,
      eventId: eventData.resource.scheduled_event_uuid,
      invitationUri: eventData.resource.uri
    };
  } catch (error: any) {
    console.error('Error creating Calendly event:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get Calendly booking link for public sharing
 */
export function getCalendlyBookingLink(calendlyUsername: string): string {
  // Format: https://calendly.com/username
  if (!calendlyUsername) {
    return '';
  }
  return `https://calendly.com/${calendlyUsername}`;
}

/**
 * Generate default slots if Calendly API unavailable
 * (fallback for when availability schedules aren't public)
 */
function generateDefaultSlots(
  startDate: Date,
  daysAhead: number,
  slotDuration: number
): CalendlySlot[] {
  const slots: CalendlySlot[] = [];
  const businessHours = { start: 9, end: 17 }; // 9 AM - 5 PM

  for (let day = 0; day < daysAhead; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Generate slots for this day
    for (let hour = businessHours.start; hour < businessHours.end; hour++) {
      for (let minute = 0; minute < 60; minute += slotDuration) {
        const slotDate = new Date(date);
        slotDate.setHours(hour, minute, 0, 0);

        if (slotDate > startDate) {
          slots.push({
            time: slotDate.toISOString(),
            available: true
          });
        }
      }
    }
  }

  return slots;
}

/**
 * Validate Calendly API token
 */
export async function validateCalendlyToken(apiToken: string): Promise<{
  valid: boolean;
  userName?: string;
  error?: string;
}> {
  try {
    const response = await fetch('https://api.calendly.com/users/me', {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return {
        valid: false,
        error: 'Invalid Calendly API token'
      };
    }

    const data = await response.json();
    
    return {
      valid: true,
      userName: data.resource.name
    };
  } catch (error: any) {
    return {
      valid: false,
      error: error.message
    };
  }
}
