import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatTabsModule } from '@angular/material/tabs';
import { toSignal } from '@angular/core/rxjs-interop';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { EventsActions } from '../../../store/events/events.actions';
import { selectSelectedEvent } from '../../../store/events/events.selectors';
import { ApprovalsTabComponent } from './approvals-tab/approvals-tab.component';
import { ReviewQueueComponent } from './review/review-queue.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [MatTabsModule, ApprovalsTabComponent, ReviewQueueComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly titleService = inject(NavigationTitleService);

  private readonly selectedEvent = toSignal(this.store.select(selectSelectedEvent), {
    initialValue: null,
  });

  ngOnInit(): void {
    this.titleService.setTitle('Dashboard');
    if (!this.selectedEvent()) {
      this.store.dispatch(EventsActions.loadEvents({}));
    }
  }
}
