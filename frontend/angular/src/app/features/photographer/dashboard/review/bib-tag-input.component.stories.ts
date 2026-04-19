import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { BibTagInputComponent } from './bib-tag-input.component';

const meta: Meta<BibTagInputComponent> = {
  title: 'Photographer/Dashboard/BibTagInput',
  component: BibTagInputComponent,
  decorators: [
    applicationConfig({
      providers: [provideAnimationsAsync()],
    }),
  ],
};

export default meta;
type Story = StoryObj<BibTagInputComponent>;

export const Empty: Story = {
  args: {
    initialBibs: [],
    disabled: false,
  },
};

export const WithChips: Story = {
  args: {
    initialBibs: ['101', '102', '237'],
    disabled: false,
  },
};

export const Saving: Story = {
  args: {
    initialBibs: ['101', '102'],
    disabled: true,
  },
};
