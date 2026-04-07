import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { EventCreateComponent } from './event-create.component';
import { EventsActions } from '../../../../store/events/events.actions';
import { initialEventsState } from '../../../../store/events/events.reducer';
import { initialPhotographerState } from '../../../../store/photographer/photographer.state';

describe('EventCreateComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        EventCreateComponent,
        RouterTestingModule,
        NoopAnimationsModule,
        MatSnackBarModule,
      ],
      providers: [
        provideMockStore({
          initialState: {
            events: initialEventsState,
            photographer: initialPhotographerState,
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should have an invalid form when required fields are empty', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.form.invalid).toBeTrue();
  });

  it('should not dispatch when form is invalid', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    fixture.detectChanges();
    const dispatchSpy = spyOn(store, 'dispatch');
    fixture.componentInstance.onSubmit();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Events] Create Event' }),
    );
  });

  it('should dispatch createEvent when form is valid', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.form.setValue({
      name: 'Test Event',
      date: new Date('2026-06-01'),
      location: 'Test City',
      pricePerPhoto: 10,
      currency: 'USD',
      watermarkText: '',
    });

    const dispatchSpy = spyOn(store, 'dispatch');
    comp.onSubmit();
    expect(dispatchSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Events] Create Event' }),
    );
  });

  it('should compute watermark hint from name field', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ name: 'My Race' });
    expect(comp.watermarkHint).toContain('My Race');
    expect(comp.watermarkHint).toContain('racephotos.example.com');
  });

  it('should show placeholder when name is empty', () => {
    const fixture = TestBed.createComponent(EventCreateComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.form.patchValue({ name: '' });
    expect(comp.watermarkHint).toContain('{Event name}');
  });
});
