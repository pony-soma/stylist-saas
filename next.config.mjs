import path from 'node:path';
const localE2E = process.env.LINO_E2E_LOCAL === '1';
if (localE2E && (process.env.VERCEL || process.env.NEXT_PUBLIC_BASE_URL !== 'http://localhost:3000' || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321')) {
  throw new Error('Refusing LINE test provider outside isolated local E2E');
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(localE2E ? { env: { NEXT_PUBLIC_LIFF_ID: 'e2e-line-channel-liff' } } : {}),
  webpack(config) {
    if (localE2E) config.resolve.alias['@line/liff$'] = path.resolve('tests/e2e/liff-sdk.ts');
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
