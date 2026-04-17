import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { PhotoDetailComponent, PhotoDetailDialogData } from './photo-detail.component';
import { RunnerPhotosActions } from '../../../store/runner-photos/runner-photos.actions';
import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import { CartActions } from '../../../store/cart/cart.actions';

const dialogData: PhotoDetailDialogData = {
  photo: {
    photoId: 'photo-abc',
    watermarkedUrl: 'https://cdn.example.com/photo-abc.jpg',
    capturedAt: null,
  },
  pricePerPhoto: 14.99,
  currency: 'USD',
  eventId: 'event-1',
  eventName: 'Test Race 2026',
};

describe('PhotoDetailComponent', () => {
  let fixture: ComponentFixture<PhotoDetailComponent>;
  let component: PhotoDetailComponent;
  let store: MockStore;
  let dialogRef: { close: jasmine.Spy };

  beforeEach(async () => {
    dialogRef = { close: jasmine.createSpy('close') };

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, PhotoDetailComponent],
      providers: [
        provideMockStore(),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');

    fixture = TestBed.createComponent(PhotoDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the watermarked image', () => {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src).toContain('photo-abc.jpg');
  });

  it('renders price and currency', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('USD');
    expect(text).toContain('14.99');
  });

  it('shows broken_image placeholder after image error', () => {
    component.onImageError();
    fixture.detectChanges();
    const img = fixture.nativeElement.querySelector('img');
    expect(img).toBeNull();
    const placeholder: HTMLElement = fixture.nativeElement.querySelector(
      '.image-error-placeholder',
    );
    expect(placeholder).toBeTruthy();
  });

  it('closes dialog on close without dispatching deselectPhoto', () => {
    // deselectPhoto is dispatched by the parent EventSearchComponent's
    // afterClosed() subscription to avoid a double dispatch.
    component.onClose();
    expect(store.dispatch).not.toHaveBeenCalledWith(RunnerPhotosActions.deselectPhoto());
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it('dispatches addToCart and initiatePurchase on purchase', () => {
    component.onPurchase();
    expect(store.dispatch).toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[Cart] Add To Cart' }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      PurchasesActions.initiatePurchase({ photoIds: ['photo-abc'] }),
    );
  });
});
