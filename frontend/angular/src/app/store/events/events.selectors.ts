import { createFeatureSelector, createSelector } from '@ngrx/store';
import { EventsState } from './events.reducer';

export const selectEventsState = createFeatureSelector<EventsState>('events');

export const selectAllEvents = createSelector(selectEventsState, (state) => state.events);

export const selectSelectedEvent = createSelector(
  selectEventsState,
  (state) => state.selectedEvent,
);

export const selectEventsLoading = createSelector(selectEventsState, (state) => state.loading);

export const selectEventsError = createSelector(selectEventsState, (state) => state.error);

export const selectNextCursor = createSelector(selectEventsState, (state) => state.nextCursor);

export const selectCursorHistory = createSelector(
  selectEventsState,
  (state) => state.cursorHistory,
);
