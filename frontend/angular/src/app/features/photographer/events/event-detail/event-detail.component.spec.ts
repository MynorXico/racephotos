import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';
import { of } from 'rxjs';

import { EventDetailComponent } from './event-detail.component';
import { EventsActions } from '../../../../store/events/events.actions';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { AppConfigService } from '../../../../core/config/app-config.service';
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

describe('EventDetailComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        EventDetailComponent,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
        MatDialogModule,
      ],
      providers: [
        provideMockStore({ initialState: { events: initialEventsState } }),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(new Map([['id', 'evt-1']])),
          },
        },
        {
          provide: AppConfigService,
          useValue: { get: () => ({ apiBaseUrl: 'http://api.test', publicBaseUrl: 'http://test.example.com' }) },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventDetailComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch loadEvent on init with route id', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventDetailComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(EventsActions.loadEvent({ id: 'evt-1' }));
  });

  it('should return publicUrl from config', () => {
    const fixture = TestBed.createComponent(EventDetailComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    // eventId is set by route subscription in ngOnInit
    expect(comp.publicUrl).toContain('http://test.example.com/events/evt-1');
  });

  it('should show event details when selectedEvent is populated', () => {
    store.setState({ events: { ...initialEventsState, selectedEvent: mockEvent } });
    const fixture = TestBed.createComponent(EventDetailComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.selectedEvent()).toEqual(mockEvent);
  });
});
