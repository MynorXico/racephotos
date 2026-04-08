import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { EventEditComponent } from './event-edit.component';
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

describe('EventEditComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        EventEditComponent,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
      ],
      providers: [
        provideMockStore({
          initialState: { events: { ...initialEventsState, selectedEvent: mockEvent } },
        }),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['id', 'evt-1']])) },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventEditComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should patch form from selectedEvent on init', () => {
    const fixture = TestBed.createComponent(EventEditComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.form.get('name')?.value).toBe('Spring Run');
    expect(comp.form.get('location')?.value).toBe('Central Park');
    expect(comp.form.get('currency')?.value).toBe('USD');
  });

  it('should dispatch updateEvent on valid submit', () => {
    const fixture = TestBed.createComponent(EventEditComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSubmit();
    expect(dispatchSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Events] Update Event' }),
    );
  });

  it('should not dispatch when form is invalid', () => {
    const fixture = TestBed.createComponent(EventEditComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ name: '' });
    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSubmit();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Events] Update Event' }),
    );
  });

  it('should dispatch loadEvent when event not in store', () => {
    store.setState({ events: initialEventsState });
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventEditComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(EventsActions.loadEvent({ id: 'evt-1' }));
  });
});
