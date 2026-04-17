import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  signal,
  computed,
  ViewChild,
  TemplateRef,
  inject,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule, MatCheckboxChange } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import { CartActions, PhotoSummary } from '../../../store/cart/cart.actions';
import {
  selectCartPhotoIds,
  selectCartEventId,
  selectCartCount,
  selectCartFull,
} from '../../../store/cart/cart.selectors';

@Component({
  selector: 'app-runner-photo-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'listitem',
    tabindex: '0',
    '(click)': 'onCardClick()',
    '(keydown.enter)': 'onCardClick()',
    '(keydown.space)': 'onCardClick()',
  },
  imports: [
    MatCardModule,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule,
  ],
  templateUrl: './photo-card.component.html',
  styleUrl: './photo-card.component.scss',
})
export class RunnerPhotoCardComponent {
  @Input({ required: true }) photo!: RunnerPhoto;
  @Input({ required: true }) pricePerPhoto!: number;
  @Input({ required: true }) currency!: string;
  @Input({ required: true }) eventId!: string;
  @Input({ required: true }) eventName!: string;
  @Input() searchedBib = '';

  @Output() photoSelected = new EventEmitter<string>();

  @ViewChild('crossEventConfirm') crossEventConfirmRef!: TemplateRef<unknown>;

  readonly imageError = signal(false);

  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);

  private readonly cartPhotoIds = toSignal(this.store.select(selectCartPhotoIds), {
    initialValue: [] as string[],
  });
  readonly cartFull = toSignal(this.store.select(selectCartFull), { initialValue: false });
  readonly cartEventId = toSignal(this.store.select(selectCartEventId), { initialValue: null });
  readonly cartCount = toSignal(this.store.select(selectCartCount), { initialValue: 0 });

  /** True when this photo is currently in the cart. */
  readonly isInCart = computed(() => this.cartPhotoIds().includes(this.photo?.photoId ?? ''));

  /** True when the checkbox should be disabled (cart full and not already selected). */
  readonly checkboxDisabled = computed(() => this.cartFull() && !this.isInCart());

  get tooltipText(): string {
    return this.checkboxDisabled() ? 'Maximum 20 photos per order' : '';
  }

  get checkboxAriaLabel(): string {
    if (this.checkboxDisabled()) {
      return `Select photo from ${this.eventName} — maximum 20 photos per order`;
    }
    return `Select photo from ${this.eventName}`;
  }

  onImageError(): void {
    this.imageError.set(true);
  }

  onCardClick(): void {
    this.photoSelected.emit(this.photo.photoId);
  }

  onCheckboxChange(event: MatCheckboxChange): void {
    if (event.checked) {
      this.addPhoto();
    } else {
      this.store.dispatch(CartActions.removeFromCart({ photoId: this.photo.photoId }));
    }
  }

  private addPhoto(): void {
    const cartEventId = this.cartEventId();
    if (cartEventId !== null && cartEventId !== this.eventId) {
      const ref = this.dialog.open(this.crossEventConfirmRef, {
        width: '360px',
        maxWidth: '95vw',
        disableClose: true,
      });
      ref.afterClosed().subscribe((confirmed: boolean) => {
        if (confirmed) {
          this.store.dispatch(CartActions.replaceCart({ photo: this.buildSummary() }));
        }
        // If cancelled: no action — store state drives checkbox back to unchecked
      });
    } else {
      this.store.dispatch(CartActions.addToCart({ photo: this.buildSummary() }));
    }
  }

  private buildSummary(): PhotoSummary {
    return {
      id: this.photo.photoId,
      eventId: this.eventId,
      eventName: this.eventName,
      watermarkedUrl: this.photo.watermarkedUrl,
      pricePerPhoto: this.pricePerPhoto,
      currency: this.currency,
    };
  }

  get altText(): string {
    return this.searchedBib ? `Race photo for bib ${this.searchedBib}` : 'Race photo';
  }
}
