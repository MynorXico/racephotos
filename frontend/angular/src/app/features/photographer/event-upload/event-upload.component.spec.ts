import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { EventUploadComponent } from './event-upload.component';
import { PhotoUploadActions } from '../../../store/photo-upload/photo-upload.actions';
import { initialPhotoUploadState } from '../../../store/photo-upload/photo-upload.reducer';
import { initialEventsState } from '../../../store/events/events.reducer';
import { AppConfigService } from '../../../core/config/app-config.service';
import { NavigationTitleService } from '../../../core/services/navigation-title.service';
import { EventsActions } from '../../../store/events/events.actions';
import type { Event } from '../events/event.model';

const mockEvent: Event = {
  id: 'evt-1',
  photographerId: 'user-1',
  name: 'Spring Run 2026',
  date: '2026-06-01',
  location: 'Central Park',
  pricePerPhoto: 5,
  currency: 'USD',
  watermarkText: 'Spring Run 2026',
  status: 'active',
  visibility: 'public',
  archivedAt: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('EventUploadComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventUploadComponent, RouterTestingModule, NoopAnimationsModule],
      providers: [
        provideMockStore({
          initialState: {
            events: initialEventsState,
            photoUpload: initialPhotoUploadState,
          },
        }),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['id', 'evt-1']])) },
        },
        {
          provide: AppConfigService,
          useValue: { get: () => ({ apiBaseUrl: 'http://api.test' }) },
        },
        {
          provide: NavigationTitleService,
          useValue: { setTitle: jasmine.createSpy('setTitle') },
        },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(EventUploadComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch loadEvent on init with route id', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(EventsActions.loadEvent({ id: 'evt-1' }));
  });

  it('should dispatch resetUpload on destroy', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    fixture.destroy();
    expect(dispatchSpy).toHaveBeenCalledWith(PhotoUploadActions.resetUpload());
  });

  it('should show event name when selectedEvent is populated', () => {
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: initialPhotoUploadState,
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Spring Run 2026');
  });

  it('should show drop zone when not uploading and not complete', () => {
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: { ...initialPhotoUploadState, inProgress: false },
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const dropZone = fixture.nativeElement.querySelector('.drop-zone');
    expect(dropZone).toBeTruthy();
  });

  it('should show progress panel when inProgress is true', () => {
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: { ...initialPhotoUploadState, total: 10, inProgress: true },
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.progress-panel');
    expect(panel).toBeTruthy();
  });

  it('should show success panel when complete with no failures', () => {
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: {
        ...initialPhotoUploadState,
        total: 5,
        uploaded: 5,
        failed: [],
        inProgress: false,
      },
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.success-panel');
    expect(panel).toBeTruthy();
  });

  it('should show partial-failure panel when complete with failures', () => {
    const failedFile = new File([], 'bad.jpg', { type: 'image/jpeg' });
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: {
        ...initialPhotoUploadState,
        total: 5,
        uploaded: 4,
        failed: [{ file: failedFile, errorMessage: 'Network error' }],
        inProgress: false,
      },
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.partial-failure-panel');
    expect(panel).toBeTruthy();
  });

  it('should dispatch uploadFiles when files are dropped', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const comp = fixture.componentInstance;
    const dropEvent = new DragEvent('drop', {
      dataTransfer: (() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        return dt;
      })(),
    });

    comp.onDrop(dropEvent);
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotoUploadActions.uploadFiles({ files: [file], eventId: 'evt-1' }),
    );
  });

  it('should filter out non-JPEG/PNG files from drop', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();

    const mp4 = new File(['v'], 'video.mp4', { type: 'video/mp4' });
    const comp = fixture.componentInstance;
    const dt = new DataTransfer();
    dt.items.add(mp4);
    const dropEvent = new DragEvent('drop', { dataTransfer: dt });

    comp.onDrop(dropEvent);
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      jasmine.objectContaining({ type: '[PhotoUpload] Upload Files' }),
    );
  });

  it('should dispatch retryFile when onRetryFile is called', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();

    const file = new File([], 'photo.jpg', { type: 'image/jpeg' });
    fixture.componentInstance.onRetryFile({ file, errorMessage: 'Network error' });
    expect(dispatchSpy).toHaveBeenCalledWith(PhotoUploadActions.retryFile({ file, eventId: 'evt-1' }));
  });

  it('should dispatch uploadFiles with all failed files on onRetryAll', () => {
    const failedFile = new File([], 'bad.jpg', { type: 'image/jpeg' });
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: {
        ...initialPhotoUploadState,
        total: 1,
        failed: [{ file: failedFile, errorMessage: 'err' }],
      },
    });
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();

    fixture.componentInstance.onRetryAll();
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotoUploadActions.uploadFiles({ files: [failedFile], eventId: 'evt-1' }),
    );
  });

  it('should dispatch uploadFiles with cached files on onTryAgain', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    // Trigger a drop first to populate lastAttemptedFiles
    const dt = new DataTransfer();
    dt.items.add(file);
    comp.onDrop(new DragEvent('drop', { dataTransfer: dt }));
    dispatchSpy.calls.reset();

    comp.onTryAgain();
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotoUploadActions.uploadFiles({ files: [file], eventId: 'evt-1' }),
    );
  });

  it('should set isDragOver on drag events', () => {
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    comp.onDragOver(new DragEvent('dragover'));
    expect(comp.isDragOver).toBeTrue();

    comp.onDragLeave(new DragEvent('dragleave'));
    expect(comp.isDragOver).toBeFalse();
  });

  it('should open file picker on Enter/Space keydown on drop zone', () => {
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    const mockInput = { click: jasmine.createSpy('click') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (comp as any).fileInputRef = { nativeElement: mockInput };

    comp.onDropZoneKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(mockInput.click).toHaveBeenCalled();

    comp.onDropZoneKeyDown(new KeyboardEvent('keydown', { key: ' ' }));
    expect(mockInput.click).toHaveBeenCalledTimes(2);
  });

  it('should dispatch uploadFiles on file input change', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();

    const file = new File(['data'], 'photo.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.createElement('input');
    input.type = 'file';

    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: { files: dt.files, value: '' } });

    fixture.componentInstance.onFileInputChange(event);
    expect(dispatchSpy).toHaveBeenCalledWith(
      PhotoUploadActions.uploadFiles({ files: [file], eventId: 'evt-1' }),
    );
  });

  it('retryAriaLabel should return correct label', () => {
    const fixture = TestBed.createComponent(EventUploadComponent);
    const label = fixture.componentInstance.retryAriaLabel('IMG_001.jpg');
    expect(label).toBe('Retry upload for IMG_001.jpg');
  });

  it('should show error banner when presignError is set', () => {
    store.setState({
      events: { ...initialEventsState, selectedEvent: mockEvent },
      photoUpload: {
        ...initialPhotoUploadState,
        presignError: 'You do not own this event.',
      },
    });
    const fixture = TestBed.createComponent(EventUploadComponent);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.error-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('You do not own this event.');
  });
});
