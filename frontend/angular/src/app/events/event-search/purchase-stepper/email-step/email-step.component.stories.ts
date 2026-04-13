import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { EmailStepComponent } from './email-step.component';

const meta: Meta<EmailStepComponent> = {
  title: 'Runner/Purchase Flow/EmailStepComponent',
  component: EmailStepComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, EmailStepComponent],
    }),
  ],
  argTypes: {
    loading: { control: 'boolean' },
    error: { control: 'text' },
    maskedEmail: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<EmailStepComponent>;

export const Default: Story = {
  args: {
    loading: false,
    error: null,
    maskedEmail: null,
  },
};

export const WithPreview: Story = {
  args: {
    loading: false,
    error: null,
    maskedEmail: 'r***@gmail.com',
  },
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="email"]');
    if (input) {
      input.value = 'runner@gmail.com';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
    }
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    error: null,
    maskedEmail: 'r***@gmail.com',
  },
};

export const ApiError: Story = {
  args: {
    loading: false,
    error: 'Something went wrong. Please try again.',
    maskedEmail: 'r***@gmail.com',
  },
};
