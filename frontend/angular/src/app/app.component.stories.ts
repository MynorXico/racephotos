import type { Meta, StoryObj } from '@storybook/angular';
import { AppComponent } from './app.component';

const meta: Meta<AppComponent> = {
  title: 'App/AppComponent',
  component: AppComponent,
};

export default meta;
type Story = StoryObj<AppComponent>;

export const Default: Story = {};
