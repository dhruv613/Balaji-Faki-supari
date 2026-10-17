export interface CustomerDetails { fullName: string; phone: string }

export function normalizeIndianMobile(value: string): string {
  return value.replace(/[\s()-]/g, '').replace(/^(?:\+?91|0)(?=\d{10}$)/, '');
}

export function validateCustomerDetails(details: CustomerDetails) {
  const errors: Partial<Record<keyof CustomerDetails, string>> = {};
  if (details.fullName.trim().length < 2) errors.fullName = 'Enter your full name (at least 2 characters).';
  else if (details.fullName.trim().length > 100) errors.fullName = 'Use no more than 100 characters for your name.';
  if (!/^[6-9]\d{9}$/.test(normalizeIndianMobile(details.phone))) errors.phone = 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  return errors;
}

export function readCustomerDetails(metadata: Record<string, unknown> | undefined): CustomerDetails {
  return {
    fullName: typeof metadata?.fullName === 'string' ? metadata.fullName.trim() : '',
    phone: typeof metadata?.phone === 'string' ? normalizeIndianMobile(metadata.phone) : '',
  };
}
