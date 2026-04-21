import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Title } from '@angular/platform-browser';

import { EventsListPageComponent } from './events-list-page.component';
import { PublicEventsActions } from '../../store/events/events.actions';
import {
  selectPublicEvents,
  selectPublicEventsLoading,
  selectPublicEventsError,
  selectHasMorePublicEvents,
  selectPublicNextCursor,
} from '../../store/events/events.selectors';
import { PublicEvent } from '../../features/photographer/events/event.model';

const mockEvents: PublicEvent[] = [
  { id: 'evt-1', name: 'Run A', date: '2026-05-01', location: 'City A', createdAt: '2026-05-01T00:00:00Z' },
  { id: 'evt-2', name: 'Run B', date: '2026-04-01', location: 'City B', createdAt: '2026-04-01T00:00:00Z' },
];

describe('EventsListPageComponent', () => {
  let component: EventsListPageComponent;
  let fixture: ComponentFixture<EventsListPageComponent>;
  let store: MockStore;
  let titleService: Title;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventsListPageComponent],
      providers: [
        provideAnimationsAsync(),
        provideRouter([]),
        provideMockStore({
          selectors: [
            { selector: selectPublicEvents, value: [] },
            { selector: selectPublicEventsLoading, value: false },
            { selector: selectPublicEventsError, value: null },
            { selector: selectHasMorePublicEvents, value: false },
            { selector: selectPublicNextCursor, value: null },
          ],
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    titleService = TestBed.inject(Title);
    fixture = TestBed.createComponent(EventsListPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => store.resetSelectors());

  it('dispatches listPublicEvents on init (AC5)', () => {
    const dispatched = jasmine.createSpy();
    store.dispatch = dispatched;
    component.ngOnInit();
    expect(dispatched).toHaveBeenCalledWith(PublicEventsActions.listPublicEvents({}));
  });

  it('sets page title on init', () => {
    expect(titleService.getTitle()).toBe('RaceShots — Find your race photos');
  });

  it('shows skeleton cards while loading (no events yet)', () => {
    store.overrideSelector(selectPublicEventsLoading, true);
    store.overrideSelector(selectPublicEvents, []);
    store.refreshState();
    fixture.detectChanges();

    const skeletons = fixture.nativeElement.querySelectorAll('.skeleton-card');
    expect(skeletons.length).toBe(6);
  });

  it('shows event cards when loaded (AC5)', () => {
    store.overrideSelector(selectPublicEvents, mockEvents);
    store.refreshState();
    fixture.detectChanges();

    const cards = fixture.debugElement.queryAll(By.css('app-event-card'));
    expect(cards.length).toBe(2);
  });

  it('AC7 — shows empty state when no events', () => {
    store.overrideSelector(selectPublicEvents, []);
    store.overrideSelector(selectPublicEventsLoading, false);
    store.refreshState();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('No events listed yet.');
    expect(text).toContain('Check back soon.');
  });

  it('shows error state on initial load failure', () => {
    store.overrideSelector(selectPublicEvents, []);
    store.overrideSelector(selectPublicEventsError, 'Failed to load events');
    store.refreshState();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Unable to load events.');
  });

  it('AC6 — shows Load more button when hasMore is true', () => {
    store.overrideSelector(selectPublicEvents, mockEvents);
    store.overrideSelector(selectHasMorePublicEvents, true);
    store.overrideSelector(selectPublicNextCursor, 'cursor-xyz');
    store.refreshState();
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.load-more-btn');
    expect(btn).toBeTruthy();
  });

  it('AC6 — Load more dispatches listPublicEvents with cursor', () => {
    store.overrideSelector(selectPublicEvents, mockEvents);
    store.overrideSelector(selectHasMorePublicEvents, true);
    store.overrideSelector(selectPublicNextCursor, 'cursor-xyz');
    store.refreshState();
    fixture.detectChanges();

    const dispatched = jasmine.createSpy();
    store.dispatch = dispatched;

    component.onLoadMore();
    expect(dispatched).toHaveBeenCalledWith(
      PublicEventsActions.listPublicEvents({ cursor: 'cursor-xyz' }),
    );
  });

  it('AC8 — card click navigates to /events/{id}', () => {
    store.overrideSelector(selectPublicEvents, mockEvents);
    store.refreshState();
    fixture.detectChanges();

    const navigateSpy = spyOn(component['router'], 'navigate').and.returnValue(Promise.resolve(true));
    component.onCardClick('evt-1');
    expect(navigateSpy).toHaveBeenCalledWith(['/events', 'evt-1']);
  });

  it('hides Load more button when hasMore is false', () => {
    store.overrideSelector(selectPublicEvents, mockEvents);
    store.overrideSelector(selectHasMorePublicEvents, false);
    store.refreshState();
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.load-more-btn');
    expect(btn).toBeFalsy();
  });

  it('has Photographer login link in header (UX-D8)', () => {
    const link = fixture.nativeElement.querySelector('[routerLink="/login"]');
    expect(link).toBeTruthy();
  });
});
