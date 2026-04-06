import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { PhotographerLayoutComponent } from './photographer-layout.component';

const authenticatedState = {
  auth: {
    status: 'authenticated' as const,
    email: 'photographer@example.com',
    error: null,
  },
};

const meta: Meta<PhotographerLayoutComponent> = {
  title: 'Photographer/Layout',
  component: PhotographerLayoutComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: authenticatedState }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<PhotographerLayoutComponent>;

export const Authenticated: Story = {};
