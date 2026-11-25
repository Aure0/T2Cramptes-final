import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  const isStaticSubpath = process.env.VITE_STATIC_MODE === 'true';
  const manifestStartUrl = isStaticSubpath ? './' : '/';
  const iconPrefix = isStaticSubpath ? './' : '/';

  return {
    base: process.env.VITE_BASE_PATH || './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: manifestStartUrl,
          name: 'T2Cramptés',
          short_name: 'T2Cramptés',
          description:
            'Real-time traffic map and live station arrival times for the T2C Clermont-Ferrand public transit network.',
          theme_color: '#0F1522',
          background_color: '#0B0F17',
          display: 'standalone',
          orientation: 'any',
          start_url: manifestStartUrl,
          scope: manifestStartUrl,
          categories: ['navigation', 'travel', 'utilities'],
          icons: [
            {
              src: `${iconPrefix}pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${iconPrefix}pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${iconPrefix}pwa-maskable-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'Lines A · B · C',
              short_name: 'A · B · C',
              description: 'Open core Tramway A & BHNS B/C live map',
              url: `${manifestStartUrl}?lines=A,B,C`,
              icons: [{src: `${iconPrefix}pwa-192x192.png`, sizes: '192x192'}],
            },
            {
              name: 'Tramway Line A',
              short_name: 'Tram A',
              description: 'Track Tramway A live across Clermont-Ferrand',
              url: `${manifestStartUrl}?lines=A`,
              icons: [{src: `${iconPrefix}pwa-192x192.png`, sizes: '192x192'}],
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {statuses: [0, 200]},
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {statuses: [0, 200]},
              },
            },
            {
              urlPattern: /\/api\/transit\/network$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 't2c-network-topology',
                expiration: {
                  maxEntries: 2,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {statuses: [0, 200]},
              },
            },
            {
              urlPattern:
                /^https:\/\/(basemaps\.cartocdn\.com\/gl\/.*|tiles\.openfreemap\.org\/(styles\/.*|planet|backup_planet))$/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'basemap-styles-v2',
                networkTimeoutSeconds: 4,
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60,
                },
                cacheableResponse: {statuses: [200]},
              },
            },
            {
              urlPattern:
                /^https:\/\/([a-d]\.basemaps\.cartocdn\.com|tiles\.basemaps\.cartocdn\.com|tiles\.openfreemap\.org\/(planet\/|backup_planet\/|fonts\/|sprites\/|natural_earth\/)).*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'basemap-tiles-v2',
                expiration: {
                  maxEntries: 250,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {statuses: [200]},
              },
            },
          ],
          cleanupOutdatedCaches: true,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          // MapLibre GL v6 loads its Web Worker dynamically; copy the self-contained
          // worker bundle into dist/assets/ with a .js extension for universal MIME
          // compatibility across GitHub Pages and static hosts.
          const maplibreWorkerSrc = path.resolve(
            __dirname,
            'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
          );
          if (fs.existsSync(distDir) && fs.existsSync(maplibreWorkerSrc)) {
            const assetsDir = path.resolve(distDir, 'assets');
            fs.mkdirSync(assetsDir, {recursive: true});
            fs.copyFileSync(
              maplibreWorkerSrc,
              path.resolve(assetsDir, 'maplibre-gl-worker.js'),
            );
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('maplibre-gl')) return 'vendor-maplibre';
            if (id.includes('gtfs-realtime-bindings') || id.includes('protobufjs')) {
              return 'vendor-gtfs-rt';
            }
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
