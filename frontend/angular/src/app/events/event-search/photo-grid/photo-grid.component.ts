import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';

import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';
import { RunnerPhotoCardComponent } from '../photo-card/photo-card.component';

@Component({
  selector: 'app-runner-photo-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RunnerPhotoCardComponent],
  templateUrl: './photo-grid.component.html',
  styleUrl: './photo-grid.component.scss',
})
export class RunnerPhotoGridComponent {
  @Input({ required: true }) photos!: RunnerPhoto[];
  @Input({ required: true }) pricePerPhoto!: number;
  @Input({ required: true }) currency!: string;
  @Input() searchedBib = '';

  @Output() photoSelected = new EventEmitter<string>();
}
