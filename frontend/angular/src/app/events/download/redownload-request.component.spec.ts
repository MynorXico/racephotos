import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError, Subject } from 'rxjs';

import { RedownloadRequestComponent } from './redownload-request.component';
import { DownloadService } from './download.service';

describe('RedownloadRequestComponent', () => {
  let fixture: ComponentFixture<RedownloadRequestComponent>;
  let component: RedownloadRequestComponent;
  let downloadServiceSpy: jasmine.SpyObj<DownloadService>;

  beforeEach(async () => {
    downloadServiceSpy = jasmine.createSpyObj('DownloadService', [
      'getDownloadUrl',
      'resendDownloadLinks',
    ]);

    await TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, RedownloadRequestComponent],
      providers: [{ provide: DownloadService, useValue: downloadServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(RedownloadRequestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders email form field', () => {
    const input = fixture.nativeElement.querySelector('input[type="email"]');
    expect(input).toBeTruthy();
  });

  it('shows required error when submitted empty', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    btn.click();
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('mat-error');
    expect(error.textContent).toContain('required');
  });

  it('does not call API when form is invalid', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    btn.click();
    expect(downloadServiceSpy.resendDownloadLinks).not.toHaveBeenCalled();
  });

  it('transitions to success on 200', fakeAsync(() => {
    downloadServiceSpy.resendDownloadLinks.and.returnValue(of(undefined));
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    tick();
    fixture.detectChanges();
    expect(component.submitState).toBe('success');
    const msg = fixture.nativeElement.querySelector('[role="status"]');
    expect(msg.textContent).toContain('receive a link shortly');
  }));

  it('transitions to rate-limited on 429', fakeAsync(() => {
    const err = new HttpErrorResponse({ status: 429 });
    downloadServiceSpy.resendDownloadLinks.and.returnValue(throwError(() => err));
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    tick();
    fixture.detectChanges();
    expect(component.submitState).toBe('rate-limited');
    const msg = fixture.nativeElement.querySelector('[role="alert"]');
    expect(msg.textContent).toContain('Too many attempts');
  }));

  it('transitions to error on other HTTP failure', fakeAsync(() => {
    const err = new HttpErrorResponse({ status: 500 });
    downloadServiceSpy.resendDownloadLinks.and.returnValue(throwError(() => err));
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    tick();
    fixture.detectChanges();
    expect(component.submitState).toBe('error');
    const msg = fixture.nativeElement.querySelector('[role="alert"]');
    expect(msg.textContent).toContain('Something went wrong');
  }));

  it('disables form field while loading', fakeAsync(() => {
    const subject = new Subject<void>();
    downloadServiceSpy.resendDownloadLinks.and.returnValue(subject);
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    expect(component.submitState).toBe('loading');
    expect(component.emailControl.disabled).toBeTrue();
    subject.next();
    subject.complete();
    tick();
  }));

  it('re-enables form after success', fakeAsync(() => {
    downloadServiceSpy.resendDownloadLinks.and.returnValue(of(undefined));
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    tick();
    expect(component.emailControl.enabled).toBeTrue();
  }));

  it('calls API with correct email', fakeAsync(() => {
    downloadServiceSpy.resendDownloadLinks.and.returnValue(of(undefined));
    component.emailControl.setValue('runner@example.com');
    component.onSubmit();
    tick();
    expect(downloadServiceSpy.resendDownloadLinks).toHaveBeenCalledWith('runner@example.com');
  }));

  it('shows success message via submitState input override', () => {
    fixture.componentRef.setInput('submitState', 'success');
    fixture.detectChanges();
    const msg = fixture.nativeElement.querySelector('[role="status"]');
    expect(msg).toBeTruthy();
  });

  it('shows rate-limited message via submitState input override', () => {
    fixture.componentRef.setInput('submitState', 'rate-limited');
    fixture.detectChanges();
    const msg = fixture.nativeElement.querySelector('[role="alert"]');
    expect(msg.textContent).toContain('Too many attempts');
  });
});
