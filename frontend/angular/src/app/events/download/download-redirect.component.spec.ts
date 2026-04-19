import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';

import { DownloadRedirectComponent } from './download-redirect.component';
import { DownloadService } from './download.service';

describe('DownloadRedirectComponent', () => {
  let fixture: ComponentFixture<DownloadRedirectComponent>;
  let component: DownloadRedirectComponent;
  let downloadServiceSpy: jasmine.SpyObj<DownloadService>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    downloadServiceSpy = jasmine.createSpyObj('DownloadService', [
      'getDownloadUrl',
      'resendDownloadLinks',
    ]);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    // default: never resolves — keeps component in loading state
    downloadServiceSpy.getDownloadUrl.and.returnValue(new Subject());

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, DownloadRedirectComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'test-token-123' } } },
        },
        { provide: Router, useValue: routerSpy },
        { provide: DownloadService, useValue: downloadServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DownloadRedirectComponent);
    component = fixture.componentInstance;
  });

  it('starts in loading state', () => {
    fixture.detectChanges();
    expect(component.state).toBe('loading');
  });

  it('shows spinner and label while loading', () => {
    fixture.detectChanges();
    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeTruthy();
    const label: HTMLElement = fixture.nativeElement.querySelector('.loading-label');
    expect(label.textContent).toContain('Preparing your download');
  });

  it('transitions to error state on 404', fakeAsync(() => {
    const err = new HttpErrorResponse({ status: 404 });
    downloadServiceSpy.getDownloadUrl.and.returnValue(throwError(() => err));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(component.state).toBe('error');
  }));

  it('shows error heading and CTA button in error state', () => {
    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    const heading: HTMLElement = fixture.nativeElement.querySelector('h1');
    expect(heading.textContent).toContain('Download link not found');
    const btn: HTMLElement = fixture.nativeElement.querySelector('button');
    expect(btn.textContent).toContain('Request a new link');
  });

  it('navigates to /redownload when CTA is clicked', () => {
    fixture.componentRef.setInput('state', 'error');
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    btn.click();
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/redownload']);
  });

  it('transitions to error state on network failure', fakeAsync(() => {
    const err = new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 });
    downloadServiceSpy.getDownloadUrl.and.returnValue(throwError(() => err));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(component.state).toBe('error');
  }));

  it('calls getDownloadUrl with correct token', fakeAsync(() => {
    spyOn(component, 'navigateTo');
    downloadServiceSpy.getDownloadUrl.and.returnValue(
      of({ url: 'https://s3.example.com/photo.jpg' }),
    );
    fixture.detectChanges();
    tick();
    expect(downloadServiceSpy.getDownloadUrl).toHaveBeenCalledWith('test-token-123');
  }));

  it('calls navigateTo with presigned URL on 200', fakeAsync(() => {
    const navigateSpy = spyOn(component, 'navigateTo');
    downloadServiceSpy.getDownloadUrl.and.returnValue(
      of({ url: 'https://s3.example.com/photo.jpg' }),
    );
    fixture.detectChanges();
    tick();
    expect(navigateSpy).toHaveBeenCalledWith('https://s3.example.com/photo.jpg');
  }));

  it('transitions to downloading state after redirect (Content-Disposition: attachment)', fakeAsync(() => {
    spyOn(component, 'navigateTo');
    downloadServiceSpy.getDownloadUrl.and.returnValue(
      of({ url: 'https://s3.example.com/photo.jpg' }),
    );
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(component.state).toBe('downloading');
  }));

  it('shows success heading in downloading state', () => {
    fixture.componentRef.setInput('state', 'downloading');
    fixture.detectChanges();
    const heading: HTMLElement = fixture.nativeElement.querySelector('h1');
    expect(heading.textContent).toContain('Your download is starting');
  });
});

describe('DownloadRedirectComponent — no token', () => {
  it('sets error state when token is missing', fakeAsync(async () => {
    const downloadSpy = jasmine.createSpyObj('DownloadService', ['getDownloadUrl']);
    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, DownloadRedirectComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => null } } },
        },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: DownloadService, useValue: downloadSpy },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DownloadRedirectComponent);
    f.detectChanges();
    tick();
    expect(f.componentInstance.state).toBe('error');
  }));
});
