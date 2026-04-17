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
  selectActivePhotoIds,
  selectPaymentRef,
  selectTotalAmount,
  selectCurrency,
  selectBankDetails,
} from '../../../store/purchases/purchases.selectors';
import {
  selectCartPhotoIds,
  selectCartPhotos,
  selectCartTotal,
  selectCartCurrency,
  selectCartCount,
  selectCartEventId,
  selectCartFull,
} from '../../../store/cart/cart.selectors';
import { PhotoSummary } from '../../../store/cart/cart.actions';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
const noopDialogRef = {
  close: noop,
  backdropClick: () => EMPTY,
  afterClosed: () => EMPTY,
};

const bankDetails = {
  bankName: 'Banco Industrial',
  bankAccountNumber: '1234-5678-9012-3456',
  bankAccountHolder: 'John Doe Photography',
  bankInstructions: '',
};

const cartPhoto: PhotoSummary = {
  id: 'photo-1',
  eventId: 'event-1',
  eventName: 'City Marathon 2026',
  watermarkedUrl: 'https://picsum.photos/seed/racephotos/400/300',
  pricePerPhoto: 75,
  currency: 'GTQ',
};

const baseSelectors = [
  { selector: selectPurchaseLoading, value: false },
  { selector: selectPurchaseError, value: null },
  { selector: selectMaskedEmail, value: 'r***@gmail.com' },
  { selector: selectActivePhotoIds, value: ['photo-1'] },
  { selector: selectPaymentRef, value: 'RS-AB12CD34' },
  { selector: selectTotalAmount, value: 75 },
  { selector: selectCurrency, value: 'GTQ' },
  { selector: selectBankDetails, value: bankDetails },
  { selector: selectCartPhotoIds, value: ['photo-1'] },
  { selector: selectCartPhotos, value: [cartPhoto] },
  { selector: selectCartTotal, value: 75 },
  { selector: selectCartCurrency, value: 'GTQ' },
  { selector: selectCartCount, value: 1 },
  { selector: selectCartEventId, value: 'event-1' },
  { selector: selectCartFull, value: false },
];

const sharedProviders = [
  { provide: MAT_DIALOG_DATA, useValue: { photoIds: ['photo-1'] } },
  { provide: MatDialogRef, useValue: noopDialogRef },
  { provide: Clipboard, useValue: { copy: () => true } },
  { provide: MatSnackBar, useValue: { open: noop } },
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

export const Step0: Story = {
  name: 'Step 0 — Cart review',
  decorators: [
    moduleMetadata({
      providers: [
        ...sharedProviders,
        provideMockStore({ selectors: baseSelectors }),
      ],
    }),
  ],
};

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
    // Advancing steps requires dispatching NgRx actions — documented here for reference.
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
