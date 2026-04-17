import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { EventEmitter } from '@angular/core';

import { CartReviewStepComponent } from './cart-review-step.component';
import { PhotoSummary } from '../../../../store/cart/cart.actions';
import {
  selectCartPhotos,
  selectCartTotal,
  selectCartCurrency,
} from '../../../../store/cart/cart.selectors';

const photoA: PhotoSummary = {
  id: 'photo-a',
  eventId: 'event-1',
  eventName: 'Race 2026',
  watermarkedUrl: 'https://cdn.example.com/a.jpg',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const photoB: PhotoSummary = {
  id: 'photo-b',
  eventId: 'event-1',
  eventName: 'Race 2026',
  watermarkedUrl: 'https://cdn.example.com/b.jpg',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

describe('CartReviewStepComponent', () => {
  let component: CartReviewStepComponent;
  let fixture: ComponentFixture<CartReviewStepComponent>;
  let store: MockStore;

  const cases = [
    {
      label: 'renders a single photo',
      photos: [photoA],
      total: 75,
      currency: 'GTQ',
      expectedItems: 1,
      expectedTotal: '75',
    },
    {
      label: 'renders multiple photos and correct total',
      photos: [photoA, photoB],
      total: 150,
      currency: 'GTQ',
      expectedItems: 2,
      expectedTotal: '150',
    },
    {
      label: 'renders empty state defensively',
      photos: [],
      total: 0,
      currency: null,
      expectedItems: 0,
      expectedTotal: null,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, CartReviewStepComponent],
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectCartPhotos, value: [photoA] },
            { selector: selectCartTotal, value: 75 },
            { selector: selectCartCurrency, value: 'GTQ' },
          ],
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(CartReviewStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  cases.forEach(({ label, photos, total, currency, expectedItems }) => {
    it(label, () => {
      store.overrideSelector(selectCartPhotos, photos);
      store.overrideSelector(selectCartTotal, total);
      store.overrideSelector(selectCartCurrency, currency);
      store.refreshState();
      fixture.detectChanges();

      const items = fixture.nativeElement.querySelectorAll('.cart-item');
      expect(items.length).toBe(expectedItems);
    });
  });

  it('emits editCart when "Edit cart" button is clicked', () => {
    let count = 0;
    component.editCart.subscribe(() => count++);
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="edit-cart-btn"]');
    expect(btn).toBeTruthy();
    btn.click();
    expect(count).toBe(1);
  });

  it('emits continue when "Continue to checkout" button is clicked', () => {
    let count = 0;
    component.continue.subscribe(() => count++);
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="continue-btn"]');
    expect(btn).toBeTruthy();
    btn.click();
    expect(count).toBe(1);
  });
});
