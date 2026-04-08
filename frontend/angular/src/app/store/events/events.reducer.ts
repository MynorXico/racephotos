import { createReducer, on } from '@ngrx/store';
import { Event } from '../../features/photographer/events/event.model';
import { EventsActions } from './events.actions';

export interface EventsState {
  events: Event[];
  selectedEvent: Event | null;
  loading: boolean;
  error: string | null;
  nextCursor: string | null;
  /** Cursor history stack for previous-page navigation (UX-D1). */
  cursorHistory: string[];
}

export const initialEventsState: EventsState = {
  events: [],
  selectedEvent: null,
  loading: false,
  error: null,
  nextCursor: null,
  cursorHistory: [],
};

export const eventsReducer = createReducer<EventsState>(
  initialEventsState,

  // ── Load Events ────────────────────────────────────────────────────────────
  on(EventsActions.loadEvents, (state, { cursor }) => {
    // When navigating back, the effect re-dispatches loadEvents with the previous
    // page cursor. We must not push it again — only push when moving forward to a
    // cursor that is not already at the top of the stack.
    const isBack =
      cursor !== undefined &&
      state.cursorHistory.length > 0 &&
      state.cursorHistory[state.cursorHistory.length - 1] === cursor;
    return {
      ...state,
      loading: true,
      error: null,
      cursorHistory: cursor && !isBack ? [...state.cursorHistory, cursor] : state.cursorHistory,
    };
  }),

  on(EventsActions.loadEventsSuccess, (state, { events, nextCursor }) => ({
    ...state,
    loading: false,
    events,
    nextCursor,
  })),

  on(EventsActions.loadEventsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Load Events Previous Page ──────────────────────────────────────────────
  on(EventsActions.loadEventsPreviousPage, (state) => ({
    ...state,
    loading: true,
    error: null,
    cursorHistory: state.cursorHistory.slice(0, -1),
  })),

  // ── Load Event ─────────────────────────────────────────────────────────────
  on(EventsActions.loadEvent, (state) => ({
    ...state,
    loading: true,
    error: null,
    selectedEvent: null,
  })),

  on(EventsActions.loadEventSuccess, (state, { event }) => ({
    ...state,
    loading: false,
    selectedEvent: event,
  })),

  on(EventsActions.loadEventFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Create Event ───────────────────────────────────────────────────────────
  on(EventsActions.createEvent, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(EventsActions.createEventSuccess, (state, { event }) => ({
    ...state,
    loading: false,
    selectedEvent: event,
    events: [event, ...state.events],
  })),

  on(EventsActions.createEventFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Update Event ───────────────────────────────────────────────────────────
  on(EventsActions.updateEvent, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(EventsActions.updateEventSuccess, (state, { event }) => ({
    ...state,
    loading: false,
    selectedEvent: event,
    events: state.events.map((e) => (e.id === event.id ? event : e)),
  })),

  on(EventsActions.updateEventFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // ── Archive Event ──────────────────────────────────────────────────────────
  on(EventsActions.archiveEvent, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(EventsActions.archiveEventSuccess, (state, { event }) => ({
    ...state,
    loading: false,
    selectedEvent: state.selectedEvent?.id === event.id ? event : state.selectedEvent,
    events: state.events.map((e) => (e.id === event.id ? event : e)),
  })),

  on(EventsActions.archiveEventFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
);
