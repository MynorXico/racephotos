import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { convertToParamMap } from '@angular/router';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { EventPhotosComponent } from './event-photos.component';
import { Photo, PhotosActions } from '../../../store/photos/photos.actions';
import {
  selectAllPhotos,
  selectPhotosLoading,
  selectPhotosError,
  selectNextCursor,
  selectHasMorePages,
  selectActiveFilter,
  selectPhotoCount,
} from '../../../store/photos/photos.selectors';
import { selectSelectedEvent, selectEventsLoading } from '../../../store/events/events.selectors';

// Provide paramMap as an Observable — the component uses toSignal(this.route.paramMap)
// rather than snapshot.paramMap so it reacts to navigation between different events.
const mockRoute = { paramMap: of(convertToParamMap({ id: 'event-1' })) };

const mockPhoto: Photo = {
  id: 'p1',
  status: 'indexed',
  thumbnailUrl: 'https://cdn.example.com/p1.jpg',
  bibNumbers: ['101'],
  uploadedAt: '2026-04-01T10:00:00Z',
  errorReason: null,
};

describe('EventPhotosComponent', () => {
  let fixture: ComponentFixture<EventPhotosComponent>;
  let component: EventPhotosComponent;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  const initialState = {
    photos: {
      photos: [],
      nextCursor: null,
      activeFilter: null,
      loading: false,
      error: null,
    },
    events: {
      events: [],
      selectedEvent: null,
      loading: false,
      error: null,
      nextCursor: null,
      cursorHistory: [],
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RouterTestingModule, EventPhotosComponent],
      providers: [
        provideMockStore({ initialState }),
        { provide: ActivatedRoute, useValue: mockRoute },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectAllPhotos, []);
    store.overrideSelector(selectPhotosLoading, false);
    store.overrideSelector(selectPhotosError, null);
    store.overrideSelector(selectNextCursor, null);
    store.overrideSelector(selectHasMorePages, false);
    store.overrideSelector(selectActiveFilter, null);
    store.overrideSelector(selectPhotoCount, 0);
    store.overrideSelector(selectSelectedEvent, null);
    store.overrideSelector(selectEventsLoading, false);

    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();

    fixture = TestBed.createComponent(EventPhotosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('dispatches Load Photos on init', () => {
    const calls = dispatchSpy.calls.allArgs() as [{ type: string }][];
    const loadCall = calls.find(([a]) => a.type === PhotosActions.loadPhotos.type);
    expect(loadCall).toBeTruthy();
  });

  it('shows empty state when no photos and not loading', () => {
    const emptyBlock = fixture.nativeElement.querySelector('.state-block');
    expect(emptyBlock).toBeTruthy();
    expect((emptyBlock as HTMLElement).textContent).toContain('No photos yet');
  });

  it('shows loading skeleton when loading with no photos', () => {
    store.overrideSelector(selectPhotosLoading, true);
    store.overrideSelector(selectAllPhotos, []);
    store.refreshState();
    fixture.detectChanges();
    const skeletons = fixture.nativeElement.querySelectorAll('.skeleton-card');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state when error is set', () => {
    store.overrideSelector(selectPhotosError, 'Network error');
    store.overrideSelector(selectPhotosLoading, false);
    store.refreshState();
    fixture.detectChanges();
    const errorBlock: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(errorBlock).toBeTruthy();
    expect(errorBlock.textContent).toContain('Could not load photos');
  });

  it('renders photo cards when photos are loaded', () => {
    store.overrideSelector(selectAllPhotos, [mockPhoto]);
    store.overrideSelector(selectPhotoCount, 1);
    store.refreshState();
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('app-photo-card');
    expect(cards.length).toBe(1);
  });

  it('dispatches Filter By Status when chip is selected', () => {
    dispatchSpy.calls.reset();
    component.onFilterChip('error');
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotosActions.filterByStatus({ eventId: 'event-1', status: 'error' }),
    );
  });

  it('dispatches Load Next Page on load-more click', () => {
    store.overrideSelector(selectNextCursor, 'cursor-abc');
    store.refreshState();
    fixture.detectChanges();
    dispatchSpy.calls.reset();
    component.onLoadMore();
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotosActions.loadNextPage({ eventId: 'event-1', cursor: 'cursor-abc' }),
    );
  });

  it('dispatches Clear Photos on destroy', () => {
    dispatchSpy.calls.reset();
    component.ngOnDestroy();
    expect(dispatchSpy).toHaveBeenCalledWith(PhotosActions.clearPhotos());
  });
});
