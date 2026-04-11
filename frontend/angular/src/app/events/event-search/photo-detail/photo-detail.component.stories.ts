import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EMPTY } from 'rxjs';
import { provideMockStore } from '@ngrx/store/testing';

import { PhotoDetailComponent, PhotoDetailDialogData } from './photo-detail.component';

const dialogData: PhotoDetailDialogData = {
  photo: {
    photoId: 'photo-abc',
    watermarkedUrl: 'https://picsum.photos/seed/watermark/720/540',
    capturedAt: null,
  },
  pricePerPhoto: 14.99,
  currency: 'USD',
};

// Minimal MatDialogRef stub for Storybook — close() and afterClosed() are no-ops.
const noopDialogRef = {
  afterClosed: () => EMPTY,
  close: (_result?: unknown) => undefined,
};

const meta: Meta<PhotoDetailComponent> = {
  title: 'Runner/Photo Search/PhotoDetailComponent',
  component: PhotoDetailComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, PhotoDetailComponent],
      providers: [
        provideMockStore(),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: noopDialogRef },
      ],
    }),
  ],
};
export default meta;
type Story = StoryObj<PhotoDetailComponent>;

export const Default: Story = {};

export const HighPrice: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { ...dialogData, pricePerPhoto: 49.99, currency: 'EUR' },
        },
        { provide: MatDialogRef, useValue: noopDialogRef },
      ],
    }),
  ],
};

export const ImageError: Story = {
  name: 'Image load error',
  decorators: [
    moduleMetadata({
      providers: [
        provideMockStore(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            ...dialogData,
            photo: { ...dialogData.photo, watermarkedUrl: 'https://broken.example.com/img.jpg' },
          },
        },
        { provide: MatDialogRef, useValue: noopDialogRef },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector<HTMLImageElement>('img');
    img?.dispatchEvent(new Event('error'));
  },
};
