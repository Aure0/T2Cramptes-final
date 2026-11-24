import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getServiceAlerts, getStaticStore } from '../server/t2cService.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const DATA_DIR = path.join(DIST_DIR, 'data');

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('[Pages Export] Loading official T2C GTFS network topology...');
  const store = await getStaticStore();

  // 1. Write slimmed NetworkSnapshot: omit route.shapes since static-index.json carries
  // deduplicated displayShapesByRoute (reconstructed client-side for smaller static loads)
  const slimSnapshot = {
    ...store.snapshot,
    routes: store.snapshot.routes.map((route) => ({
      ...route,
      shapes: [],
    })),
  };
  const networkPath = path.join(DATA_DIR, 'network.json');
  fs.writeFileSync(networkPath, JSON.stringify(slimSnapshot), 'utf8');

  // 2. Write compact browser static index (platforms + deduplicated display shapes + directional branch shapes)
  const platforms: Record<string, [string, string, number, number]> = {};
  for (const [stopId, p] of store.platformsById.entries()) {
    platforms[stopId] = [
      p.parentStationId,
      p.name,
      Number(p.lat.toFixed(6)),
      Number(p.lng.toFixed(6)),
    ];
  }

  const displayShapesByRoute: Record<string, [number, number][][]> = {};
  for (const route of store.snapshot.routes) {
    displayShapesByRoute[route.id] = route.shapes.map((poly) =>
      poly.map((pt) => [Number(pt.lat.toFixed(6)), Number(pt.lng.toFixed(6))])
    );
  }

  const shapesByRouteDir: Record<string, [number, number][][]> = {};
  for (const [key, list] of store.shapesByRouteDir.entries()) {
    shapesByRouteDir[key] = list.map((pts) =>
      pts.map((pt) => [Number(pt.lat.toFixed(6)), Number(pt.lng.toFixed(6))])
    );
  }

  const indexPath = path.join(DATA_DIR, 'static-index.json');
  fs.writeFileSync(
    indexPath,
    JSON.stringify({ platforms, displayShapesByRoute, shapesByRouteDir }),
    'utf8'
  );

  // 3. Export latest T2C Service Alerts & Disruption History snapshot
  console.log('[Pages Export] Fetching official T2C SIV Service Alerts...');
  try {
    const alerts = await getServiceAlerts(true);
    const alertsPath = path.join(DATA_DIR, 'alerts.json');
    fs.writeFileSync(alertsPath, JSON.stringify(alerts), 'utf8');
  } catch (err) {
    console.warn('[Pages Export] Warning: unable to fetch live SIV alerts, writing empty fallback:', err);
    const nowSec = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      path.join(DATA_DIR, 'alerts.json'),
      JSON.stringify({
        feedSource: 'T2C ServiceAlerts (Snapshot)',
        feedTimestamp: nowSec,
        serverNowSeconds: nowSec,
        activeCount: 0,
        historyCount: 0,
        activeAlertCountByRoute: {},
        activeAlerts: [],
        history: [],
      }),
      'utf8'
    );
  }

  // 4. Add .nojekyll so GitHub Pages serves all files cleanly without Jekyll interference
  fs.writeFileSync(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');

  const netKb = (fs.statSync(networkPath).size / 1024).toFixed(1);
  const idxKb = (fs.statSync(indexPath).size / 1024).toFixed(1);
  console.log(
    `[Pages Export] Done: network.json (${netKb} KB), static-index.json (${idxKb} KB), alerts.json, .nojekyll`
  );
}

main().catch((err) => {
  console.error('[Pages Export] Failed:', err);
  process.exit(1);
});
