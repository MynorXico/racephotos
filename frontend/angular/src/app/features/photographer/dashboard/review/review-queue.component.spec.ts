import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { ReviewQueueComponent } from './review-queue.component';
import { ReviewQueueActions } from '../../../../store/review-queue/review-queue.actions';
import { reviewQueueFeature } from '../../../../store/review-queue/review-queue.reducer';

const mockEvent = { id: 'event-1', name: 'Test Race', date: '2026-04-01', status: 'active' };

const mockPhotos = [
  {
    id: 'photo-1',
    status: 'review_required' as const,
    thumbnailUrl: null,
    bibNumbers: [],
    uploadedAt: '2026-04-01T10:00:00Z',
    errorReason: null,
  },
];

const baseQueueState = {
  photos: [],
  loading: false,
  loadingMore: false,
  error: null,
  paginationError: null,
  nextCursor: null,
  saveLoading: {},
  saveError: {},
};

describe('ReviewQueueComponent', () => {
  let fixture: ComponentFixture<ReviewQueueComponent>;
  let store: MockStore;

  function setupModule(storeState: object): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReviewQueueComponent, NoopAnimationsModule],
      providers: [provideMockStore({ initialState: storeState })],
    });
    store = TestBed.inject(MockStore);
  }

  it('dispatches loadReviewQueue on construction when event selected', () => {
    setupModule({
      [reviewQueueFeature.name]: { ...baseQueueState },
      events: { selectedEvent: mockEvent },
    });
    const dispatchSpy = spyOn(store, 'dispatch');
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(
      ReviewQueueActions.loadReviewQueue({ eventId: 'event-1' }),
    );
  });

  it('shows loading skeleton when loading', () => {
    setupModule({
      [reviewQueueFeature.name]: { ...baseQueueState, loading: true },
      events: { selectedEvent: null },
    });
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows error state', () => {
    setupModule({
      [reviewQueueFeature.name]: { ...baseQueueState, error: 'Network error' },
      events: { selectedEvent: null },
    });
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.error-icon')).toBeTruthy();
  });

  it('shows empty state when no photos', () => {
    setupModule({
      [reviewQueueFeature.name]: { ...baseQueueState },
      events: { selectedEvent: null },
    });
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.success-icon')).toBeTruthy();
  });

  it('renders photo cards when photos loaded', () => {
    setupModule({
      [reviewQueueFeature.name]: { ...baseQueueState, photos: mockPhotos },
      events: { selectedEvent: mockEvent },
    });
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('app-review-photo-card');
    expect(cards.length).toBe(1);
  });
});
