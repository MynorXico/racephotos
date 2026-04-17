import {
  Component,
  Inject,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Store } from '@ngrx/store';

import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import { CartActions, PhotoSummary } from '../../../store/cart/cart.actions';

export interface PhotoDetailDialogData {
  photo: RunnerPhoto;
  pricePerPhoto: number;
  currency: string;
  eventId: string;
  eventName: string;
}

@Component({
  selector: 'app-photo-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './photo-detail.component.html',
  styleUrl: './photo-detail.component.scss',
})
export class PhotoDetailComponent {
  readonly imageError = signal(false);

  constructor(
    @Inject(MAT_DIALOG_DATA) public readonly data: PhotoDetailDialogData,
    private readonly dialogRef: MatDialogRef<PhotoDetailComponent>,
    private readonly store: Store,
  ) {}

  onImageError(): void {
    this.imageError.set(true);
  }

  onClose(): void {
    // Close the dialog only — the parent EventSearchComponent's afterClosed()
    // subscription is solely responsible for dispatching deselectPhoto(), so
    // the action is not dispatched twice when the user presses the close button.
    this.dialogRef.close();
  }

  onPurchase(): void {
    const summary: PhotoSummary = {
      id: this.data.photo.photoId,
      eventId: this.data.eventId,
      eventName: this.data.eventName,
      watermarkedUrl: this.data.photo.watermarkedUrl,
      pricePerPhoto: this.data.pricePerPhoto,
      currency: this.data.currency,
    };
    this.store.dispatch(CartActions.addToCart({ photo: summary }));
    this.store.dispatch(PurchasesActions.initiatePurchase({ photoIds: [this.data.photo.photoId] }));
  }
}
