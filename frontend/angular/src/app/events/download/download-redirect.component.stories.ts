// Note: The 'downloading' state is reachable via Storybook arg (Content-Disposition: attachment means the browser stays on the page).
import { Meta, StoryObj, moduleMetadata } from '@storybook/angular';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RouterTestingModule } from '@angular/router/testing';
import { Subject } from 'rxjs';

import { DownloadRedirectComponent } from './download-redirect.component';
import { DownloadService } from './download.service';

const meta: Meta<DownloadRedirectComponent> = {
  title: 'Runner/Download/DownloadRedirectComponent',
  component: DownloadRedirectComponent,
  decorators: [
    moduleMetadata({
      imports: [NoopAnimationsModule, RouterTestingModule, DownloadRedirectComponent],
      providers: [
        {
          provide: DownloadService,
          useValue: { getDownloadUrl: () => new Subject(), resendDownloadLinks: () => new Subject() },
        },
      ],
    }),
  ],
  argTypes: {
    state: { control: { type: 'select' }, options: ['loading', 'downloading', 'error'] },
  },
};
export default meta;
type Story = StoryObj<DownloadRedirectComponent>;

export const Loading: Story = {
  args: { state: 'loading' },
};

export const Downloading: Story = {
  args: { state: 'downloading' },
};

export const Error: Story = {
  args: { state: 'error' },
};
