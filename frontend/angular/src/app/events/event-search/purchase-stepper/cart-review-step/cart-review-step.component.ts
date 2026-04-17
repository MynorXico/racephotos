import {
  Component,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  selectCartPhotos,
  selectCartTotal,
  selectCartCurrency,
} from '../../../../store/cart/cart.selectors';

@Component({
  selector: 'app-cart-review-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, MatButtonModule, MatDividerModule, MatIconModule],
  templateUrl: './cart-review-step.component.html',
  styleUrl: './cart-review-step.component.scss',
})
export class CartReviewStepComponent {
  /** Emitted when runner clicks "Edit cart" — parent closes stepper without clearing cart. */
  @Output() editCart = new EventEmitter<void>();
  /** Emitted when runner clicks "Continue to checkout" — parent advances stepper. */
  @Output() continue = new EventEmitter<void>();

  private readonly store = inject(Store);

  readonly photos = toSignal(this.store.select(selectCartPhotos), { initialValue: [] });
  readonly total = toSignal(this.store.select(selectCartTotal), { initialValue: 0 });
  readonly currency = toSignal(this.store.select(selectCartCurrency), { initialValue: null });

  onEditCart(): void {
    this.editCart.emit();
  }

  onContinue(): void {
    this.continue.emit();
  }
}
