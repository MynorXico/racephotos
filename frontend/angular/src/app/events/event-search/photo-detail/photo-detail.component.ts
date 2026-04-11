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
import { RunnerPhotosActions } from '../../../store/runner-photos/runner-photos.actions';
import { PurchasesActions } from '../../../store/purchases/purchases.actions';

export interface PhotoDetailDialogData {
  photo: RunnerPhoto;
  pricePerPhoto: number;
  currency: string;
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
    this.store.dispatch(RunnerPhotosActions.deselectPhoto());
    this.dialogRef.close();
  }

  onPurchase(): void {
    this.store.dispatch(PurchasesActions.initiatePurchase({ photoId: this.data.photo.photoId }));
  }
}
