import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';

import { ApprovalsTabComponent } from './approvals-tab.component';
import { ApprovalsActions } from '../../../../store/approvals/approvals.actions';
import { initialApprovalsState } from '../../../../store/approvals/approvals.reducer';

describe('ApprovalsTabComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ApprovalsTabComponent,
        NoopAnimationsModule,
        MatDialogModule,
        MatSnackBarModule,
      ],
      providers: [
        provideMockStore({
          initialState: { approvals: initialApprovalsState },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ApprovalsTabComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should dispatch loadPendingPurchases on init', () => {
    const dispatchSpy = spyOn(store, 'dispatch');
    const fixture = TestBed.createComponent(ApprovalsTabComponent);
    fixture.detectChanges();
    expect(dispatchSpy).toHaveBeenCalledWith(ApprovalsActions.loadPendingPurchases());
  });

  it('should show empty state when no purchases and not loading', () => {
    const fixture = TestBed.createComponent(ApprovalsTabComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('No pending approvals');
  });
});
