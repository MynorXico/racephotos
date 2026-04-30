export interface Photographer {
  id: string;
  displayName: string;
  defaultCurrency: string;
  preferredLocale: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  bankInstructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotographerState {
  profile: Photographer | null;
  /** True while GET /photographer/me is in flight. */
  loading: boolean;
  /** True while PUT /photographer/me is in flight. */
  saving: boolean;
  /** Error from GET /photographer/me. */
  error: string | null;
  /** Error from PUT /photographer/me. */
  saveError: string | null;
  /** True after a 404 auto-init PUT succeeds; cleared when the user manually saves. */
  wasAutoInitialized: boolean;
}

export const initialPhotographerState: PhotographerState = {
  profile: null,
  loading: false,
  saving: false,
  error: null,
  saveError: null,
  wasAutoInitialized: false,
};

/** Empty defaults sent to PUT /photographer/me when GET returns 404. */
export const emptyPhotographerDefaults: Omit<Photographer, 'id' | 'createdAt' | 'updatedAt'> = {
  displayName: '',
  defaultCurrency: 'USD',
  preferredLocale: 'en',
  bankName: '',
  bankAccountNumber: '',
  bankAccountHolder: '',
  bankInstructions: '',
};
