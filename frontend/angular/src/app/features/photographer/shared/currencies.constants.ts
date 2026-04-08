export interface CurrencyOption {
  code: string;
  name: string;
}

/**
 * Curated list of currencies supported by RaceShots.
 * Shared by ProfileComponent, EventCreateComponent, and EventEditComponent.
 */
export const SUPPORTED_CURRENCIES: readonly CurrencyOption[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'GTQ', name: 'Guatemalan Quetzal' },
  { code: 'BRL', name: 'Brazilian Real' },
] as const;
