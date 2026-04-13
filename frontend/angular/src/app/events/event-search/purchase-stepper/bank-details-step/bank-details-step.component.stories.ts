import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';

import { BankDetailsStepComponent } from './bank-details-step.component';
import { BankDetails } from '../../../../store/purchases/purchases.actions';

const fullBankDetails: BankDetails = {
  bankName: 'Banco Industrial',
  bankAccountNumber: '1234-5678-9012-3456',
  bankAccountHolder: 'John Doe Photography',
  bankInstructions: 'Please include your name in the transfer memo.',
};

const noopClipboard = { copy: (_: string) => true };
const noopSnackBar = {
  open: () => ({ onAction: () => ({ subscribe: (_fn: () => void) => void 0 }) }),
};

const meta: Meta<BankDetailsStepComponent> = {
  title: 'Runner/Purchase Flow/BankDetailsStepComponent',
  component: BankDetailsStepComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, BankDetailsStepComponent],
      providers: [
        { provide: Clipboard, useValue: noopClipboard },
        { provide: MatSnackBar, useValue: noopSnackBar },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<BankDetailsStepComponent>;

export const Default: Story = {
  args: {
    paymentRef: 'RS-AB12CD34',
    totalAmount: 75,
    currency: 'GTQ',
    bankDetails: fullBankDetails,
  },
};

export const NoInstructions: Story = {
  name: 'No additional instructions',
  args: {
    paymentRef: 'RS-AB12CD34',
    totalAmount: 14.99,
    currency: 'USD',
    bankDetails: { ...fullBankDetails, bankInstructions: '' },
  },
};
