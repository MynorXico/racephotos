import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';

import { ApprovalsTabComponent } from './approvals-tab.component';
import { initialApprovalsState } from '../../../../store/approvals/approvals.reducer';
import { PendingPurchase } from '../../../../store/approvals/approvals.actions';

const photo1: PendingPurchase = {
  purchaseId: 'pur-1',
  photoId: 'photo-a',
  eventId: 'evt-1',
  eventName: 'Guatemala City Half Marathon 2026',
  runnerEmail: 'r***@example.com',
  paymentRef: 'TXN-001',
  claimedAt: '2026-04-10T08:00:00Z',
  watermarkedUrl: 'https://via.placeholder.com/64',
};

const photo2: PendingPurchase = {
  purchaseId: 'pur-2',
  photoId: 'photo-b',
  eventId: 'evt-1',
  eventName: 'Guatemala City Half Marathon 2026',
  runnerEmail: 'j***@runner.io',
  paymentRef: 'TXN-002',
  claimedAt: '2026-04-11T09:30:00Z',
  watermarkedUrl: 'https://via.placeholder.com/64',
};

// Same photo as pur-1 but different runner (ADR-0003 multi-runner case)
const photo1Runner2: PendingPurchase = {
  purchaseId: 'pur-3',
  photoId: 'photo-a',
  eventId: 'evt-1',
  eventName: 'Guatemala City Half Marathon 2026',
  runnerEmail: 'a***@marathon.gt',
  paymentRef: 'TXN-003',
  claimedAt: '2026-04-12T11:00:00Z',
  watermarkedUrl: 'https://via.placeholder.com/64',
};

const meta: Meta<ApprovalsTabComponent> = {
  title: 'Photographer/Dashboard/ApprovalsTab',
  component: ApprovalsTabComponent,
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
type Story = StoryObj<ApprovalsTabComponent>;

export const Default: Story = {
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
              pendingPurchases: [photo1, photo2, photo1Runner2],
            },
          },
        }),
      ],
    }),
  ],
};

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            approvals: { ...initialApprovalsState, loading: true },
          },
        }),
      ],
    }),
  ],
};

export const Empty: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            approvals: { ...initialApprovalsState, loading: false },
          },
        }),
      ],
    }),
  ],
};

export const Error: Story = {
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
              error: 'Network error',
            },
          },
        }),
      ],
    }),
  ],
};

export const RowActionLoading: Story = {
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
              pendingPurchases: [photo1, photo2, photo1Runner2],
              actionLoading: { [photo1.purchaseId]: true },
            },
          },
        }),
      ],
    }),
  ],
};

export const RowActionError: Story = {
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
              pendingPurchases: [photo1, photo2, photo1Runner2],
              actionError: { [photo1.purchaseId]: 'Action failed' },
            },
          },
        }),
      ],
    }),
  ],
};
