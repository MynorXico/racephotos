import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { MatChipGrid, MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { COMMA, ENTER } from '@angular/cdk/keycodes';

@Component({
  selector: 'app-bib-tag-input',
  standalone: true,
  imports: [MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './bib-tag-input.component.html',
  styleUrl: './bib-tag-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BibTagInputComponent implements OnChanges {
  @Input() initialBibs: string[] = [];
  @Input() disabled = false;

  @Output() bibsChanged = new EventEmitter<string[]>();

  @ViewChild(MatChipGrid) chipGrid!: MatChipGrid;

  readonly separatorKeysCodes = [ENTER, COMMA];

  readonly bibs = signal<string[]>([]);
  readonly validationError = signal<string | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialBibs']) {
      this.bibs.set([...(this.initialBibs ?? [])]);
    }
  }

  addBib(event: MatChipInputEvent): void {
    const value = (event.value ?? '').trim().replace(/,$/, '').trim();
    event.chipInput.clear();

    if (!value) {
      return;
    }

    const error = this.validate(value);
    if (error) {
      this.validationError.set(error);
      return;
    }

    this.validationError.set(null);
    const updated = [...this.bibs(), value];
    this.bibs.set(updated);
    this.bibsChanged.emit(updated);
  }

  removeBib(bib: string): void {
    const updated = this.bibs().filter((b) => b !== bib);
    this.bibs.set(updated);
    this.validationError.set(null);
    this.bibsChanged.emit(updated);
  }

  onInputChange(): void {
    this.validationError.set(null);
  }

  private validate(value: string): string | null {
    if (this.bibs().includes(value)) {
      return `Bib ${value} is already added.`;
    }
    if (!/^\d+$/.test(value)) {
      return 'Bib numbers must contain digits only.';
    }
    if (value.length > 10) {
      return 'Bib number is too long.';
    }
    return null;
  }
}
