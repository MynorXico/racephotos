import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

import { EventArchiveDialogComponent } from './event-archive-dialog.component';
import { initialEventsState } from '../../../../store/events/events.reducer';

describe('EventArchiveDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventArchiveDialogComponent, NoopAnimationsModule, MatDialogModule],
      providers: [
        provideMockStore({ initialState: { events: initialEventsState } }),
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MAT_DIALOG_DATA, useValue: { eventId: 'evt-1', eventName: 'Spring Run' } },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventArchiveDialogComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display event name from dialog data', () => {
    const fixture = TestBed.createComponent(EventArchiveDialogComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Spring Run');
  });

  it('should have eventId and eventName from injected data', () => {
    const fixture = TestBed.createComponent(EventArchiveDialogComponent);
    const comp = fixture.componentInstance;
    expect(comp.data.eventId).toBe('evt-1');
    expect(comp.data.eventName).toBe('Spring Run');
  });
});
