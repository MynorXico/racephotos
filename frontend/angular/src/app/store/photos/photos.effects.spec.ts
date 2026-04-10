import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';

import { PhotosEffects } from './photos.effects';
import { PhotosActions } from './photos.actions';
import { selectActiveFilter } from './photos.selectors';
import { AppConfigService } from '../../core/config/app-config.service';

const API_BASE = 'https://api.example.com';

describe('PhotosEffects', () => {
  let actions$: Subject<Action>;
  let effects: PhotosEffects;
  let httpMock: HttpTestingController;
  let store: MockStore;

  const mockConfigService = {
    get: () => ({ apiBaseUrl: API_BASE }),
  };

  beforeEach(() => {
    actions$ = new Subject<Action>();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PhotosEffects,
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: AppConfigService, useValue: mockConfigService },
      ],
    });

    effects = TestBed.inject(PhotosEffects);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(MockStore);
    store.overrideSelector(selectActiveFilter, null);
  });

  afterEach(() => {
    httpMock.verify();
    store.resetSelectors();
  });

  describe('loadPhotos$', () => {
    it('sends GET /events/:id/photos with no query params when filter is null', (done) => {
      store.overrideSelector(selectActiveFilter, null);
      store.refreshState();

      effects.loadPhotos$.subscribe((action) => {
        expect(action.type).toBe(PhotosActions.loadPhotosSuccess.type);
        done();
      });

      actions$.next(PhotosActions.loadPhotos({ eventId: 'evt-1' }));

      const req = httpMock.expectOne(`${API_BASE}/events/evt-1/photos`);
      req.flush({ photos: [], nextCursor: null });
    });

    it('sends ?status=in_progress when in_progress filter is active', (done) => {
      store.overrideSelector(selectActiveFilter, 'in_progress');
      store.refreshState();

      effects.loadPhotos$.subscribe((action) => {
        expect(action.type).toBe(PhotosActions.loadPhotosSuccess.type);
        done();
      });

      actions$.next(PhotosActions.loadPhotos({ eventId: 'evt-1' }));

      const req = httpMock.expectOne(
        `${API_BASE}/events/evt-1/photos?status=in_progress`,
      );
      expect(req.request.urlWithParams).toContain('status=in_progress');
      req.flush({
        photos: [
          {
            id: 'p1',
            status: 'processing',
            thumbnailUrl: null,
            bibNumbers: [],
            uploadedAt: '2026-04-01T10:00:00Z',
            errorReason: null,
          },
        ],
        nextCursor: null,
      });
    });
  });

  describe('loadNextPage$', () => {
    it('sends cursor and status=in_progress when in_progress filter is active', (done) => {
      store.overrideSelector(selectActiveFilter, 'in_progress');
      store.refreshState();

      effects.loadNextPage$.subscribe((action) => {
        expect(action.type).toBe(PhotosActions.loadNextPageSuccess.type);
        done();
      });

      actions$.next(PhotosActions.loadNextPage({ eventId: 'evt-1', cursor: 'abc' }));

      // Match by predicate because the param order is implementation-defined.
      const req = httpMock.expectOne(
        (r) =>
          r.urlWithParams.includes('cursor=abc') &&
          r.urlWithParams.includes('status=in_progress'),
      );
      req.flush({ photos: [], nextCursor: null });
    });

    it('cancels in-flight loadNextPage when filterByStatus is dispatched', (done) => {
      store.overrideSelector(selectActiveFilter, null);
      store.refreshState();

      const emitted: Action[] = [];
      effects.loadNextPage$.subscribe((action) => emitted.push(action));
      // Also subscribe to loadPhotos$ so the secondary request (spawned by
      // filterByStatus$ → loadPhotos) is handled and does not fail httpMock.verify().
      effects.loadPhotos$.subscribe();

      actions$.next(PhotosActions.loadNextPage({ eventId: 'evt-1', cursor: 'abc' }));

      // Hold a reference to the in-flight request before cancelling it.
      const pendingReq = httpMock.expectOne(`${API_BASE}/events/evt-1/photos?cursor=abc`);

      // Dispatch filterByStatus — takeUntil in loadNextPage$ cancels the HTTP call.
      actions$.next(
        PhotosActions.filterByStatus({ eventId: 'evt-1', status: 'in_progress' }),
      );

      // The original request was cancelled; drain the secondary loadPhotos$ request.
      const secondary = httpMock.match(`${API_BASE}/events/evt-1/photos`);
      secondary.forEach((r) => {
        if (!r.cancelled) r.flush({ photos: [], nextCursor: null });
      });

      // The cancelled loadNextPage must not have emitted a success action.
      expect(pendingReq.cancelled).toBeTrue();
      expect(emitted).toHaveSize(0);
      done();
    });
  });

  describe('filterByStatus$', () => {
    it('re-dispatches loadPhotos after filterByStatus', (done) => {
      effects.filterByStatus$.subscribe((action) => {
        expect(action).toEqual(PhotosActions.loadPhotos({ eventId: 'evt-1' }));
        done();
      });

      actions$.next(
        PhotosActions.filterByStatus({ eventId: 'evt-1', status: 'in_progress' }),
      );
    });
  });
});
