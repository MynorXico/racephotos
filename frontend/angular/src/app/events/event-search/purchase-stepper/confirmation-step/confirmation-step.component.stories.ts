import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { ConfirmationStepComponent } from './confirmation-step.component';

const meta: Meta<ConfirmationStepComponent> = {
  title: 'Runner/Purchase Flow/ConfirmationStepComponent',
  component: ConfirmationStepComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, ConfirmationStepComponent],
    }),
  ],
};
export default meta;
type Story = StoryObj<ConfirmationStepComponent>;

export const Default: Story = {
  args: {
    maskedEmail: 'r***@gmail.com',
  },
};
