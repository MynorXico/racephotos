import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RunnerPhotoCardComponent } from './photo-card.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';

const basePhoto: RunnerPhoto = {
  photoId: 'photo-1',
  watermarkedUrl: 'https://picsum.photos/seed/racephotos/400/300',
  capturedAt: '2026-06-01T09:30:00Z',
};

const meta: Meta<RunnerPhotoCardComponent> = {
  title: 'Runner/Photo Search/RunnerPhotoCardComponent',
  component: RunnerPhotoCardComponent,
  decorators: [moduleMetadata({ imports: [NoopAnimationsModule, RunnerPhotoCardComponent] })],
  args: {
    photo: basePhoto,
    pricePerPhoto: 12.99,
    currency: 'USD',
    searchedBib: '101',
  },
};
export default meta;
type Story = StoryObj<RunnerPhotoCardComponent>;

export const Default: Story = {};

export const NoBib: Story = {
  name: 'No bib (generic alt text)',
  args: { searchedBib: '' },
};

export const ImageError: Story = {
  name: 'Image load error',
  args: {
    photo: { ...basePhoto, watermarkedUrl: 'https://broken.example.com/photo.jpg' },
  },
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector<HTMLImageElement>('img');
    img?.dispatchEvent(new Event('error'));
  },
};

export const HighPrice: Story = {
  args: { pricePerPhoto: 49.99, currency: 'EUR' },
};
