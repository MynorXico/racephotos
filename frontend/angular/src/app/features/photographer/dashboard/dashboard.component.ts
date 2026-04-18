import { Component, inject, OnInit } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTabsModule } from '@angular/material/tabs';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { selectPendingPurchases } from '../../../store/approvals/approvals.selectors';
import { ApprovalsTabComponent } from './approvals-tab/approvals-tab.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [MatBadgeModule, MatTabsModule, ApprovalsTabComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly titleService = inject(NavigationTitleService);

  readonly pendingCount = toSignal(
    this.store.select(selectPendingPurchases).pipe(map((purchases) => purchases.length)),
    { initialValue: 0 },
  );

  ngOnInit(): void {
    this.titleService.setTitle('Dashboard');
  }
}
