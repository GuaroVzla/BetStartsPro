/** @type {import('next').NextConfig} */
// Next dev usa eval para HMR/source maps: sin 'unsafe-eval' la hidratación
// de React falla y los botones (análisis, gestión de ligas) no responden.
// En producción se mantiene la política estricta.
const esDesarrollo = process.env.NODE_ENV !== "production";
const scriptSrc = esDesarrollo
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.api-sports.io",
      },
      {
        protocol: "https",
        hostname: "media-4.api-sports.io",
      },
    ],
  },
  // Defensa en profundidad para la app y las rutas /api. Next requiere
  // 'unsafe-inline' para el script de tema y los estilos de RSC.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; ${scriptSrc}; ` +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https://media.api-sports.io https://media-4.api-sports.io; " +
              "font-src 'self' data:; connect-src 'self' https:; " +
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
