import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { DashboardComponent } from './dashboard.component';
import { initialApprovalsState } from '../../../store/approvals/approvals.reducer';
import { AppConfigService } from '../../../core/config/app-config.service';
import { NavigationTitleService } from '../../../core/services/navigation-title.service';

const mockConfigService = { get: () => ({ apiBaseUrl: 'http://localhost:3000' }) };

describe('DashboardComponent', () => {
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        DashboardComponent,
        NoopAnimationsModule,
        MatSnackBarModule,
        MatDialogModule,
        HttpClientTestingModule,
      ],
      providers: [
        provideMockStore({
          initialState: { approvals: initialApprovalsState },
        }),
        { provide: AppConfigService, useValue: mockConfigService },
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should set the page title to Dashboard on init', () => {
    const titleService = TestBed.inject(NavigationTitleService);
    let title = '';
    titleService.title$.subscribe((t) => (title = t));

    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();

    expect(title).toBe('Dashboard');
  });
});
