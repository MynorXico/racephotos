import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';

import { EventListComponent } from './event-list.component';
import { EventsActions } from '../../../../store/events/events.actions';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { Event } from '../event.model';

const mockEvent: Event = {
  id: 'evt-1',
  photographerId: 'user-1',
  name: 'Spring Run',
  date: '2026-06-01',
  location: 'Central Park',
  pricePerPhoto: 5,
  currency: 'USD',
  watermarkText: 'Spring Run',
  status: 'active',
  visibility: 'public',
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('EventListComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        EventListComponent,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
        MatDialogModule,
      ],
      providers: [
        provideMockStore({
          initialState: { events: initialEventsState },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventListComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch loadEvents on init', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(EventsActions.loadEvents({}));
  });

  it('should filter events by status — active only', () => {
    const fixture = TestBed.createComponent(EventListComponent);
    const comp = fixture.componentInstance;
    store.setState({
      events: {
        ...initialEventsState,
        events: [
          mockEvent,
          { ...mockEvent, id: 'evt-2', status: 'archived' as const },
        ],
      },
    });
    fixture.detectChanges();
    comp.setFilter('active');
    expect(comp.filteredEvents.length).toBe(1);
    expect(comp.filteredEvents[0].status).toBe('active');
  });

  it('should filter events by status — archived only', () => {
    const fixture = TestBed.createComponent(EventListComponent);
    const comp = fixture.componentInstance;
    store.setState({
      events: {
        ...initialEventsState,
        events: [
          mockEvent,
          { ...mockEvent, id: 'evt-2', status: 'archived' as const },
        ],
      },
    });
    fixture.detectChanges();
    comp.setFilter('archived');
    expect(comp.filteredEvents.length).toBe(1);
    expect(comp.filteredEvents[0].status).toBe('archived');
  });

  it('should show all events when filter is "all"', () => {
    const fixture = TestBed.createComponent(EventListComponent);
    const comp = fixture.componentInstance;
    store.setState({
      events: {
        ...initialEventsState,
        events: [mockEvent, { ...mockEvent, id: 'evt-2', status: 'archived' as const }],
      },
    });
    fixture.detectChanges();
    comp.setFilter('all');
    expect(comp.filteredEvents.length).toBe(2);
  });

  it('should dispatch loadEvents with cursor on next page', () => {
    const fixture = TestBed.createComponent(EventListComponent);
    store.setState({ events: { ...initialEventsState, nextCursor: 'cursor-123' } });
    fixture.detectChanges();
    const dispatchSpy = spyOn(store, 'dispatch');
    fixture.componentInstance.onNextPage();
    expect(dispatchSpy).toHaveBeenCalledWith(EventsActions.loadEvents({ cursor: 'cursor-123' }));
  });
});
