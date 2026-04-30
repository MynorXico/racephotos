import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Subject } from 'rxjs';
import { Action } from '@ngrx/store';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

import { EventSearchComponent } from './event-search.component';
import { RunnerPhoto } from '../../store/runner-photos/runner-photos.actions';
import { RunnerPhotoGridComponent } from './photo-grid/photo-grid.component';

/** Stub that replaces RunnerPhotoGridComponent — avoids pulling in MatDialogModule. */
@Component({
  selector: 'app-runner-photo-grid',
  template: '',
  standalone: true,
})
class StubRunnerPhotoGridComponent {
  @Input() photos: RunnerPhoto[] = [];
  @Input() pricePerPhoto = 0;
  @Input() currency = '';
  @Input() eventId = '';
  @Input() eventName = '';
  @Input() searchedBib = '';
  @Output() photoSelected = new EventEmitter<string>();
}
import { RunnerPhotosActions } from '../../store/runner-photos/runner-photos.actions';
import { EventsActions } from '../../store/events/events.actions';
import {
  selectRunnerPhotos,
  selectRunnerPhotosLoading,
  selectRunnerPhotosLoadingMore,
  selectRunnerPhotosError,
  selectRunnerPhotosLoadMoreError,
  selectSearchedBib,
  selectHasSearched,
  selectHasResults,
  selectSelectedPhoto,
  selectNextCursor,
  selectTotalCount,
  selectMode,
  selectHasMorePhotos,
} from '../../store/runner-photos/runner-photos.selectors';
import {
  selectSelectedEvent,
  selectEventsLoading,
} from '../../store/events/events.selectors';
import { selectActivePhotoIds } from '../../store/purchases/purchases.selectors';

const mockEvent = {
  id: 'event-123',
  photographerId: 'photographer-1',
  name: 'Test Race 2026',
  date: '2026-06-01',
  location: 'Test City',
  pricePerPhoto: 9.99,
  currency: 'USD',
  watermarkText: 'RaceShots',
  status: 'active' as const,
  visibility: 'public' as const,
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockPhoto = {
  photoId: 'photo-1',
  watermarkedUrl: 'https://cdn.example.com/p1.jpg',
  capturedAt: null,
};

function buildActivatedRoute(id: string): Partial<ActivatedRoute> {
  return {
    paramMap: of(convertToParamMap({ id })),
  };
}

describe('EventSearchComponent', () => {
  let fixture: ComponentFixture<EventSearchComponent>;
  let component: EventSearchComponent;
  let store: MockStore;
  let actions$: Subject<Action>;
  let dialogSpy: jasmine.SpyObj<MatDialog>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<unknown>>;

  beforeEach(async () => {
    actions$ = new Subject<Action>();

    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['afterClosed', 'close', 'backdropClick']);
    dialogRefSpy.afterClosed.and.returnValue(of(undefined));
    dialogRefSpy.backdropClick = jasmine.createSpy().and.returnValue(of(undefined));

    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    dialogSpy.open.and.returnValue(dialogRefSpy);

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, EventSearchComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        provideMockActions(() => actions$),
        { provide: ActivatedRoute, useValue: buildActivatedRoute('event-123') },
        { provide: MatDialog, useValue: dialogSpy },
      ],
    })
      // Replace the real grid (which transitively imports MatDialogModule) with a stub
      // so the MatDialog spy is not shadowed by a module-provided instance.
      .overrideComponent(EventSearchComponent, {
        remove: { imports: [RunnerPhotoGridComponent] },
        add: { imports: [StubRunnerPhotoGridComponent] },
      })
      .compileComponents();

    store = TestBed.inject(MockStore);

    // Default selector overrides
    store.overrideSelector(selectRunnerPhotos, []);
    store.overrideSelector(selectRunnerPhotosLoading, false);
    store.overrideSelector(selectRunnerPhotosLoadingMore, false);
    store.overrideSelector(selectRunnerPhotosError, null);
    store.overrideSelector(selectRunnerPhotosLoadMoreError, null);
    store.overrideSelector(selectSearchedBib, null);
    store.overrideSelector(selectHasSearched, false);
    store.overrideSelector(selectHasResults, false);
    store.overrideSelector(selectSelectedPhoto, null);
    store.overrideSelector(selectSelectedEvent, null);
    store.overrideSelector(selectEventsLoading, false);
    store.overrideSelector(selectActivePhotoIds, null);
    store.overrideSelector(selectNextCursor, null);
    store.overrideSelector(selectTotalCount, 0);
    store.overrideSelector(selectMode, 'all');
    store.overrideSelector(selectHasMorePhotos, false);

    spyOn(store, 'dispatch');

    fixture = TestBed.createComponent(EventSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  // --- Initialization ---

  it('dispatches loadEvent on init with the route id', () => {
    expect(store.dispatch).toHaveBeenCalledWith(EventsActions.loadEvent({ id: 'event-123' }));
  });

  it('dispatches loadEventPhotos on init', () => {
    expect(store.dispatch).toHaveBeenCalledWith(
      RunnerPhotosActions.loadEventPhotos({ eventId: 'event-123' }),
    );
  });

  it('dispatches clearResults on destroy', () => {
    fixture.destroy();
    expect(store.dispatch).toHaveBeenCalledWith(RunnerPhotosActions.clearResults());
  });

  // --- Search form ---

  it('renders the bib input', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input).toBeTruthy();
  });

  it('does not dispatch searchByBib when bibControl is invalid', () => {
    const dispatchCallsBefore = (store.dispatch as jasmine.Spy).calls.count();
    component.bibControl.setValue('');
    component.onSubmit();
    expect((store.dispatch as jasmine.Spy).calls.count()).toBe(dispatchCallsBefore);
  });

  it('dispatches searchByBib with the bib number', () => {
    component.bibControl.setValue('42');
    component.onSubmit();
    expect(store.dispatch).toHaveBeenCalledWith(
      RunnerPhotosActions.searchByBib({ eventId: 'event-123', bibNumber: '42' }),
    );
  });

  it('rejects non-numeric bib', () => {
    component.bibControl.setValue('abc');
    expect(component.bibControl.valid).toBeFalse();
  });

  it('rejects bib longer than 6 digits', () => {
    component.bibControl.setValue('1234567');
    expect(component.bibControl.valid).toBeFalse();
  });

  it('accepts a valid 1–6 digit bib', () => {
    component.bibControl.setValue('101');
    expect(component.bibControl.valid).toBeTrue();
  });

  // --- Loading state ---

  it('shows skeleton cards when loading', () => {
    store.overrideSelector(selectRunnerPhotosLoading, true);
    store.refreshState();
    fixture.detectChanges();
    const skeleton = fixture.nativeElement.querySelector('.skeleton-grid');
    expect(skeleton).toBeTruthy();
  });

  // --- Error state ---

  it('shows retry button on error', () => {
    store.overrideSelector(selectRunnerPhotosError, 'network_error');
    store.refreshState();
    fixture.detectChanges();
    const btn: HTMLElement = fixture.nativeElement.querySelector('[role="alert"] button');
    expect(btn).toBeTruthy();
    expect(btn.textContent?.trim().toLowerCase()).toBe('try again');
  });

  it('onRetry dispatches searchByBib when mode is bib and searchedBib is set', () => {
    store.overrideSelector(selectSearchedBib, '99');
    store.overrideSelector(selectMode, 'bib');
    store.refreshState();
    fixture.detectChanges();
    component.onRetry();
    expect(store.dispatch).toHaveBeenCalledWith(
      RunnerPhotosActions.searchByBib({ eventId: 'event-123', bibNumber: '99' }),
    );
  });

  // --- Results ---

  it('shows no-results state after bib search with no photos', () => {
    store.overrideSelector(selectHasSearched, true);
    store.overrideSelector(selectHasResults, false);
    store.overrideSelector(selectMode, 'bib');
    store.refreshState();
    fixture.detectChanges();
    const status: HTMLElement = fixture.nativeElement.querySelector('[role="status"]');
    expect(status).toBeTruthy();
  });

  it('renders photo grid when there are results', () => {
    store.overrideSelector(selectHasResults, true);
    store.overrideSelector(selectRunnerPhotos, [mockPhoto]);
    store.overrideSelector(selectSelectedEvent, mockEvent);
    store.refreshState();
    fixture.detectChanges();
    const grid = fixture.nativeElement.querySelector('app-runner-photo-grid');
    expect(grid).toBeTruthy();
  });

  // --- Photo detail dialog ---

  it('opens dialog when a photo is selected', () => {
    store.overrideSelector(selectSelectedPhoto, mockPhoto);
    store.overrideSelector(selectSelectedEvent, mockEvent);
    store.refreshState();
    fixture.detectChanges();
    expect(dialogSpy.open).toHaveBeenCalled();
  });

  it('dispatches selectPhoto on onPhotoSelected', () => {
    component.onPhotoSelected('photo-xyz');
    expect(store.dispatch).toHaveBeenCalledWith(
      RunnerPhotosActions.selectPhoto({ photoId: 'photo-xyz' }),
    );
  });

  // --- Page title ---

  it('renders the event name in the header when event is loaded', () => {
    store.overrideSelector(selectSelectedEvent, mockEvent);
    store.refreshState();
    fixture.detectChanges();
    const heading: HTMLElement = fixture.nativeElement.querySelector('h1');
    expect(heading.textContent).toContain('Test Race 2026');
  });
});
