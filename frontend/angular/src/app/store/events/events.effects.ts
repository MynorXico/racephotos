import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { catchError, filter, map, switchMap, tap, withLatestFrom } from 'rxjs/operators';

import { AppConfigService } from '../../core/config/app-config.service';
import { EventsActions, PublicEventsActions } from './events.actions';
import { Event, PublicEvent } from '../../features/photographer/events/event.model';
import { selectCursorHistory, selectSelectedEvent } from './events.selectors';

interface ListEventsResponse {
  events: Event[];
  nextCursor: string | null;
}

interface ListPublicEventsResponse {
  events: PublicEvent[];
  nextCursor: string | null;
}

@Injectable()
export class EventsEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);
  private readonly store = inject(Store);
  private readonly configService = inject(AppConfigService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  private get apiBase(): string {
    return this.configService.get().apiBaseUrl;
  }

  /** GET /photographer/me/events — loads the authenticated photographer's event list. */
  loadEvents$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.loadEvents),
      switchMap(({ cursor }) => {
        const url = cursor
          ? `${this.apiBase}/photographer/me/events?cursor=${encodeURIComponent(cursor)}`
          : `${this.apiBase}/photographer/me/events`;
        return this.http.get<ListEventsResponse>(url).pipe(
          map((res) =>
            EventsActions.loadEventsSuccess({
              events: res.events,
              nextCursor: res.nextCursor ?? null,
            }),
          ),
          catchError((err: HttpErrorResponse) =>
            of(
              EventsActions.loadEventsFailure({
                error: (err.error as { error?: string })?.error ?? 'Failed to load events',
              }),
            ),
          ),
        );
      }),
    ),
  );

  /** Previous page — reads cursor history (already popped by reducer) and loads the prior page. */
  loadEventsPreviousPage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.loadEventsPreviousPage),
      withLatestFrom(this.store.select(selectCursorHistory)),
      map(([, cursorHistory]) => {
        // The reducer already popped the current cursor from the stack; the last
        // remaining entry (if any) is the cursor for the previous page.
        const prevCursor = cursorHistory[cursorHistory.length - 1];
        return EventsActions.loadEvents({ cursor: prevCursor });
      }),
    ),
  );

  /** GET /events/{id} — loads a single event by ID. */
  loadEvent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.loadEvent),
      switchMap(({ id }) =>
        this.http.get<Event>(`${this.apiBase}/events/${id}`).pipe(
          map((event) => EventsActions.loadEventSuccess({ event })),
          catchError((err: HttpErrorResponse) =>
            of(
              EventsActions.loadEventFailure({
                error:
                  err.status === 404
                    ? 'not_found'
                    : ((err.error as { error?: string })?.error ?? 'Failed to load event'),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** POST /events — creates a new event, then navigates to the new event detail page. */
  createEvent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.createEvent),
      switchMap(({ event }) =>
        this.http.post<Event>(`${this.apiBase}/events`, event).pipe(
          map((created) => EventsActions.createEventSuccess({ event: created })),
          catchError((err: HttpErrorResponse) =>
            of(
              EventsActions.createEventFailure({
                error:
                  err.status === 400
                    ? 'validation_error'
                    : ((err.error as { error?: string })?.error ?? 'Failed to create event'),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** Navigate to the new event detail page after successful creation. */
  createEventSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(EventsActions.createEventSuccess),
        tap(({ event }) => {
          void this.router.navigate(['/photographer/events', event.id]);
        }),
      ),
    { dispatch: false },
  );

  /** PUT /events/{id} — updates an existing event. */
  updateEvent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.updateEvent),
      switchMap(({ id, event }) =>
        this.http.put<Event>(`${this.apiBase}/events/${id}`, event).pipe(
          map((updated) => EventsActions.updateEventSuccess({ event: updated })),
          catchError((err: HttpErrorResponse) =>
            of(
              EventsActions.updateEventFailure({
                error:
                  err.status === 400
                    ? 'validation_error'
                    : err.status === 403
                      ? 'forbidden'
                      : ((err.error as { error?: string })?.error ?? 'Failed to update event'),
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** Navigate back to event detail and show snackbar after successful update. */
  updateEventSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(EventsActions.updateEventSuccess),
        tap(({ event }) => {
          void this.router.navigate(['/photographer/events', event.id]);
          this.snackBar.open('Event updated successfully.', undefined, { duration: 4000 });
        }),
      ),
    { dispatch: false },
  );

  /** When events load and no event is selected, auto-select the first active event. */
  autoSelectEvent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.loadEventsSuccess),
      withLatestFrom(this.store.select(selectSelectedEvent)),
      filter(([{ events }, selected]) => selected === null && events.length > 0),
      map(([{ events }]) => {
        const active = events.find((e) => e.status === 'active') ?? events[0];
        return EventsActions.selectEvent({ event: active });
      }),
    ),
  );

  /** GET /events — loads the public event listing (no auth). */
  listPublicEvents$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PublicEventsActions.listPublicEvents),
      switchMap(({ cursor }) => {
        const append = cursor !== undefined;
        const url = cursor
          ? `${this.apiBase}/events?cursor=${encodeURIComponent(cursor)}`
          : `${this.apiBase}/events`;
        return this.http.get<ListPublicEventsResponse>(url).pipe(
          map((res) =>
            PublicEventsActions.listPublicEventsSuccess({
              events: res.events,
              nextCursor: res.nextCursor ?? null,
              append,
            }),
          ),
          catchError((err: HttpErrorResponse) =>
            of(
              PublicEventsActions.listPublicEventsFailure({
                error: (err.error as { error?: string })?.error ?? 'Failed to load events',
              }),
            ),
          ),
        );
      }),
    ),
  );

  /** PUT /events/{id}/archive — archives an event. */
  archiveEvent$ = createEffect(() =>
    this.actions$.pipe(
      ofType(EventsActions.archiveEvent),
      switchMap(({ id }) =>
        this.http.put<Event>(`${this.apiBase}/events/${id}/archive`, {}).pipe(
          map((archived) => EventsActions.archiveEventSuccess({ event: archived })),
          catchError((err: HttpErrorResponse) =>
            of(
              EventsActions.archiveEventFailure({
                error:
                  err.status === 403
                    ? 'forbidden'
                    : ((err.error as { error?: string })?.error ?? 'Failed to archive event'),
              }),
            ),
          ),
        ),
      ),
    ),
  );
}
