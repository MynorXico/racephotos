import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { Component } from '@angular/core';
import { NgClass } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { PhotoStatusBadgePipe, BadgeConfig } from './photo-status-badge.pipe';

@Component({
  standalone: true,
  imports: [NgClass, MatIconModule, PhotoStatusBadgePipe],
  template: `
    <div style="display:flex;gap:12px;flex-wrap:wrap;padding:16px;">
      @for (status of statuses; track status) {
        @let badge = status | photoStatusBadge;
        <span class="status-badge" [ngClass]="badge.cssClass">
          <mat-icon style="font-size:14px;width:14px;height:14px;">{{ badge.icon }}</mat-icon>
          {{ badge.label }}
        </span>
      }
    </div>
  `,
  styles: [`
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge--indexed   { background: #e8f5e9; color: #1b5e20; }
    .badge--review    { background: #fff3e0; color: #e65100; }
    .badge--error     { background: #fce4ec; color: #b71c1c; }
    .badge--processing { background: #f5f5f5; color: #424242; }
  `],
})
class BadgeShowcaseComponent {
  readonly statuses = ['indexed', 'review_required', 'error', 'processing'];
}

const meta: Meta<BadgeShowcaseComponent> = {
  title: 'Photographer/Event Photos/PhotoStatusBadgePipe',
  component: BadgeShowcaseComponent,
  decorators: [moduleMetadata({ imports: [BadgeShowcaseComponent] })],
};
export default meta;

export const AllStatuses: StoryObj<BadgeShowcaseComponent> = {
  name: 'All statuses',
};
