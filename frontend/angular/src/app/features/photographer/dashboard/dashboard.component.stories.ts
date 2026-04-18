import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';

import { DashboardComponent } from './dashboard.component';
import { initialApprovalsState } from '../../../store/approvals/approvals.reducer';
import { PendingPurchase } from '../../../store/approvals/approvals.actions';

const makePurchase = (id: string): PendingPurchase => ({
  purchaseId: id,
  photoId: `photo-${id}`,
  eventId: 'evt-1',
  eventName: 'Guatemala City Half Marathon 2026',
  runnerEmail: 'r***@example.com',
  paymentRef: `TXN-${id}`,
  claimedAt: '2026-04-10T08:00:00Z',
  watermarkedUrl: 'https://via.placeholder.com/64',
});

const meta: Meta<DashboardComponent> = {
  title: 'Photographer/Dashboard/Dashboard',
  component: DashboardComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        provideMockStore({ initialState: { approvals: initialApprovalsState } }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<DashboardComponent>;

export const WithPendingApprovals: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        provideMockStore({
          initialState: {
            approvals: {
              ...initialApprovalsState,
              pendingPurchases: ['1', '2', '3', '4', '5'].map(makePurchase),
            },
          },
        }),
      ],
    }),
  ],
};

export const NoPendingApprovals: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        MatSnackBarModule,
        MatDialogModule,
        provideMockStore({
          initialState: {
            approvals: { ...initialApprovalsState },
          },
        }),
      ],
    }),
  ],
};
