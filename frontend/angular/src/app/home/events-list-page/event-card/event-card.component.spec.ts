import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { EventCardComponent } from './event-card.component';
import { PublicEvent } from '../../../features/photographer/events/event.model';

const mockEvent: PublicEvent = {
  id: 'evt-001',
  name: 'Spring Marathon 2026',
  date: '2026-05-01',
  location: 'City Park, Springfield',
  createdAt: '2026-04-01T10:00:00Z',
};

describe('EventCardComponent', () => {
  let component: EventCardComponent;
  let fixture: ComponentFixture<EventCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventCardComponent],
      providers: [provideAnimationsAsync()],
    }).compileComponents();

    fixture = TestBed.createComponent(EventCardComponent);
    component = fixture.componentInstance;
    component.event = mockEvent;
    fixture.detectChanges();
  });

  it('renders event name', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Spring Marathon 2026');
  });

  it('renders event location', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('City Park, Springfield');
  });

  it('renders "Search photos" button', () => {
    const btn = fixture.debugElement.query(By.css('[mat-flat-button]'));
    expect(btn).toBeTruthy();
  });

  it('emits cardClick with event id when host is clicked (AC8)', () => {
    let emitted: string | undefined;
    component.cardClick.subscribe((id: string) => (emitted = id));

    (fixture.nativeElement as HTMLElement).click();
    expect(emitted).toBe('evt-001');
  });

  it('emits cardClick when Search photos button is clicked', () => {
    let emitted: string | undefined;
    component.cardClick.subscribe((id: string) => (emitted = id));

    const btn = fixture.debugElement.query(By.css('[mat-flat-button]'));
    (btn.nativeElement as HTMLElement).click();
    expect(emitted).toBe('evt-001');
  });

  it('has role=listitem on host element', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('listitem');
  });

  it('has tabindex=0 on host element for keyboard access', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('tabindex')).toBe('0');
  });

  it('search button aria-label identifies the event name', () => {
    const btn = fixture.debugElement.query(By.css('[mat-flat-button]'));
    const label = (btn.nativeElement as HTMLElement).getAttribute('aria-label');
    expect(label).toContain('Spring Marathon 2026');
  });
});
