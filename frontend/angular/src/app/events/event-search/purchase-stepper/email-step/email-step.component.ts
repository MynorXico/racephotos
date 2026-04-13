import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-email-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './email-step.component.html',
  styleUrl: './email-step.component.scss',
})
export class EmailStepComponent implements OnChanges {
  /** Whether the POST /orders call is in-flight. */
  @Input() loading = false;
  /** API error message from the store, or null. */
  @Input() error: string | null = null;
  /** Masked email derived from the store (updated after submitEmail is dispatched). */
  @Input() maskedEmail: string | null = null;

  /** Emitted when the runner confirms their email. */
  @Output() emailConfirmed = new EventEmitter<string>();
  /** Emitted when the runner clicks "Try again". */
  @Output() errorDismissed = new EventEmitter<void>();

  readonly emailControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });

  get showPreview(): boolean {
    return this.emailControl.valid && (this.emailControl.dirty || this.emailControl.touched);
  }

  ngOnChanges(): void {
    if (this.loading) {
      this.emailControl.disable();
    } else {
      this.emailControl.enable();
    }
  }

  onConfirm(): void {
    this.emailControl.markAsTouched();
    if (this.emailControl.invalid || this.loading) return;
    this.emailConfirmed.emit(this.emailControl.value);
  }

  onTryAgain(): void {
    this.errorDismissed.emit();
    this.emailControl.enable();
  }
}
