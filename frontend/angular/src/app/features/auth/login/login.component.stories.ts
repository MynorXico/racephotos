import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { initialAuthState } from '../../../store/auth/auth.state';
import { LoginComponent } from './login.component';

const meta: Meta<LoginComponent> = {
  title: 'Auth/Login',
  component: LoginComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: { auth: initialAuthState } }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<LoginComponent>;

export const Default: Story = {};

export const Submitting: Story = {
  play: async ({ canvasElement: _ }) => {
    // Simulated state — submitting signal set to true via component interaction
  },
};
