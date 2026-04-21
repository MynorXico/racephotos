export interface Event {
  id: string;
  photographerId: string;
  name: string;
  date: string; // ISO 8601 YYYY-MM-DD
  location: string;
  pricePerPhoto: number;
  currency: string; // ISO 4217
  watermarkText: string;
  status: 'active' | 'archived';
  visibility: 'public' | 'unlisted';
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** PublicEvent is the subset of Event returned by the public GET /events listing. */
export interface PublicEvent {
  id: string;
  name: string;
  date: string; // ISO 8601 YYYY-MM-DD
  location: string;
  createdAt: string;
}

export interface CreateEventRequest {
  name: string;
  date: string;
  location: string;
  pricePerPhoto: number;
  currency?: string;
  watermarkText?: string;
}

export type UpdateEventRequest = Partial<CreateEventRequest>;
