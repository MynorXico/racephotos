import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Subject } from 'rxjs';

import { RedownloadRequestComponent } from './redownload-request.component';
import { DownloadService } from './download.service';

const meta: Meta<RedownloadRequestComponent> = {
  title: 'Runner/Download/RedownloadRequestComponent',
  component: RedownloadRequestComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, RedownloadRequestComponent],
      providers: [
        {
          provide: DownloadService,
          useValue: { getDownloadUrl: () => new Subject(), resendDownloadLinks: () => new Subject() },
        },
      ],
    }),
  ],
  argTypes: {
    submitState: {
      control: { type: 'select' },
      options: ['idle', 'loading', 'success', 'rate-limited', 'error'],
    },
  },
};
export default meta;
type Story = StoryObj<RedownloadRequestComponent>;

export const Default: Story = {
  args: { submitState: 'idle' },
};

export const Loading: Story = {
  args: { submitState: 'loading' },
};

export const Success: Story = {
  args: { submitState: 'success' },
};

export const RateLimited: Story = {
  args: { submitState: 'rate-limited' },
};

export const NetworkError: Story = {
  args: { submitState: 'error' },
};
