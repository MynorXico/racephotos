import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
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

const meta: Meta<PhotoDetailComponent> = {
  title: 'Runner/Photo Search/PhotoDetailComponent',
  component: PhotoDetailComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, PhotoDetailComponent],
      providers: [
        provideMockStore(),
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: MatDialogRef, useValue: { afterClosed: () => ({ subscribe: () => {} }), close: () => {} } },
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
        { provide: MatDialogRef, useValue: { afterClosed: () => ({ subscribe: () => {} }), close: () => {} } },
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
        { provide: MatDialogRef, useValue: { afterClosed: () => ({ subscribe: () => {} }), close: () => {} } },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector<HTMLImageElement>('img');
    img?.dispatchEvent(new Event('error'));
  },
};
