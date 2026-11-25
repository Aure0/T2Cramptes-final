/**
 * Cloudflare Worker — Lightweight CORS Proxy for Official T2C SIV Service Alerts
 *
 * Deploy free on Cloudflare Workers:
 *   cd cloudflare-worker && npx wrangler deploy
 * Then set VITE_ALERTS_PROXY_URL="https://<your-worker>.workers.dev" in GitHub Actions / .env
 */

const T2C_SIV_UPSTREAM =
  'https://www.t2c.fr/sites/default/files/siv/info_trafic.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    try {
      const upstream = await fetch(T2C_SIV_UPSTREAM, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'T2Cramptes-AlertsProxy/1.0',
        },
        cf: {
          cacheTtl: 60,
          cacheEverything: true,
        },
      });

      if (!upstream.ok) {
        return new Response(
          JSON.stringify({ error: `Upstream HTTP ${upstream.status}` }),
          {
            status: 502,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'application/json; charset=utf-8',
            },
          }
        );
      }

      const body = await upstream.text();
      return new Response(body, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=60, s-maxage=60',
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Upstream fetch failed', detail: String(err) }),
        {
          status: 502,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
    }
  },
};
