import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import { PurchasesActions } from '../../../store/purchases/purchases.actions';
import {
  selectCartCount,
  selectCartPhotoIds,
} from '../../../store/cart/cart.selectors';
import { RunnerPhotoCardComponent } from '../photo-card/photo-card.component';

@Component({
  selector: 'app-runner-photo-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, RunnerPhotoCardComponent],
  templateUrl: './photo-grid.component.html',
  styleUrl: './photo-grid.component.scss',
})
export class RunnerPhotoGridComponent {
  @Input({ required: true }) photos!: RunnerPhoto[];
  @Input({ required: true }) pricePerPhoto!: number;
  @Input({ required: true }) currency!: string;
  @Input({ required: true }) eventId!: string;
  @Input({ required: true }) eventName!: string;
  @Input() searchedBib = '';

  @Output() photoSelected = new EventEmitter<string>();

  private readonly store = inject(Store);

  readonly cartCount = toSignal(this.store.select(selectCartCount), { initialValue: 0 });
  private readonly cartPhotoIds = toSignal(this.store.select(selectCartPhotoIds), {
    initialValue: [] as string[],
  });

  onPurchase(): void {
    const photoIds = this.cartPhotoIds();
    if (photoIds.length > 0) {
      this.store.dispatch(PurchasesActions.initiatePurchase({ photoIds }));
    }
  }
}
