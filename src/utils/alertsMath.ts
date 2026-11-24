import type {
  AlertActivePeriod,
  AlertCause,
  AlertEffect,
  AlertExternalLink,
  AlertRevisionEvent,
  AlertSeverity,
  ServiceAlert,
} from '../types/transit';

export interface RawT2CSivAlert {
  id: string;
  type?: string;
  title?: string;
  text?: string;
  start_datetime?: string | null;
  end_datetime?: string | null;
  priority?: number;
  affected_routes?: string[];
  disruption_level?: string;
  forwarding?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RawGtfsRtAlertEntity {
  id: string;
  alert?: {
    activePeriod?: Array<{ start?: unknown; end?: unknown }>;
    informedEntity?: Array<{ routeId?: string | null; stopId?: string | null }>;
    cause?: number | string | null;
    effect?: number | string | null;
    severityLevel?: number | string | null;
    url?: { translation?: Array<{ text?: string | null; language?: string | null }> } | null;
    headerText?: { translation?: Array<{ text?: string | null; language?: string | null }> } | null;
    descriptionText?: { translation?: Array<{ text?: string | null; language?: string | null }> } | null;
  } | null;
}

const GTFS_CAUSE_MAP: Record<number, AlertCause> = {
  1: 'UNKNOWN_CAUSE',
  2: 'OTHER_CAUSE',
  3: 'TECHNICAL_PROBLEM',
  4: 'STRIKE',
  5: 'DEMONSTRATION',
  6: 'ACCIDENT',
  7: 'HOLIDAY',
  8: 'WEATHER',
  9: 'MAINTENANCE',
  10: 'CONSTRUCTION',
  11: 'POLICE_ACTIVITY',
  12: 'MEDICAL_EMERGENCY',
};

const GTFS_EFFECT_MAP: Record<number, AlertEffect> = {
  1: 'NO_SERVICE',
  2: 'REDUCED_SERVICE',
  3: 'SIGNIFICANT_DELAYS',
  4: 'DETOUR',
  5: 'ADDITIONAL_SERVICE',
  6: 'MODIFIED_SERVICE',
  7: 'OTHER_EFFECT',
  8: 'UNKNOWN_EFFECT',
  9: 'STOP_MOVED',
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .replace(/&ecirc;/g, 'ê')
    .replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

export function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export interface ParsedAlertContent {
  descriptionPlain: string;
  paragraphs: string[];
  bulletPoints: string[];
  affectedStopNames: string[];
  accessibilityNote: string | null;
  links: AlertExternalLink[];
}

export function parseAlertHtmlContent(rawHtml: string): ParsedAlertContent {
  if (!rawHtml || !rawHtml.trim()) {
    return {
      descriptionPlain: '',
      paragraphs: [],
      bulletPoints: [],
      affectedStopNames: [],
      accessibilityNote: null,
      links: [],
    };
  }

  // Extract official external links
  const links: AlertExternalLink[] = [];
  const seenUrls = new Set<string>();
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRegex.exec(rawHtml)) !== null) {
    const url = decodeHtmlEntities(linkMatch[1]).trim();
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const labelText = stripHtmlTags(linkMatch[2]).trim();
    links.push({
      label: labelText && labelText.length > 2 ? labelText : 'Official T2C Notice',
      url,
    });
  }

  // Extract bullet list items
  const bulletPoints: string[] = [];
  const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;
  while ((liMatch = liRegex.exec(rawHtml)) !== null) {
    const cleaned = stripHtmlTags(liMatch[1]).replace(/\s+/g, ' ').trim();
    if (cleaned) bulletPoints.push(cleaned);
  }

  // Extract paragraphs (excluding content already inside <ul>/<ol>)
  const withoutLists = rawHtml.replace(/<(ul|ol)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const paragraphs: string[] = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(withoutLists)) !== null) {
    const cleaned = stripHtmlTags(pMatch[1]).replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    // Avoid duplicating short "cliquer ici" anchor prompts already shown in the links section
    if (links.length > 0 && cleaned.length < 70 && /cliquer ici|click here/i.test(cleaned)) {
      continue;
    }
    paragraphs.push(cleaned);
  }

  // Fallback if plain text without <p> tags
  const descriptionPlain = stripHtmlTags(rawHtml);
  if (paragraphs.length === 0 && bulletPoints.length === 0 && descriptionPlain) {
    paragraphs.push(...descriptionPlain.split('\n').filter(Boolean));
  }

  // Extract mentioned stop names from <strong> tags within stop-mention context
  const sanitizeStopName = (raw: string): string => {
    let cleaned = raw.replace(/^[,.;:(\[\s]+|[,.;:\s]+$/g, '').trim();
    // Drop unbalanced trailing ')' or ']' (e.g. "(terminus Dr Vigenaud)")
    while (cleaned.endsWith(')') && !cleaned.includes('(')) {
      cleaned = cleaned.slice(0, -1).trim();
    }
    while (cleaned.endsWith(']') && !cleaned.includes('[')) {
      cleaned = cleaned.slice(0, -1).trim();
    }
    return cleaned;
  };

  const stopNames = new Set<string>();
  const stopContextRegex =
    /(?:arr[êe]ts?|terminus)\s+(?:provisoires?\s+)?(?:<strong>)?([A-ZÀ-ÖØ-Ý0-9][^<.,;:\n]{2,45})/gi;
  let stopMatch: RegExpExecArray | null;
  while ((stopMatch = stopContextRegex.exec(decodeHtmlEntities(rawHtml))) !== null) {
    const candidate = sanitizeStopName(
      stripHtmlTags(stopMatch[1]).replace(
        /\s+(?:sont|est|sera|seront|direction|vers|de la ligne|situ[ée]s?|report[ée]s?|non desservi).*$/i,
        ''
      )
    );
    if (candidate.length >= 3 && candidate.length <= 42 && !/^(provisoire|report)/i.test(candidate)) {
      stopNames.add(candidate);
    }
  }

  // Also scan bolded segments inside <li> elements that look like stop names
  const liBoldRegex = /<li\b[^>]*>[\s\S]*?<\/li>/gi;
  let liBlock: RegExpExecArray | null;
  while ((liBlock = liBoldRegex.exec(rawHtml)) !== null) {
    const strongRegex = /<strong\b[^>]*>([\s\S]*?)<\/strong>/gi;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = strongRegex.exec(liBlock[0])) !== null) {
      const text = sanitizeStopName(stripHtmlTags(sMatch[1]));
      if (
        text.length >= 3 &&
        text.length <= 40 &&
        !/^(en direction|du lundi|consulter|attention|navette|ligne)/i.test(text)
      ) {
        stopNames.add(text);
      }
    }
  }

  // Detect PMR / wheelchair accessibility notes
  let accessibilityNote: string | null = null;
  for (const text of [...paragraphs, ...bulletPoints]) {
    if (/mobilit[ée]\s+r[ée]duite|pmr|accessible|fauteuil/i.test(text)) {
      accessibilityNote = text.replace(/^\*+\s*/, '').trim();
      break;
    }
  }

  return {
    descriptionPlain,
    paragraphs,
    bulletPoints,
    affectedStopNames: Array.from(stopNames).slice(0, 12),
    accessibilityNote,
    links,
  };
}

export function inferCauseFromText(title: string, description: string): AlertCause {
  const combined = `${title} ${description}`.toLowerCase();
  if (/travaux|chantier|inspire|voirie|r[ée]am[ée]nagement/.test(combined)) return 'CONSTRUCTION';
  if (/maintenance|entretien|r[ée]paration|intervention technique/.test(combined)) return 'MAINTENANCE';
  if (/gr[èe]ve|mouvement social|pr[ée]avis/.test(combined)) return 'STRIKE';
  if (/manifestation|cort[èe]ge|d[ée]fil[ée]|[ée]v[èe]nement|marathon|course|march[ée]/.test(combined)) {
    return 'DEMONSTRATION';
  }
  if (/accident|collision|incident/.test(combined)) return 'ACCIDENT';
  if (/neige|verglas|intemp[ée]rie|m[ée]t[ée]o|temp[êe]te|inondation/.test(combined)) return 'WEATHER';
  if (/panne|technique|signalisation|aiguillage/.test(combined)) return 'TECHNICAL_PROBLEM';
  if (/police|s[ée]curit[ée]|p[ée]rim[èe]tre/.test(combined)) return 'POLICE_ACTIVITY';
  if (/f[ée]ri[ée]|vacances|scolaire/.test(combined)) return 'HOLIDAY';
  return 'OTHER_CAUSE';
}

export function inferEffectFromText(title: string, description: string): AlertEffect {
  const combined = `${title} ${description}`.toLowerCase();
  if (/interrompu|interruption|aucun service|supprim[ée]s?|ne circule pas/.test(combined)) {
    return 'NO_SERVICE';
  }
  if (/d[ée]vi[ée]|d[ée]viation|itin[ée]raire.*modifi[ée]|modifi[ée]/.test(combined)) {
    return 'DETOUR';
  }
  if (/report[ée]|arr[êe]t.*provisoire|non desservi/.test(combined)) {
    return 'STOP_MOVED';
  }
  if (/retard|ralentissement|perturb[ée]/.test(combined)) {
    return 'SIGNIFICANT_DELAYS';
  }
  if (/r[ée]duit|all[ée]g[ée]|fr[ée]quence/.test(combined)) {
    return 'REDUCED_SERVICE';
  }
  if (/ajustement|adaptation|horaire|renfort|navette/.test(combined)) {
    return 'MODIFIED_SERVICE';
  }
  return 'OTHER_EFFECT';
}

export function parseIsoToEpochSec(iso: string | null | undefined): number | null {
  if (!iso) return null;
  // T2C uses sentinel 9999-12-31 for open-ended disruptions
  if (iso.startsWith('9999-') || iso.startsWith('2999-')) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

function toEpochSec(val: unknown): number | null {
  if (val == null) return null;
  let num = 0;
  if (typeof val === 'number') num = val;
  else if (typeof val === 'string') num = Number(val);
  else if (typeof val === 'object' && 'toNumber' in (val as Record<string, unknown>)) {
    num = (val as { toNumber: () => number }).toNumber();
  }
  if (!Number.isFinite(num) || num <= 0) return null;
  // Treat sentinel far-future dates (> year 2100) as open-ended
  if (num > 4_102_444_800) return null;
  return Math.floor(num);
}

function pickTranslation(
  ts: { translation?: Array<{ text?: string | null; language?: string | null }> } | null | undefined
): string {
  const list = ts?.translation || [];
  if (list.length === 0) return '';
  const en = list.find((t) => t.language?.toLowerCase().startsWith('en') && t.text);
  if (en?.text) return en.text.trim();
  const fr = list.find((t) => t.language?.toLowerCase().startsWith('fr') && t.text);
  if (fr?.text) return fr.text.trim();
  return (list.find((t) => t.text)?.text || '').trim();
}

export function normalizeGtfsRtAlertEntity(
  entity: RawGtfsRtAlertEntity,
  nowSec: number
): ServiceAlert | null {
  const a = entity.alert;
  if (!a) return null;

  const headerText = pickTranslation(a.headerText) || 'Service Disruption';
  const rawDescription = pickTranslation(a.descriptionText);
  const parsed = parseAlertHtmlContent(rawDescription);
  const alertUrl = pickTranslation(a.url);
  if (alertUrl && /^https?:\/\//i.test(alertUrl) && !parsed.links.some((l) => l.url === alertUrl)) {
    parsed.links.unshift({ label: 'Official Alert Link', url: alertUrl });
  }

  const periods: AlertActivePeriod[] = (a.activePeriod || []).map((p) => ({
    start: toEpochSec(p.start),
    end: toEpochSec(p.end),
  }));
  const startTime = periods[0]?.start ?? null;
  const endTime = periods[0]?.end ?? null;

  const affectedRouteIds = Array.from(
    new Set(
      (a.informedEntity || [])
        .map((ie) => (ie.routeId || '').trim())
        .filter(Boolean)
    )
  );

  const causeNum = typeof a.cause === 'number' ? a.cause : 0;
  const effectNum = typeof a.effect === 'number' ? a.effect : 0;
  const cause: AlertCause =
    GTFS_CAUSE_MAP[causeNum] && GTFS_CAUSE_MAP[causeNum] !== 'UNKNOWN_CAUSE'
      ? GTFS_CAUSE_MAP[causeNum]
      : inferCauseFromText(headerText, parsed.descriptionPlain);
  const effect: AlertEffect =
    GTFS_EFFECT_MAP[effectNum] && GTFS_EFFECT_MAP[effectNum] !== 'UNKNOWN_EFFECT'
      ? GTFS_EFFECT_MAP[effectNum]
      : inferEffectFromText(headerText, parsed.descriptionPlain);

  const sevRaw = a.severityLevel;
  let severity: AlertSeverity = 'moderate';
  if (sevRaw === 4 || sevRaw === 'SEVERE' || effect === 'NO_SERVICE') {
    severity = 'severe';
  } else if (sevRaw === 2 || sevRaw === 'INFO') {
    severity = 'info';
  }

  const status =
    endTime && endTime < nowSec
      ? 'resolved'
      : startTime && startTime > nowSec + 300
        ? 'scheduled'
        : 'active';

  const revisionHistory: AlertRevisionEvent[] = [];
  if (startTime) {
    revisionHistory.push({
      timestamp: startTime,
      kind: 'effective',
      summary: 'Active period began (GTFS-RT ServiceAlerts)',
    });
  }
  revisionHistory.push({
    timestamp: nowSec,
    kind: 'observed',
    summary: 'Observed live in GTFS-RT ServiceAlerts feed',
  });

  return {
    id: entity.id || `gtfsrt-${nowSec}`,
    source: 'gtfs-rt',
    sourceLabel: 'GTFS-RT ServiceAlerts',
    status,
    severity,
    priority: severity === 'severe' ? 0 : severity === 'moderate' ? 1 : 2,
    cause,
    effect,
    headerText,
    descriptionPlain: parsed.descriptionPlain,
    paragraphs: parsed.paragraphs,
    bulletPoints: parsed.bulletPoints,
    affectedRouteIds,
    affectedStopNames: parsed.affectedStopNames,
    accessibilityNote: parsed.accessibilityNote,
    links: parsed.links,
    activePeriods: periods.length > 0 ? periods : [{ start: startTime, end: endTime }],
    startTime,
    endTime,
    createdAt: startTime,
    updatedAt: nowSec,
    firstSeenAt: nowSec,
    lastSeenAt: nowSec,
    resolvedAt: status === 'resolved' ? endTime : null,
    revisionHistory,
  };
}

export function normalizeT2CSivAlert(raw: RawT2CSivAlert, nowSec: number): ServiceAlert {
  const headerText = (raw.title || 'T2C Service Advisory').trim();
  const parsed = parseAlertHtmlContent(raw.text || '');

  const startTime = parseIsoToEpochSec(raw.start_datetime);
  const endTime = parseIsoToEpochSec(raw.end_datetime);
  const createdAt = parseIsoToEpochSec(raw.created_at);
  const updatedAt = parseIsoToEpochSec(raw.updated_at);

  const cause = inferCauseFromText(headerText, parsed.descriptionPlain);
  const effect = inferEffectFromText(headerText, parsed.descriptionPlain);

  const levelLower = (raw.disruption_level || '').toLowerCase();
  let severity: AlertSeverity = 'moderate';
  if (
    levelLower === 'severe' ||
    levelLower === 'high' ||
    levelLower === 'critical' ||
    effect === 'NO_SERVICE'
  ) {
    severity = 'severe';
  } else if (levelLower === 'low' || levelLower === 'info' || levelLower === 'minor') {
    severity = 'info';
  }

  const affectedRouteIds = Array.from(
    new Set((raw.affected_routes || []).map((r) => String(r).trim()).filter(Boolean))
  );

  const status =
    endTime && endTime < nowSec
      ? 'resolved'
      : startTime && startTime > nowSec + 300
        ? 'scheduled'
        : 'active';

  const revisionHistory: AlertRevisionEvent[] = [];
  if (createdAt) {
    revisionHistory.push({
      timestamp: createdAt,
      kind: 'published',
      summary: 'Advisory created in T2C SIV',
    });
  }
  if (startTime && (!createdAt || Math.abs(startTime - createdAt) > 3600)) {
    revisionHistory.push({
      timestamp: startTime,
      kind: 'effective',
      summary: 'Disruption effective window began',
    });
  }
  if (updatedAt && (!createdAt || updatedAt > createdAt + 60)) {
    revisionHistory.push({
      timestamp: updatedAt,
      kind: 'updated',
      summary: 'Latest operator update published',
    });
  }
  revisionHistory.sort((a, b) => a.timestamp - b.timestamp);

  return {
    id: String(raw.id),
    source: 't2c-siv',
    sourceLabel: 'T2C ServiceAlerts (SIV)',
    status,
    severity,
    priority: typeof raw.priority === 'number' ? raw.priority : 1,
    cause,
    effect,
    headerText,
    descriptionPlain: parsed.descriptionPlain,
    paragraphs: parsed.paragraphs,
    bulletPoints: parsed.bulletPoints,
    affectedRouteIds,
    affectedStopNames: parsed.affectedStopNames,
    accessibilityNote: parsed.accessibilityNote,
    links: parsed.links,
    activePeriods: [{ start: startTime, end: endTime }],
    startTime,
    endTime,
    createdAt,
    updatedAt,
    firstSeenAt: nowSec,
    lastSeenAt: nowSec,
    resolvedAt: status === 'resolved' ? endTime : null,
    revisionHistory,
  };
}

/**
 * Merges freshly polled live alerts into the persistent disruption history map,
 * preserving firstSeenAt, recording updates/revisions, and marking alerts that
 * disappear from the live feed as resolved with exact resolution timestamps.
 */
export function mergeAlertsIntoHistory(
  existingHistory: ServiceAlert[],
  liveAlerts: ServiceAlert[],
  nowSec: number,
  maxHistorySize = 200
): { activeAlerts: ServiceAlert[]; history: ServiceAlert[] } {
  const byId = new Map<string, ServiceAlert>();
  for (const item of existingHistory) {
    byId.set(item.id, {
      ...item,
      revisionHistory: [...(item.revisionHistory || [])],
    });
  }

  const liveIdSet = new Set<string>();

  for (const fresh of liveAlerts) {
    liveIdSet.add(fresh.id);
    const prev = byId.get(fresh.id);

    if (!prev) {
      const revisions = [...fresh.revisionHistory];
      if (!revisions.some((r) => r.kind === 'observed')) {
        revisions.push({
          timestamp: nowSec,
          kind: 'observed',
          summary: 'First observed in live monitoring feed',
        });
      }
      revisions.sort((a, b) => a.timestamp - b.timestamp);
      byId.set(fresh.id, {
        ...fresh,
        firstSeenAt: nowSec,
        lastSeenAt: nowSec,
        revisionHistory: revisions,
      });
      continue;
    }

    const revisions = [...prev.revisionHistory];
    const textChanged =
      prev.headerText !== fresh.headerText || prev.descriptionPlain !== fresh.descriptionPlain;
    const updatedChanged =
      fresh.updatedAt != null && prev.updatedAt != null && fresh.updatedAt > prev.updatedAt;
    const reopened = prev.status === 'resolved' && fresh.status !== 'resolved';

    if (reopened) {
      revisions.push({
        timestamp: nowSec,
        kind: 'observed',
        summary: 'Disruption re-appeared in live feed',
      });
    } else if (textChanged || updatedChanged) {
      revisions.push({
        timestamp: fresh.updatedAt || nowSec,
        kind: 'updated',
        summary: textChanged
          ? 'Advisory text or affected stop details updated'
          : 'Operator timestamp refreshed',
      });
    }

    byId.set(fresh.id, {
      ...fresh,
      firstSeenAt: Math.min(prev.firstSeenAt, nowSec),
      lastSeenAt: nowSec,
      resolvedAt: fresh.status === 'resolved' ? fresh.resolvedAt ?? nowSec : null,
      revisionHistory: revisions.slice(-15),
    });
  }

  // Mark alerts that were previously active in history but are no longer in the live feed as resolved
  for (const [id, item] of byId.entries()) {
    if (!liveIdSet.has(id) && item.status !== 'resolved') {
      const revisions = [...item.revisionHistory];
      revisions.push({
        timestamp: nowSec,
        kind: 'resolved',
        summary: 'Cleared from live ServiceAlerts feed',
      });
      byId.set(id, {
        ...item,
        status: 'resolved',
        resolvedAt: nowSec,
        revisionHistory: revisions.slice(-15),
      });
    }
  }

  const all = Array.from(byId.values());

  // Sort active alerts: severe first, then most recently updated
  const activeAlerts = all
    .filter((a) => a.status !== 'resolved')
    .sort((a, b) => {
      const sevRank = (s: AlertSeverity) => (s === 'severe' ? 0 : s === 'moderate' ? 1 : 2);
      const sd = sevRank(a.severity) - sevRank(b.severity);
      if (sd !== 0) return sd;
      return (b.updatedAt ?? b.lastSeenAt) - (a.updatedAt ?? a.lastSeenAt);
    });

  // Sort full history chronologically (most recent activity first)
  const history = all
    .sort((a, b) => {
      const ta = b.resolvedAt ?? b.updatedAt ?? b.startTime ?? b.lastSeenAt;
      const tb = a.resolvedAt ?? a.updatedAt ?? a.startTime ?? a.lastSeenAt;
      return ta - tb;
    })
    .slice(0, maxHistorySize);

  return { activeAlerts, history };
}

export function filterAlertsByActiveRoutes(
  alerts: ServiceAlert[],
  enabledRouteIds: Set<string>
): ServiceAlert[] {
  if (enabledRouteIds.size === 0) return [];
  return alerts.filter((alert) =>
    alert.affectedRouteIds.some((rid) => enabledRouteIds.has(rid))
  );
}

export function buildActiveAlertCountByRoute(alerts: ServiceAlert[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const alert of alerts) {
    if (alert.status === 'resolved') continue;
    for (const rid of alert.affectedRouteIds) {
      counts[rid] = (counts[rid] || 0) + 1;
    }
  }
  return counts;
}

export function formatCauseLabel(cause: AlertCause, locale: 'en' | 'fr' = 'en'): string {
  const isFr = locale === 'fr';
  switch (cause) {
    case 'CONSTRUCTION':
      return isFr ? 'Travaux' : 'Roadworks';
    case 'MAINTENANCE':
      return 'Maintenance';
    case 'TECHNICAL_PROBLEM':
      return isFr ? 'Incident technique' : 'Technical Issue';
    case 'STRIKE':
      return isFr ? 'Mouvement social' : 'Industrial Action';
    case 'DEMONSTRATION':
      return isFr ? 'Événement' : 'Public Event';
    case 'ACCIDENT':
      return 'Incident';
    case 'WEATHER':
      return isFr ? 'Intempéries' : 'Weather';
    case 'POLICE_ACTIVITY':
      return isFr ? 'Intervention police' : 'Police Activity';
    case 'MEDICAL_EMERGENCY':
      return isFr ? 'Urgence médicale' : 'Medical Emergency';
    case 'HOLIDAY':
      return isFr ? 'Horaires jours fériés' : 'Holiday Schedule';
    default:
      return isFr ? 'Exploitation' : 'Operational';
  }
}

export function formatEffectLabel(effect: AlertEffect, locale: 'en' | 'fr' = 'en'): string {
  const isFr = locale === 'fr';
  switch (effect) {
    case 'NO_SERVICE':
      return isFr ? 'Trafic interrompu' : 'Service Suspended';
    case 'REDUCED_SERVICE':
      return isFr ? 'Fréquence réduite' : 'Reduced Frequency';
    case 'SIGNIFICANT_DELAYS':
      return isFr ? 'Retards importants' : 'Significant Delays';
    case 'DETOUR':
      return isFr ? 'Itinéraire dévié' : 'Route Detour';
    case 'ADDITIONAL_SERVICE':
      return isFr ? 'Service renforcé' : 'Additional Service';
    case 'MODIFIED_SERVICE':
      return isFr ? 'Service modifié' : 'Modified Service';
    case 'STOP_MOVED':
      return isFr ? 'Arrêt reporté' : 'Stop Relocated';
    default:
      return isFr ? 'Info trafic' : 'Service Advisory';
  }
}

export function formatAlertDuration(
  startSec: number | null,
  endSec: number | null,
  nowSec: number,
  locale: 'en' | 'fr' = 'en'
): string {
  const isFr = locale === 'fr';
  if (!startSec) return isFr ? 'En cours' : 'Active';
  const target = endSec ?? nowSec;
  const diffSec = Math.max(0, target - startSec);
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);

  if (days >= 30) {
    const months = Math.round(days / 30);
    if (isFr) {
      return endSec ? `Période de ${months} mois` : `Depuis ${months} mois`;
    }
    return endSec ? `${months} mo window` : `${months} mo elapsed`;
  }
  if (days >= 1) {
    if (isFr) {
      return endSec ? `${days} j ${hours} h` : `Active depuis ${days} j ${hours} h`;
    }
    return endSec ? `${days}d ${hours}h window` : `${days}d ${hours}h active`;
  }
  if (hours >= 1) {
    if (isFr) {
      return endSec ? `${hours} h ${mins} min` : `Active depuis ${hours} h ${mins} min`;
    }
    return endSec ? `${hours}h ${mins}m` : `${hours}h ${mins}m active`;
  }
  return `${Math.max(1, mins)} min`;
}

const PARIS_DATETIME_FORMATTERS: Record<'en' | 'fr', Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
  fr: new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }),
};

export function formatParisDateTime(
  epochSec: number | null,
  locale: 'en' | 'fr' = 'en'
): string {
  if (!epochSec) return locale === 'fr' ? 'Jusqu’à nouvel ordre' : 'Until further notice';
  return PARIS_DATETIME_FORMATTERS[locale].format(new Date(epochSec * 1000));
}
