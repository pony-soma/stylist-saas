import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is missing. Please set the environment variable.');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // @ts-ignore
  apiVersion: '2023-10-16', // Stripeの最新APIバージョン（適宜変更）
  appInfo: {
    name: 'LiNo',
    version: '0.1.0',
  },
});
