import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatCheckboxChange } from '@angular/material/checkbox';
import { provideMockStore, MockStore } from '@ngrx/store/testing';

import { RunnerPhotoCardComponent } from './photo-card.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import {
  selectCartPhotoIds,
  selectCartEventId,
  selectCartCount,
  selectCartFull,
} from '../../../store/cart/cart.selectors';

const basePhoto: RunnerPhoto = {
  photoId: 'photo-1',
  watermarkedUrl: 'https://cdn.example.com/photo-1.jpg',
  capturedAt: '2026-04-01T10:00:00Z',
};

describe('RunnerPhotoCardComponent', () => {
  let fixture: ComponentFixture<RunnerPhotoCardComponent>;
  let component: RunnerPhotoCardComponent;
  let store: MockStore;

  function setDefaultInputs(): void {
    fixture.componentRef.setInput('photo', basePhoto);
    fixture.componentRef.setInput('pricePerPhoto', 12.99);
    fixture.componentRef.setInput('currency', 'USD');
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('eventName', 'Test Race 2026');
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RunnerPhotoCardComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotoIds, value: [] },
            { selector: selectCartEventId, value: null },
            { selector: selectCartCount, value: 0 },
            { selector: selectCartFull, value: false },
          ],
        }),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(RunnerPhotoCardComponent);
    component = fixture.componentInstance;
    setDefaultInputs();
    fixture.detectChanges();
  });

  it('renders the watermarked thumbnail', () => {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo-1.jpg');
  });

  it('shows broken_image placeholder after image load error', () => {
    component.onImageError();
    fixture.detectChanges();
    const placeholder: HTMLElement =
      fixture.nativeElement.querySelector('.thumbnail-placeholder');
    expect(placeholder).toBeTruthy();
  });

  it('hides the img element after image load error', () => {
    component.onImageError();
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeNull();
  });

  it('renders the event name in the footer', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Test Race 2026');
  });

  it('builds correct altText when searchedBib is set', () => {
    fixture.componentRef.setInput('searchedBib', '101');
    expect(component.altText).toBe('Race photo for bib 101');
  });

  it('builds generic altText when searchedBib is empty', () => {
    expect(component.altText).toBe('Race photo');
  });

  it('emits photoSelected on card click', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    component.onCardClick();
    expect(emitted).toEqual(['photo-1']);
  });

  it('emits photoSelected on Enter key via host binding', () => {
    const emitted: string[] = [];
    component.photoSelected.subscribe((id) => emitted.push(id));
    fixture.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(emitted).toEqual(['photo-1']);
  });

  it('isInCart is false when photo not in cart', () => {
    expect(component.isInCart()).toBeFalse();
  });

  it('isInCart is true when photo is in cart', () => {
    store.overrideSelector(selectCartPhotoIds, ['photo-1']);
    store.refreshState();
    fixture.detectChanges();
    expect(component.isInCart()).toBeTrue();
  });

  it('checkboxDisabled is false when cart not full', () => {
    expect(component.checkboxDisabled()).toBeFalse();
  });

  it('checkboxDisabled is true when cart is full and photo not in cart', () => {
    store.overrideSelector(selectCartFull, true);
    store.overrideSelector(selectCartPhotoIds, []);
    store.refreshState();
    fixture.detectChanges();
    expect(component.checkboxDisabled()).toBeTrue();
  });

  it('dispatches removeFromCart when checkbox is unchecked', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    store.overrideSelector(selectCartPhotoIds, ['photo-1']);
    store.refreshState();
    fixture.detectChanges();
    component.onCheckboxChange({ checked: false } as MatCheckboxChange);
    expect(dispatchSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Cart] Remove From Cart', photoId: 'photo-1' }),
    );
  });

  it('dispatches addToCart when checkbox is checked and cart is empty', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    component.onCheckboxChange({ checked: true } as MatCheckboxChange);
    expect(dispatchSpy).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Cart] Add To Cart' }),
    );
  });
});
