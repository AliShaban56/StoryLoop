/** @type {import('next').NextConfig} */
const nextConfig = {
  // عشان schema.sql يتضمّن في نسخة Vercel
  outputFileTracingIncludes: { '/api/status': ['./schema.sql'] },
};
export default nextConfig;
