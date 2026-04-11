import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RunnerPhotoGridComponent } from './photo-grid.component';
import { RunnerPhoto } from '../../../store/runner-photos/runner-photos.actions';

const makePhotos = (count: number): RunnerPhoto[] =>
  Array.from({ length: count }, (_, i) => ({
    photoId: `photo-${i + 1}`,
    watermarkedUrl: `https://picsum.photos/seed/race${i + 1}/400/300`,
    capturedAt: null,
  }));

const meta: Meta<RunnerPhotoGridComponent> = {
  title: 'Runner/Photo Search/RunnerPhotoGridComponent',
  component: RunnerPhotoGridComponent,
  decorators: [moduleMetadata({ imports: [NoopAnimationsModule, RunnerPhotoGridComponent] })],
  args: {
    photos: makePhotos(6),
    pricePerPhoto: 12.99,
    currency: 'USD',
    searchedBib: '101',
  },
};
export default meta;
type Story = StoryObj<RunnerPhotoGridComponent>;

export const SixPhotos: Story = {
  name: '6 photos (default)',
};

export const OnePhoto: Story = {
  name: '1 photo',
  args: { photos: makePhotos(1) },
};

export const TwoPhotos: Story = {
  name: '2 photos',
  args: { photos: makePhotos(2) },
};
