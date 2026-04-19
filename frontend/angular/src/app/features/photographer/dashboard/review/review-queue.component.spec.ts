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

describe('ReviewQueueComponent', () => {
  let fixture: ComponentFixture<ReviewQueueComponent>;
  let store: MockStore;

  function createComponent(storeState: object) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ReviewQueueComponent, NoopAnimationsModule],
      providers: [provideMockStore({ initialState: storeState })],
    });
    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(ReviewQueueComponent);
    fixture.detectChanges();
  }

  it('dispatches loadReviewQueue on init when event selected', () => {
    createComponent({
      [reviewQueueFeature.name]: { photos: [], loading: false, error: null, saveLoading: {}, saveError: {} },
      events: { selectedEvent: mockEvent },
    });
    const dispatchSpy = spyOn(store, 'dispatch');
    fixture.componentInstance.ngOnInit();
    expect(dispatchSpy).toHaveBeenCalledWith(
      ReviewQueueActions.loadReviewQueue({ eventId: 'event-1' }),
    );
  });

  it('shows loading skeleton when loading', () => {
    createComponent({
      [reviewQueueFeature.name]: { photos: [], loading: true, error: null, saveLoading: {}, saveError: {} },
      events: { selectedEvent: null },
    });
    expect(fixture.nativeElement.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows error state', () => {
    createComponent({
      [reviewQueueFeature.name]: { photos: [], loading: false, error: 'Network error', saveLoading: {}, saveError: {} },
      events: { selectedEvent: null },
    });
    expect(fixture.nativeElement.querySelector('.error-icon')).toBeTruthy();
  });

  it('shows empty state when no photos', () => {
    createComponent({
      [reviewQueueFeature.name]: { photos: [], loading: false, error: null, saveLoading: {}, saveError: {} },
      events: { selectedEvent: null },
    });
    expect(fixture.nativeElement.querySelector('.success-icon')).toBeTruthy();
  });

  it('renders photo cards when photos loaded', () => {
    createComponent({
      [reviewQueueFeature.name]: { photos: mockPhotos, loading: false, error: null, saveLoading: {}, saveError: {} },
      events: { selectedEvent: mockEvent },
    });
    const cards = fixture.nativeElement.querySelectorAll('app-review-photo-card');
    expect(cards.length).toBe(1);
  });
});
