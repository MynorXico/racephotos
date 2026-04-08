import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogModule,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { selectEventsLoading } from '../../../../store/events/events.selectors';

export interface ArchiveDialogData {
  eventId: string;
  eventName: string;
}

@Component({
  selector: 'app-event-archive-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './event-archive-dialog.component.html',
})
export class EventArchiveDialogComponent {
  readonly dialogRef = inject<MatDialogRef<EventArchiveDialogComponent>>(MatDialogRef);
  readonly data = inject<ArchiveDialogData>(MAT_DIALOG_DATA);
  private readonly store = inject(Store);

  readonly loading = toSignal(this.store.select(selectEventsLoading), { initialValue: false });
}
