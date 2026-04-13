import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-confirmation-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './confirmation-step.component.html',
  styleUrl: './confirmation-step.component.scss',
})
export class ConfirmationStepComponent {
  /** Masked email from the store (e.g. r***@gmail.com). */
  @Input() maskedEmail: string | null = null;

  /** Emitted when the runner clicks "Done". */
  @Output() purchaseDone = new EventEmitter<void>();

  onDone(): void {
    this.purchaseDone.emit();
  }
}
