import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createServer as createViteServer } from 'vite';
import {
  getLiveTraffic,
  getNetworkSnapshot,
  getRoutePunctuality,
  getServiceAlerts,
  getStationArrivals,
  getStaticStore,
} from './server/t2cService.ts';
import { normalizePeriod } from './src/utils/punctualityMath.ts';

function acceptsGzip(req: Request): boolean {
  const encoding = req.headers['accept-encoding'];
  return typeof encoding === 'string' && encoding.includes('gzip');
}

function sendJson(req: Request, res: Response, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (json.length >= 1024 && acceptsGzip(req)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.send(gzipSync(json));
    return;
  }
  res.send(json);
}

let cachedNetworkPayload: {
  loadedAt: number;
  etag: string;
  raw: Buffer;
  gzipped: Buffer;
} | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json());

  // Allow cross-origin requests if the Express API is hosted separately from GitHub Pages
  const corsOrigin = (process.env.CORS_ORIGIN || '*').trim();
  app.use('/api/transit', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // Health check
  app.get('/api/transit/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Static T2C network topology (pre-serialized + pre-gzipped + ETag cached)
  app.get('/api/transit/network', async (req, res) => {
    try {
      const snapshot = await getNetworkSnapshot();
      if (!cachedNetworkPayload || cachedNetworkPayload.loadedAt !== snapshot.loadedAt) {
        const raw = Buffer.from(JSON.stringify(snapshot), 'utf8');
        cachedNetworkPayload = {
          loadedAt: snapshot.loadedAt,
          etag: `"t2c-net-${snapshot.loadedAt}-${raw.length}"`,
          raw,
          gzipped: gzipSync(raw),
        };
      }

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('ETag', cachedNetworkPayload.etag);
      res.setHeader('Vary', 'Accept-Encoding');

      if (req.headers['if-none-match'] === cachedNetworkPayload.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (acceptsGzip(req)) {
        res.setHeader('Content-Encoding', 'gzip');
        res.send(cachedNetworkPayload.gzipped);
      } else {
        res.send(cachedNetworkPayload.raw);
      }
    } catch (err) {
      console.error('[T2C] Failed to load static GTFS network:', err);
      res.status(503).json({
        error: 'Unable to load T2C network topology from transport.data.gouv.fr.',
      });
    }
  });

  // Real-time T2C traffic (active vehicles + per-route counts from GTFS-RT Trip Updates)
  app.get('/api/transit/live', async (req, res) => {
    try {
      const routesParam = typeof req.query.routes === 'string' ? req.query.routes : '';
      const routeIds = routesParam
        ? routesParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
      const forceRefresh = req.query.force === '1';

      const live = await getLiveTraffic(routeIds, forceRefresh);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, live);
    } catch (err) {
      console.error('[T2C] Failed to fetch live GTFS-RT traffic:', err);
      res.status(503).json({
        error: 'Unable to reach live T2C GTFS-RT feed right now.',
      });
    }
  });

  // Real-time arrivals board for a selected parent station
  app.get('/api/transit/station/:stationId', async (req, res) => {
    try {
      const stationId = req.params.stationId;
      const data = await getStationArrivals(stationId);
      if (!data) {
        res.status(404).json({ error: 'Station not found in T2C network.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, data);
    } catch (err) {
      console.error('[T2C] Failed to fetch station arrivals:', err);
      res.status(503).json({
        error: 'Unable to load station arrival times right now.',
      });
    }
  });

  // Historical & live-anchored punctuality breakdown for a transit route
  app.get('/api/transit/punctuality/:routeId', async (req, res) => {
    try {
      const routeId = req.params.routeId;
      const period = normalizePeriod(
        typeof req.query.period === 'string' ? req.query.period : undefined
      );
      const data = await getRoutePunctuality(routeId, period);
      if (!data) {
        res.status(404).json({ error: 'Route not found in T2C network.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, data);
    } catch (err) {
      console.error('[T2C] Failed to build route punctuality history:', err);
      res.status(503).json({
        error: 'Unable to load punctuality history right now.',
      });
    }
  });

  // Real-time GTFS-RT / T2C Service Alerts & persistent disruption history
  app.get('/api/transit/alerts', async (req, res) => {
    try {
      const forceRefresh = req.query.force === '1';
      const data = await getServiceAlerts(forceRefresh);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, data);
    } catch (err) {
      console.error('[T2C] Failed to fetch service alerts:', err);
      res.status(503).json({
        error: 'Unable to load service alerts right now.',
      });
    }
  });

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distDir, {
        maxAge: '1y',
        immutable: true,
        index: false,
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[T2C Server] Listening on http://0.0.0.0:${PORT}`);
    // Pre-warm static GTFS + live GTFS-RT + service alerts caches on startup so first client request is instant
    getStaticStore()
      .then((store) => {
        console.log(
          `[T2C Server] GTFS loaded: ${store.snapshot.routes.length} routes, ${store.snapshot.stations.length} stations`
        );
        return Promise.allSettled([getLiveTraffic(undefined, false), getServiceAlerts(false)]);
      })
      .catch((err) => {
        console.error('[T2C Server] Background GTFS warm-up failed:', err);
      });
  });
}

startServer();
