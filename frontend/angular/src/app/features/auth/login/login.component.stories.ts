import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { userEvent, within } from '@storybook/test';
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/email address/i), 'test@example.com');
    await userEvent.type(canvas.getByLabelText(/password/i), 'password123');
    await userEvent.click(canvas.getByRole('button', { name: /sign in/i }));
  },
};
