import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';

import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { ApprovalsTabComponent } from './approvals-tab/approvals-tab.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [MatTabsModule, ApprovalsTabComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  private readonly titleService = inject(NavigationTitleService);

  ngOnInit(): void {
    this.titleService.setTitle('Dashboard');
  }
}
