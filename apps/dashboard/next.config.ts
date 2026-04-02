import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@wacrm/shared'],
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: 'minio' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://api:3000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
