import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PhotoCardComponent } from './photo-card.component';
import { Photo } from '../../../../store/photos/photos.actions';

const baseThumbnail = 'https://picsum.photos/seed/racephotos/400/225';

const makePhoto = (overrides: Partial<Photo>): Photo => ({
  id: 'photo-1',
  status: 'indexed',
  thumbnailUrl: baseThumbnail,
  bibNumbers: ['101', '202'],
  uploadedAt: '2026-04-01T10:00:00Z',
  errorReason: null,
  ...overrides,
});

const meta: Meta<PhotoCardComponent> = {
  title: 'Photographer/Event Photos/PhotoCardComponent',
  component: PhotoCardComponent,
  decorators: [
    moduleMetadata({ imports: [NoopAnimationsModule, PhotoCardComponent] }),
  ],
  args: { photo: makePhoto({}) },
};
export default meta;
type Story = StoryObj<PhotoCardComponent>;

export const Indexed: Story = {
  args: { photo: makePhoto({ status: 'indexed', bibNumbers: ['101', '202'] }) },
};

export const ReviewRequired: Story = {
  args: {
    photo: makePhoto({ status: 'review_required', bibNumbers: ['305'] }),
  },
};

export const Error: Story = {
  args: {
    photo: makePhoto({
      status: 'error',
      bibNumbers: [],
      errorReason: 'Rekognition service error: timeout after 3 retries',
    }),
  },
};

export const ErrorNoReason: Story = {
  name: 'Error (no reason)',
  args: {
    photo: makePhoto({ status: 'error', bibNumbers: [], errorReason: null }),
  },
};

export const Processing: Story = {
  args: {
    photo: makePhoto({ status: 'processing', bibNumbers: [], thumbnailUrl: null }),
  },
};

// RS-017: watermarking shimmer — Rekognition done, watermark Lambda in progress.
export const Watermarking: Story = {
  args: {
    photo: makePhoto({ status: 'watermarking', bibNumbers: ['42'], thumbnailUrl: null }),
  },
};
