import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideMockStore } from '@ngrx/store/testing';
import { ProfileComponent } from './profile.component';
import { initialPhotographerState } from '../../../store/photographer/photographer.state';

const loadedState = {
  photographer: {
    ...initialPhotographerState,
    profile: {
      id: 'sub-123',
      displayName: 'Jane Photographer',
      defaultCurrency: 'USD',
      bankName: 'First National Bank',
      bankAccountNumber: 'GB29NWBK60161331926819',
      bankAccountHolder: 'Jane Smith',
      bankInstructions: 'Please include race number in reference.',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  },
};

const meta: Meta<ProfileComponent> = {
  title: 'Photographer/Profile',
  component: ProfileComponent,
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: loadedState }),
      ],
    }),
  ],
};

export default meta;
type Story = StoryObj<ProfileComponent>;

export const WithProfile: Story = {};

export const Empty: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({ initialState: { photographer: initialPhotographerState } }),
      ],
    }),
  ],
};

export const Loading: Story = {
  decorators: [
    applicationConfig({
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideMockStore({
          initialState: {
            photographer: { ...initialPhotographerState, loading: true },
          },
        }),
      ],
    }),
  ],
};
