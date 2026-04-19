import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { ReviewPhotoCardComponent } from './review-photo-card.component';
import { ReviewPhoto } from '../../../../store/review-queue/review-queue.actions';
import { reviewQueueFeature } from '../../../../store/review-queue/review-queue.reducer';

const mockPhoto: ReviewPhoto = {
  id: 'photo-1',
  status: 'review_required',
  thumbnailUrl: 'https://cdn.example.com/processed/photo-1.jpg',
  bibNumbers: ['101'],
  uploadedAt: '2026-04-01T10:00:00Z',
  errorReason: null,
};

describe('ReviewPhotoCardComponent', () => {
  let fixture: ComponentFixture<ReviewPhotoCardComponent>;
  let component: ReviewPhotoCardComponent;
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewPhotoCardComponent, NoopAnimationsModule],
      providers: [
        provideMockStore({
          initialState: {
            [reviewQueueFeature.name]: {
              photos: [],
              loading: false,
              error: null,
              saveLoading: {},
              saveError: {},
            },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(ReviewPhotoCardComponent);
    component = fixture.componentInstance;
    component.photo = mockPhoto;
    fixture.detectChanges();
  });

  it('renders thumbnail', () => {
    const img = fixture.nativeElement.querySelector('img.thumbnail') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo-1.jpg');
  });

  it('shows saved bib chips', () => {
    const chips = fixture.nativeElement.querySelectorAll('mat-chip-set mat-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('101');
  });

  it('shows no-bibs message when bibNumbers is empty', () => {
    component.photo = { ...mockPhoto, bibNumbers: [] };
    component.pendingBibs.set([]);
    fixture.detectChanges();
    const noTag = fixture.nativeElement.querySelector('.no-bibs');
    expect(noTag).toBeTruthy();
  });

  it('save button is disabled when no bibs and no pending bibs', () => {
    component.photo = { ...mockPhoto, bibNumbers: [] };
    component.pendingBibs.set([]);
    expect(component.isSaveDisabled).toBeTrue();
  });

  it('save button is enabled when there are pending bibs', () => {
    component.pendingBibs.set(['202']);
    expect(component.isSaveDisabled).toBeFalse();
  });

  it('shows error badge for error-status photo', () => {
    fixture.componentRef.setInput('photo', { ...mockPhoto, status: 'error' });
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.error-badge');
    expect(badge).toBeTruthy();
  });

  it('dispatches savePhotoBibs on save click', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.pendingBibs.set(['303']);
    component.onSave();
    expect(dispatchSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ photoId: 'photo-1', bibNumbers: ['303'] }),
    );
  });
});
