import {
  Component,
  Input,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Photo } from '../../../../store/photos/photos.actions';
import { PhotoStatusBadgePipe } from '../photo-status-badge.pipe';

@Component({
  selector: 'app-photo-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' },
  imports: [
    NgClass,
    DatePipe,
    MatCardModule,
    MatIconModule,
    MatIconButton,
    MatTooltipModule,
    PhotoStatusBadgePipe,
  ],
  templateUrl: './photo-card.component.html',
  styleUrl: './photo-card.component.scss',
})
export class PhotoCardComponent {
  @Input({ required: true }) photo!: Photo;

  readonly imageError = signal(false);

  onImageError(): void {
    this.imageError.set(true);
  }

  get errorTooltip(): string {
    return this.photo.errorReason ?? 'No error details available.';
  }

  get bibLabel(): string {
    return this.photo.bibNumbers.length > 0
      ? this.photo.bibNumbers.join(', ')
      : '';
  }
}
