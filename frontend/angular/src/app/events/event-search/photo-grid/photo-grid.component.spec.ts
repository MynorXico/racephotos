import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { RunnerPhotoGridComponent } from './photo-grid.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import { selectCartCount, selectCartPhotoIds } from '../../../store/cart/cart.selectors';

const photos: RunnerPhoto[] = [
  { photoId: 'p1', watermarkedUrl: 'https://cdn.example.com/p1.jpg', capturedAt: null },
  { photoId: 'p2', watermarkedUrl: 'https://cdn.example.com/p2.jpg', capturedAt: null },
];

describe('RunnerPhotoGridComponent', () => {
  let fixture: ComponentFixture<RunnerPhotoGridComponent>;
  let component: RunnerPhotoGridComponent;
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RunnerPhotoGridComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartCount, value: 0 },
            { selector: selectCartPhotoIds, value: [] },
          ],
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(RunnerPhotoGridComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('photos', photos);
    fixture.componentRef.setInput('pricePerPhoto', 9.99);
    fixture.componentRef.setInput('currency', 'EUR');
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('eventName', 'Test Race 2026');
    fixture.detectChanges();
  });

  it('renders one card per photo', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-runner-photo-card');
    expect(cards.length).toBe(2);
  });

  it('has role="list" on the grid container', () => {
    const grid: HTMLElement = fixture.nativeElement.querySelector('.photo-grid');
    expect(grid.getAttribute('role')).toBe('list');
  });

  it('sets aria-label with bib number when searchedBib is provided', () => {
    fixture.componentRef.setInput('searchedBib', '42');
    fixture.detectChanges();
    const grid: HTMLElement = fixture.nativeElement.querySelector('.photo-grid');
    expect(grid.getAttribute('aria-label')).toBe('Photos for bib 42');
  });

  it('re-emits photoSelected from child cards', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    component.photoSelected.emit('p1');
    expect(emitted).toContain('p1');
  });

  it('shows purchase toolbar when cart has items', () => {
    store.overrideSelector(selectCartCount, 2);
    store.refreshState();
    fixture.detectChanges();
    const toolbar: HTMLElement = fixture.nativeElement.querySelector('.selection-toolbar');
    expect(toolbar).toBeTruthy();
  });

  it('hides purchase toolbar when cart is empty', () => {
    const toolbar: HTMLElement = fixture.nativeElement.querySelector('.selection-toolbar');
    expect(toolbar).toBeNull();
  });
});
