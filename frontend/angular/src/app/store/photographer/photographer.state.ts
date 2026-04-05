export interface Photographer {
  id: string;
  displayName: string;
  defaultCurrency: string;
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
  error: string | null;
}

export const initialPhotographerState: PhotographerState = {
  profile: null,
  loading: false,
  saving: false,
  error: null,
};

/** Empty defaults sent to PUT /photographer/me when GET returns 404. */
export const emptyPhotographerDefaults: Omit<Photographer, 'id' | 'createdAt' | 'updatedAt'> = {
  displayName: '',
  defaultCurrency: 'USD',
  bankName: '',
  bankAccountNumber: '',
  bankAccountHolder: '',
  bankInstructions: '',
};
