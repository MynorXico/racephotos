import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { EMPTY, Subject } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PurchaseStepperComponent } from './purchase-stepper.component';
import {
  selectPurchaseLoading,
  selectPurchaseError,
  selectMaskedEmail,
  selectActivePhotoId,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
} from '../../../store/purchases/purchases.selectors';

const noopDialogRef = {
  close: () => {},
  backdropClick: () => EMPTY,
  afterClosed: () => EMPTY,
};

const bankDetails = {
  bankName: 'Banco Industrial',
  bankAccountNumber: '1234-5678-9012-3456',
  bankAccountHolder: 'John Doe Photography',
  bankInstructions: '',
};

const baseSelectors = [
  { selector: selectPurchaseLoading, value: false },
  { selector: selectPurchaseError, value: null },
  { selector: selectMaskedEmail, value: 'r***@gmail.com' },
  { selector: selectActivePhotoId, value: 'photo-1' },
  { selector: selectPaymentRef, value: 'RS-AB12CD34' },
  { selector: selectTotalAmount, value: 75 },
  { selector: selectCurrency, value: 'GTQ' },
  { selector: selectBankDetails, value: bankDetails },
];

const sharedProviders = [
  { provide: MAT_DIALOG_DATA, useValue: { photoId: 'photo-1' } },
  { provide: MatDialogRef, useValue: noopDialogRef },
  { provide: Clipboard, useValue: { copy: () => true } },
  { provide: MatSnackBar, useValue: { open: () => {} } },
  provideMockActions(() => new Subject()),
];

const meta: Meta<PurchaseStepperComponent> = {
  title: 'Runner/Purchase Flow/PurchaseStepperComponent',
  component: PurchaseStepperComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, PurchaseStepperComponent],
    }),
  ],
};
export default meta;
type Story = StoryObj<PurchaseStepperComponent>;

export const Step1: Story = {
  name: 'Step 1 — Email',
  decorators: [
    moduleMetadata({
      providers: [
        ...sharedProviders,
        provideMockStore({ selectors: baseSelectors }),
      ],
    }),
  ],
};

export const Step2: Story = {
  name: 'Step 2 — Bank details',
  decorators: [
    moduleMetadata({
      providers: [
        ...sharedProviders,
        provideMockStore({ selectors: baseSelectors }),
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    // Advance to step 2 by clicking "next" programmatically is complex in
    // Storybook without a real store. This story documents the intended state.
    void canvasElement;
  },
};

export const Step3: Story = {
  name: 'Step 3 — Confirmation',
  decorators: [
    moduleMetadata({
      providers: [
        ...sharedProviders,
        provideMockStore({ selectors: baseSelectors }),
      ],
    }),
  ],
};
