import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActiveAlertCountByRoute,
  filterAlertsByActiveRoutes,
  formatAlertDuration,
  mergeAlertsIntoHistory,
  normalizeGtfsRtAlertEntity,
  normalizeT2CSivAlert,
  parseAlertHtmlContent,
} from './alertsMath';

test('parseAlertHtmlContent extracts paragraphs, bullets, stops, accessibility notes, and links', () => {
  const html = `
    <p>En raison des travaux InspiRe bd Charles de Gaulle à Cournon, l'itinéraire de la ligne C est modifié :</p>
    <ul>
      <li>les arrêts <strong>Sarliève</strong> sont reportés sur les arrêts Pont de Sarliève</li>
      <li>l'arrêt <strong>Lycée René Descartes</strong> ne sera pas desservi.</li>
    </ul>
    <p>*Arrêts provisoires non accessibles aux Personnes à Mobilité Réduite.</p>
    <p><a href="https://www.t2c.fr/actualites/navette-ligne-c-2">Consulter l'itinéraire</a></p>
  `;
  const parsed = parseAlertHtmlContent(html);
  assert.equal(parsed.bulletPoints.length, 2);
  assert.ok(parsed.paragraphs.length >= 2);
  assert.ok(parsed.affectedStopNames.includes('Sarliève'));
  assert.ok(parsed.affectedStopNames.includes('Lycée René Descartes'));
  assert.ok(parsed.accessibilityNote?.includes('Mobilité Réduite'));
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.links[0].url, 'https://www.t2c.fr/actualites/navette-ligne-c-2');
});

test('normalizeT2CSivAlert classifies cause, effect, sentinel 9999 end date, and routes', () => {
  const nowSec = Math.floor(Date.parse('2026-11-19T17:00:00Z') / 1000);
  const alert = normalizeT2CSivAlert(
    {
      id: '1.33548.2',
      type: 'Trafic',
      title: "Travaux InspiRe boulevard Charles de Gaulle à Cournon jusqu'au vendredi 4 décembre 2026",
      text: "<p>L'itinéraire de la ligne C est modifié en raison des travaux.</p>",
      start_datetime: '2026-11-17T15:20:00.000Z',
      end_datetime: '9999-12-31T22:59:59.000Z',
      priority: 1,
      affected_routes: ['C'],
      disruption_level: 'moderate',
      created_at: '2026-11-09T14:00:03.287Z',
      updated_at: '2026-11-19T09:02:43.000Z',
    },
    nowSec
  );

  assert.equal(alert.status, 'active');
  assert.equal(alert.cause, 'CONSTRUCTION');
  assert.equal(alert.effect, 'DETOUR');
  assert.equal(alert.endTime, null);
  assert.deepEqual(alert.affectedRouteIds, ['C']);
  assert.ok(alert.revisionHistory.length >= 2);
});

test('normalizeGtfsRtAlertEntity decodes standard GTFS-RT Alert entity fields', () => {
  const nowSec = 1_795_100_000;
  const alert = normalizeGtfsRtAlertEntity(
    {
      id: 'rt-alert-1',
      alert: {
        activePeriod: [{ start: nowSec - 3600, end: nowSec + 7200 }],
        informedEntity: [{ routeId: 'A' }, { routeId: 'B' }],
        cause: 3, // TECHNICAL_PROBLEM
        effect: 1, // NO_SERVICE
        severityLevel: 4, // SEVERE
        headerText: { translation: [{ text: 'Tramway Line A interrupted near Jaude', language: 'en' }] },
        descriptionText: { translation: [{ text: 'Replacement shuttles operating between Jaude and Gaillard.', language: 'en' }] },
        url: { translation: [{ text: 'https://www.t2c.fr/se-deplacer/infos-trafic', language: 'fr' }] },
      },
    },
    nowSec
  );

  assert.ok(alert);
  assert.equal(alert.source, 'gtfs-rt');
  assert.equal(alert.cause, 'TECHNICAL_PROBLEM');
  assert.equal(alert.effect, 'NO_SERVICE');
  assert.equal(alert.severity, 'severe');
  assert.deepEqual(alert.affectedRouteIds, ['A', 'B']);
  assert.equal(alert.links[0]?.url, 'https://www.t2c.fr/se-deplacer/infos-trafic');
});

test('mergeAlertsIntoHistory tracks new observations, updates, and resolution when cleared', () => {
  const t0 = 1_795_000_000;
  const a1 = normalizeT2CSivAlert(
    {
      id: 'alert-1',
      title: 'Detour on Line C',
      text: '<p>Initial detour text.</p>',
      affected_routes: ['C'],
      start_datetime: '2026-11-18T08:00:00Z',
      updated_at: '2026-11-18T09:00:00Z',
    },
    t0
  );

  // First poll: alert enters history as active
  const r1 = mergeAlertsIntoHistory([], [a1], t0);
  assert.equal(r1.activeAlerts.length, 1);
  assert.equal(r1.history.length, 1);
  assert.equal(r1.history[0].status, 'active');

  // Second poll: alert text updated
  const t1 = t0 + 600;
  const a1Updated = normalizeT2CSivAlert(
    {
      id: 'alert-1',
      title: 'Detour on Line C',
      text: '<p>Updated detour text with temporary shuttle.</p>',
      affected_routes: ['C'],
      start_datetime: '2026-11-18T08:00:00Z',
      updated_at: '2026-11-18T09:10:00Z',
    },
    t1
  );
  const r2 = mergeAlertsIntoHistory(r1.history, [a1Updated], t1);
  assert.equal(r2.activeAlerts.length, 1);
  assert.equal(r2.history[0].firstSeenAt, t0);
  assert.ok(r2.history[0].revisionHistory.some((e) => e.summary.includes('updated')));

  // Third poll: alert disappears -> marked resolved
  const t2 = t1 + 900;
  const r3 = mergeAlertsIntoHistory(r2.history, [], t2);
  assert.equal(r3.activeAlerts.length, 0);
  assert.equal(r3.history.length, 1);
  assert.equal(r3.history[0].status, 'resolved');
  assert.equal(r3.history[0].resolvedAt, t2);
  assert.ok(r3.history[0].revisionHistory.some((e) => e.kind === 'resolved'));
});

test('filterAlertsByActiveRoutes and route counts respect enabled route set', () => {
  const nowSec = 1_795_100_000;
  const aC = normalizeT2CSivAlert({ id: '1', title: 'C', affected_routes: ['C'] }, nowSec);
  const aE1 = normalizeT2CSivAlert({ id: '2', title: 'E1', affected_routes: ['3'] }, nowSec);

  const activeABC = filterAlertsByActiveRoutes([aC, aE1], new Set(['A', 'B', 'C']));
  assert.equal(activeABC.length, 1);
  assert.equal(activeABC[0].id, '1');

  const activeAB = filterAlertsByActiveRoutes([aC, aE1], new Set(['A', 'B']));
  assert.equal(activeAB.length, 0);

  const counts = buildActiveAlertCountByRoute([aC, aE1]);
  assert.equal(counts['C'], 1);
  assert.equal(counts['3'], 1);

  assert.equal(formatAlertDuration(nowSec - 7200, null, nowSec), '2h 0m active');
});
