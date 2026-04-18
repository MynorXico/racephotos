import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig, moduleMetadata } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from './confirmation-dialog.component';

const mockDialogRef = {
  close: (result?: unknown) => console.log('Dialog closed with:', result),
};

const meta: Meta<ConfirmationDialogComponent> = {
  title: 'Shared/ConfirmationDialog',
  component: ConfirmationDialogComponent,
  decorators: [
    applicationConfig({
      providers: [provideAnimationsAsync()],
    }),
  ],
};

export default meta;
type Story = StoryObj<ConfirmationDialogComponent>;

export const ApproveVariant: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Approve this purchase?',
            message:
              'The runner will receive a download link by email. Payment reference: TXN-001',
            confirmLabel: 'Approve',
            cancelLabel: 'Cancel',
            confirmVariant: 'primary',
          } satisfies ConfirmationDialogData,
        },
      ],
    }),
  ],
};

export const RejectVariant: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Reject this purchase?',
            message:
              'The purchase claim will be marked as rejected. No email is sent to the runner.',
            confirmLabel: 'Reject',
            cancelLabel: 'Cancel',
            confirmVariant: 'warn',
          } satisfies ConfirmationDialogData,
        },
      ],
    }),
  ],
};

export const LongMessage: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Approve this purchase?',
            message:
              'This is a very long confirmation message that demonstrates the dialog\'s ability to handle ' +
              'extended text content gracefully. The message may include additional details such as the ' +
              'payment reference number TXN-00123456789, the event name Guatemala City Half Marathon 2026, ' +
              'and any other relevant context the photographer needs to review before confirming their action. ' +
              'The dialog content area scrolls if the message exceeds the available height.',
            confirmLabel: 'Approve',
            cancelLabel: 'Cancel',
            confirmVariant: 'primary',
          } satisfies ConfirmationDialogData,
        },
      ],
    }),
  ],
};
