import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { authGuard } from './core/auth/auth.guard';
import { photoUploadFeature } from './store/photo-upload/photo-upload.reducer';
import { PhotoUploadEffects } from './store/photo-upload/photo-upload.effects';
import { photosFeature } from './store/photos/photos.reducer';
import { PhotosEffects } from './store/photos/photos.effects';
import { runnerPhotosFeature } from './store/runner-photos/runner-photos.reducer';
import { RunnerPhotosEffects } from './store/runner-photos/runner-photos.effects';
import { cartFeature } from './store/cart/cart.reducer';
import { approvalsFeature } from './store/approvals/approvals.reducer';
import { ApprovalsEffects } from './store/approvals/approvals.effects';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'photographer',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/photographer/layout/photographer-layout.component').then(
        (m) => m.PhotographerLayoutComponent,
      ),
    children: [
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/photographer/profile/profile.component').then(
            (m) => m.ProfileComponent,
          ),
      },
      {
        path: 'events',
        loadComponent: () =>
          import('./features/photographer/events/event-list/event-list.component').then(
            (m) => m.EventListComponent,
          ),
      },
      {
        path: 'events/new',
        loadComponent: () =>
          import('./features/photographer/events/event-create/event-create.component').then(
            (m) => m.EventCreateComponent,
          ),
      },
      {
        path: 'events/:id/edit',
        loadComponent: () =>
          import('./features/photographer/events/event-edit/event-edit.component').then(
            (m) => m.EventEditComponent,
          ),
      },
      {
        path: 'events/:id/upload',
        loadComponent: () =>
          import('./features/photographer/event-upload/event-upload.component').then(
            (m) => m.EventUploadComponent,
          ),
        providers: [provideState(photoUploadFeature), provideEffects(PhotoUploadEffects)],
      },
      {
        path: 'events/:id/photos',
        loadComponent: () =>
          import('./features/photographer/event-photos/event-photos.component').then(
            (m) => m.EventPhotosComponent,
          ),
        providers: [provideState(photosFeature), provideEffects(PhotosEffects)],
      },
      {
        path: 'events/:id',
        loadComponent: () =>
          import('./features/photographer/events/event-detail/event-detail.component').then(
            (m) => m.EventDetailComponent,
          ),
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/photographer/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
        providers: [provideState(approvalsFeature), provideEffects(ApprovalsEffects)],
      },
      {
        path: '',
        redirectTo: 'events',
        pathMatch: 'full',
      },
    ],
  },
  // Public runner download pages — RS-012
  {
    path: 'download/:token',
    loadComponent: () =>
      import('./events/download/download-redirect.component').then(
        (m) => m.DownloadRedirectComponent,
      ),
  },
  {
    path: 'redownload',
    loadComponent: () =>
      import('./events/download/redownload-request.component').then(
        (m) => m.RedownloadRequestComponent,
      ),
  },
  // Public runner-facing event search page — no auth guard
  {
    path: 'events/:id',
    loadComponent: () =>
      import('./events/event-search/event-search.component').then(
        (m) => m.EventSearchComponent,
      ),
    providers: [provideState(runnerPhotosFeature), provideEffects(RunnerPhotosEffects), provideState(cartFeature)],
  },
  {
    path: '',
    redirectTo: '/login',
    pathMatch: 'full',
  },
];
