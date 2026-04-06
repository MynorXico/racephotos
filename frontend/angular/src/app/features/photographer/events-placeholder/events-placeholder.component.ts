import { Component, inject, OnInit } from '@angular/core';
import { NavigationTitleService } from '../../../core/services/navigation-title.service';

/**
 * EventsPlaceholderComponent — placeholder for the My Events page.
 * Replaced in a later story with the real events list.
 */
@Component({
  selector: 'app-events-placeholder',
  standalone: true,
  template: `
    <div class="placeholder-content">
      <p>My Events — coming soon.</p>
    </div>
  `,
  styles: [
    `
      .placeholder-content {
        padding: 24px;
        color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class EventsPlaceholderComponent implements OnInit {
  private readonly titleService = inject(NavigationTitleService);

  ngOnInit(): void {
    this.titleService.setTitle('My Events');
  }
}
