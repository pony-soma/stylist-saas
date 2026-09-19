import Stripe from 'stripe';
let client: Stripe | undefined;
export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is missing');
  // Use the API version bundled with the locked SDK; do not suppress an obsolete version's types.
  return client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { appInfo: { name: 'LiNo', version: '0.1.0' }, maxNetworkRetries: 2, timeout: 20000 });
}
