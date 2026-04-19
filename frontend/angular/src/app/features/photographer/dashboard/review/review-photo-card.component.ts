import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { ReviewPhoto, ReviewQueueActions } from '../../../../store/review-queue/review-queue.actions';
import {
  selectSaveErrorMap,
  selectSaveLoadingMap,
} from '../../../../store/review-queue/review-queue.selectors';
import { BibTagInputComponent } from './bib-tag-input.component';

@Component({
  selector: 'app-review-photo-card',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    BibTagInputComponent,
  ],
  templateUrl: './review-photo-card.component.html',
  styleUrl: './review-photo-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPhotoCardComponent {
  @Input({ required: true }) photo!: ReviewPhoto;

  private readonly store = inject(Store);

  private readonly saveLoadingMap = toSignal(this.store.select(selectSaveLoadingMap), {
    initialValue: {} as Record<string, boolean>,
  });
  private readonly saveErrorMap = toSignal(this.store.select(selectSaveErrorMap), {
    initialValue: {} as Record<string, string | null>,
  });

  readonly pendingBibs = signal<string[]>([]);
  readonly imageError = signal(false);

  get saving(): boolean {
    return this.saveLoadingMap()[this.photo.id] ?? false;
  }

  get saveError(): string | null {
    return this.saveErrorMap()[this.photo.id] ?? null;
  }

  get isSaveDisabled(): boolean {
    return this.pendingBibs().length === 0 && this.photo.bibNumbers.length === 0;
  }

  onBibsChanged(bibs: string[]): void {
    this.pendingBibs.set(bibs);
  }

  onSave(): void {
    this.store.dispatch(
      ReviewQueueActions.savePhotoBibs({
        photoId: this.photo.id,
        bibNumbers: this.pendingBibs(),
      }),
    );
  }

  onImageError(): void {
    this.imageError.set(true);
  }
}
