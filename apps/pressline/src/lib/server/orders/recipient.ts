import type { ProviderRecipient } from '../services/fulfilment-provider';
import type { Recipient } from './orders';

/** The Order's Recipient as the provider wants it addressed. */
export const toProviderRecipient = (r: Recipient): ProviderRecipient => ({
  name: r.name,
  address1: r.address1,
  ...(r.address2 ? { address2: r.address2 } : {}),
  city: r.city,
  ...(r.state ? { stateCode: r.state } : {}),
  countryCode: r.country,
  ...(r.zip ? { zip: r.zip } : {}),
  email: r.email,
  ...(r.phone ? { phone: r.phone } : {}),
});
