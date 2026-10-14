/**
 * Open event record (v0). The same shape is produced by the sibling packages
 * `structured-event-feeds` and consumed by Open Media Events, so adapters can be
 * swapped without changing callers.
 */
export type EventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'unknown';
export type AttendanceMode = 'in_person' | 'online' | 'hybrid' | 'unknown';
export type RegistrationAvailability =
  | 'open'
  | 'closed'
  | 'sold_out'
  | 'waitlist'
  | 'approval_required'
  | 'unknown';

export interface EventVenue {
  name?: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
}

export interface EventOrganizer {
  name: string;
  url?: string;
  providerId?: string;
}

export interface EventPrice {
  isFree?: boolean;
  minCents?: number;
  maxCents?: number;
  currency?: string;
  text?: string;
}

export interface EventRegistration {
  availability: RegistrationAvailability;
  requiresApproval?: boolean;
  spotsRemaining?: number;
  /** Official page where a person completes registration themselves. */
  url: string;
}

export interface DiscoveredEvent {
  provider: string;
  providerEventId: string;
  url: string;
  title: string;
  description?: string;
  /** ISO 8601 instant, or a calendar date (YYYY-MM-DD) when `dateOnly` is true. */
  startsAt: string;
  endsAt?: string;
  /** True when the source gave only a date, not a start time. */
  dateOnly?: boolean;
  timezone?: string;
  status: EventStatus;
  attendanceMode: AttendanceMode;
  venue?: EventVenue;
  organizer?: EventOrganizer;
  imageUrl?: string;
  price?: EventPrice;
  registration?: EventRegistration;
  categories?: string[];
  recurrence?: { isRecurring: boolean; seriesId?: string };
  /** Aggregate count only. Attendee identities are never returned. */
  attendeeCount?: number;
  retrievedAt: string;
}
