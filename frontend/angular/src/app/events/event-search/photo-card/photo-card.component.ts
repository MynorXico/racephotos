import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';

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
  imports: [MatCardModule, MatButtonModule, MatIconModule],
  templateUrl: './photo-card.component.html',
  styleUrl: './photo-card.component.scss',
})
export class RunnerPhotoCardComponent {
  @Input({ required: true }) photo!: RunnerPhoto;
  @Input({ required: true }) pricePerPhoto!: number;
  @Input({ required: true }) currency!: string;
  @Input() searchedBib = '';

  @Output() photoSelected = new EventEmitter<string>();

  readonly imageError = signal(false);

  onImageError(): void {
    this.imageError.set(true);
  }

  onCardClick(): void {
    this.photoSelected.emit(this.photo.photoId);
  }

  get altText(): string {
    return this.searchedBib ? `Race photo for bib ${this.searchedBib}` : 'Race photo';
  }
}
