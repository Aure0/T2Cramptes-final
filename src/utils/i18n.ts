export type AppLocale = 'en' | 'fr';

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['fr', 'en'] as const;

export function normalizeLocale(raw: unknown): AppLocale | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'fr' || cleaned.startsWith('fr-') || cleaned.startsWith('fr_')) {
    return 'fr';
  }
  if (cleaned === 'en' || cleaned.startsWith('en-') || cleaned.startsWith('en_')) {
    return 'en';
  }
  return null;
}

export interface DetectLocaleInput {
  urlLocale?: AppLocale | null;
  savedLocale?: AppLocale | null;
  browserLanguages?: readonly string[] | null;
  fallback?: AppLocale;
}

/**
 * Resolves the best UI language in deterministic priority order:
 * 1. Explicit URL parameter (?lang=fr or ?lang=en)
 * 2. Saved user preference from localStorage
 * 3. First supported language in browser preferences (navigator.languages / navigator.language)
 * 4. Fallback locale ('en')
 */
export function detectBestLocale(input: DetectLocaleInput = {}): AppLocale {
  if (input.urlLocale === 'fr' || input.urlLocale === 'en') {
    return input.urlLocale;
  }
  if (input.savedLocale === 'fr' || input.savedLocale === 'en') {
    return input.savedLocale;
  }

  const langs = input.browserLanguages;
  if (langs && langs.length > 0) {
    for (const candidate of langs) {
      const normalized = normalizeLocale(candidate);
      if (normalized) return normalized;
    }
  }

  return input.fallback ?? 'en';
}

export function getBrowserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  const out: string[] = [];
  if (Array.isArray(navigator.languages)) {
    for (const l of navigator.languages) {
      if (typeof l === 'string' && l.trim()) out.push(l);
    }
  }
  if (typeof navigator.language === 'string' && navigator.language.trim()) {
    if (!out.includes(navigator.language)) {
      out.push(navigator.language);
    }
  }
  return out;
}

const en = {
  // Document & Brand
  'app.documentTitle': 'T2Cramptés — Clermont-Ferrand Live Transit',
  'app.brand': 'T2Cramptés',
  'app.city': 'Clermont-Ferrand',
  'app.openMenu': 'Open lines and stations menu',
  'app.retry': 'Retry',
  'app.refresh': 'Refresh',
  'app.refreshTrafficAria': 'Refresh real-time traffic',
  'app.cancel': 'Cancel',
  'app.close': 'Close',
  'app.closeEsc': 'Close (Esc)',
  'app.view': 'View',

  // Language switcher
  'lang.groupAria': 'Language selection',
  'lang.switchToFr': 'Switch language to French (Français)',
  'lang.switchToEn': 'Switch language to English',
  'lang.toggleAriaFr': 'Language: Français — Tap to switch to English',
  'lang.toggleAriaEn': 'Language: English — Tap to switch to Français',

  // Network / API errors
  'error.loadNetwork': 'Unable to load the T2C Clermont-Ferrand transit network.',
  'error.reachLiveFeed': 'Unable to reach live feed',
  'error.loadStation': 'Unable to load real-time arrivals for this station.',
  'error.loadAlerts': 'Unable to load T2C Service Alerts right now.',
  'error.loadPunctuality': 'Unable to load route punctuality history.',

  // Search
  'search.placeholderDesktop': 'Search station or line (e.g. Jaude, Gare, A)…',
  'search.placeholderMobile': 'Search station or line (Jaude, Gare, A)…',
  'search.titleDesktop': 'Search T2C stations or lines (Press / · ↑↓ + Enter to select)',
  'search.aria': 'Search T2C stations or lines',
  'search.clearAria': 'Clear search',
  'search.suggestionsAria': 'Search suggestions',
  'search.mobileSuggestionsAria': 'Mobile search suggestions',
  'search.noMatches': 'No T2C stations or lines matching “{query}”.',
  'search.sectionLines': 'Lines',
  'search.lineShown': 'Shown',
  'search.lineShow': 'Show',
  'search.pinnedStops': 'Pinned Stops',
  'search.stationsHintDesktop': 'Stations (Enter or click for arrivals)',
  'search.stationsHintMobile': 'Stations (Tap for live arrivals)',

  // Header alerts button
  'header.alertsLabel': 'Service Alerts',
  'header.alertsAriaActiveOne': 'Service Alerts: 1 active disruption on your selected lines',
  'header.alertsAriaActiveMany': 'Service Alerts: {count} active disruptions on your selected lines',
  'header.alertsAriaNone': 'Service Alerts: No disruptions on your selected lines. Open disruption history',

  // Mobile inspector bottom sheet
  'sheet.collapseAria': 'Collapse details panel',
  'sheet.expandAria': 'Expand details panel',

  // Control Sidebar
  'sidebar.aria': 'T2C Network Controls',
  'sidebar.drawerTitle': 'Network Explorer',
  'sidebar.closeDrawerAria': 'Close network drawer',
  'sidebar.tablistAria': 'Sidebar sections',
  'sidebar.tabLines': 'Lines ({count})',
  'sidebar.tabLinesTitle': 'Transit Lines (Press 1)',
  'sidebar.tabStations': 'Stations',
  'sidebar.tabStationsTitle': 'Stations & Favorites (Press 2)',
  'sidebar.tabLive': 'Live ({count})',
  'sidebar.tabLiveTitle': 'Live Vehicles (Press 3)',
  'sidebar.presetsLabel': 'Network Presets',
  'sidebar.presetCore': 'A · B · C',
  'sidebar.presetFull': 'Full Network',
  'sidebar.presetClear': 'Clear',
  'sidebar.tierAll': 'All',
  'sidebar.tierLocal': 'Local',
  'sidebar.noMatchingRoutes': 'No T2C lines match this filter.',
  'sidebar.visible': 'Visible',
  'sidebar.hidden': 'Hidden',
  'sidebar.routeAlertTitleOne': '1 active service alert on Line {line} — click to inspect',
  'sidebar.routeAlertTitleMany': '{count} active service alerts on Line {line} — click to inspect',
  'sidebar.routeAlertAriaOne': 'View 1 active service alert on Line {line}',
  'sidebar.routeAlertAriaMany': 'View {count} active service alerts on Line {line}',
  'sidebar.matchingStations': 'Matching stations ({count})',
  'sidebar.activeLineStops': 'Active line stops ({count})',
  'sidebar.clickForArrivals': 'Click for arrivals',
  'sidebar.hubBadge': 'Hub',
  'sidebar.unpinAria': 'Remove {station} from pinned stops',
  'sidebar.unpinTitle': 'Unpin stop',
  'sidebar.pinAria': 'Pin {station} to favorites',
  'sidebar.pinTitle': 'Pin stop to favorites',
  'sidebar.noStations': 'No stations found. Try searching for Place de Jaude, Gare SNCF, or Royat.',
  'sidebar.movingOnEnabled': 'Moving on enabled lines',
  'sidebar.activeVehiclesCountOne': '1 active',
  'sidebar.activeVehiclesCount': '{count} active',
  'sidebar.noActiveVehicles': 'No active vehicles currently moving on the selected lines.',
  'sidebar.nextStopPrefix': 'Next: {stop}',

  // Detail Inspector (Vehicle & Station)
  'inspector.vehicleAria': 'Live vehicle Line {line} toward {headsign}',
  'inspector.tramLine': 'Tramway Line {line}',
  'inspector.busLine': 'Bus / BHNS Line {line}',
  'inspector.unitLabel': 'Unit {label}',
  'inspector.closeVehicleAria': 'Close vehicle inspector',
  'inspector.routeAdvisoryOne': '1 active advisory on Line {line}',
  'inspector.routeAdvisoryMany': '{count} active advisories on Line {line}',
  'inspector.vehicleTabsAria': 'Vehicle inspector views',
  'inspector.tabLiveTrip': 'Live Trip',
  'inspector.tabPunctuality': 'Punctuality',
  'inspector.following': 'Following',
  'inspector.followVehicle': 'Follow vehicle',
  'inspector.depPrefix': 'Dep {time}',
  'inspector.arrivingNow': 'Arriving now',
  'inspector.nextIn': 'Next in {eta}',
  'inspector.stopsLeftOne': '1 stop left',
  'inspector.stopsLeftMany': '{count} stops left',
  'inspector.upcomingStopsTitle': 'Upcoming Stops (Real-Time)',
  'inspector.nextStopTag': 'Next stop',

  'inspector.stationAria': 'Live arrivals at {station}',
  'inspector.stationSubtitle': 'Station Arrivals',
  'inspector.stepFree': 'Step-free',
  'inspector.updatedAt': 'Updated {time}',
  'inspector.removePinTitle': 'Remove from pinned stops',
  'inspector.linkCopiedAria': 'Link copied to clipboard',
  'inspector.copyLinkAria': 'Copy shareable link to this station',
  'inspector.linkCopiedTitle': 'Link copied!',
  'inspector.copyLinkTitle': 'Copy shareable link',
  'inspector.refreshStationAria': 'Refresh station arrivals',
  'inspector.refreshStationTitle': 'Refresh arrivals',
  'inspector.closeStationAria': 'Close station arrivals',
  'inspector.stationAdvisoriesOne': 'Service advisories on Line {lines}',
  'inspector.stationAdvisoriesMany': 'Service advisories on Lines {lines}',
  'inspector.allLines': 'All Lines',
  'inspector.filterByLineTitle': 'Filter by Line {line}',
  'inspector.colLine': 'Line',
  'inspector.colDestStatus': 'Destination & Status',
  'inspector.colArrival': 'Arrival',
  'inspector.noDeparturesTitle': 'No upcoming real-time departures',
  'inspector.noDeparturesBody': 'No vehicles are scheduled at this stop within the next 90 minutes for the selected line filter.',
  'inspector.trackLive': 'Track live',

  // Network Status Indicator
  'status.warningAria': 'Network status warning: {headline}. {detail}',
  'status.okAria': 'Network status: {headline}. Updated {age}.',
  'status.dialogAria': 'Live transit feed status',
  'status.lastUpdate': 'Last update',
  'status.gtfsFeedTime': 'GTFS-RT feed time',
  'status.retryNow': 'Retry now',
  'status.checkNow': 'Check now',

  // Transit Map
  'map.aria': 'Interactive Clermont-Ferrand T2C live transit map',
  'map.stationClickHint': '{station} — Click for live arrivals',
  'map.vehicleTooltip': 'Line {line} → {headsign} (Next: {stop})',
  'map.vehicleMovingSingular': 'vehicle moving',
  'map.vehiclesMoving': 'vehicles moving',
  'map.vehiclesLiveShort': 'live',
  'map.lineSingular': 'line',
  'map.linePlural': 'lines',
  'map.densityLabel': 'Density',
  'map.densityHideAria': 'Hide traffic density heatmap',
  'map.densityShowAria': 'Show traffic density heatmap',
  'map.densityHideTitle': 'Hide traffic density heatmap (D)',
  'map.densityShowTitle': 'Show traffic density heatmap (D)',
  'map.densityTitle': 'Traffic Density',
  'map.densityCongestion': 'Congestion',
  'map.densityVolume': 'Volume',
  'map.unitSingular': 'unit',
  'map.unitPlural': 'units',
  'map.delayedCount': '{count} delayed',
  'map.scopeFullNetwork': 'Full Network',
  'map.scopeActiveLines': 'Active Lines',
  'map.scaleLow': 'Low',
  'map.scaleModerate': 'Moderate',
  'map.scaleCongested': 'Congested',
  'map.scalePeak': 'Peak',
  'map.peakSectors': 'Peak sectors',
  'map.sectorFallback': 'Sector {num}',
  'map.linesPrefix': 'Lines {lines}',
  'map.avgDelayShort': '+{mins}m avg',
  'map.onTime': 'On time',
  'map.zoomInAria': 'Zoom in',
  'map.zoomOutAria': 'Zoom out',
  'map.recenterAria': 'Recenter on Clermont-Ferrand',
  'map.switchToStreetAria': 'Switch basemap to Light Street Map',
  'map.switchToDarkAria': 'Switch basemap to Dark Vector Map',
  'map.basemapDarkLabel': 'Dark Map (Vector)',
  'map.basemapStreetLabel': 'Light Street Map (Vector)',
  'map.basemapTitle': 'Basemap: {label} (Press M)',
  'map.hideStopsAria': 'Hide station markers',
  'map.showStopsAria': 'Show station markers',
  'map.hideLabelsAria': 'Hide stop names on the map',
  'map.showLabelsAria': 'Show stop names on the map',
  'map.labelsTitle': 'Toggle stop names (Press L)',
  'map.labelsShort': 'Stop names',
  'map.labelsCompact': 'Names',
  'map.resumeMotionAria': 'Resume live vehicle motion',
  'map.pauseMotionAria': 'Pause live vehicle motion',
  'map.resumeMotionTitle': 'Resume live motion (Space)',
  'map.pauseMotionTitle': 'Pause live motion (Space)',
  'map.hoverLiveCount': '{count} live',
  'map.hoverAdvisoryOne': '1 active advisory',
  'map.hoverAdvisoryMany': '{count} active advisories',

  // Route Punctuality Chart
  'punctuality.periodGroupAria': 'Punctuality time period',
  'punctuality.period6h': '6H',
  'punctuality.period6hTitle': 'Last 6 hours (30-min intervals)',
  'punctuality.period24h': '24H',
  'punctuality.period24hTitle': 'Last 24 hours (hourly)',
  'punctuality.period7d': '7D',
  'punctuality.period7dTitle': 'Last 7 days (daily)',
  'punctuality.period30d': '30D',
  'punctuality.period30dTitle': 'Last 30 days',
  'punctuality.periodAll': 'All',
  'punctuality.periodAllTitle': 'All time (12-month history)',
  'punctuality.lineHeader': 'Line {line} · Punctuality',
  'punctuality.modeEarlyLate': 'Early / Late',
  'punctuality.modeFullSplit': 'Full Split',
  'punctuality.onTime': 'On time',
  'punctuality.late': 'Late (>90s)',
  'punctuality.early': 'Early (>90s)',
  'punctuality.onTimePct': 'On time %',
  'punctuality.latePct': 'Late %',
  'punctuality.earlyPct': 'Early %',
  'punctuality.sourceLive': 'Live GTFS-RT',
  'punctuality.sourceBaseline': 'Baseline',
  'punctuality.avgLabel': 'Avg {value}',
  'punctuality.nowBucket': 'Now',
  'punctuality.rowAvgOffset': 'Average schedule offset',
  'punctuality.rowPeakLate': 'Peak late window',
  'punctuality.rowBestOnTime': 'Best punctuality',
  'punctuality.rowLiveObs': 'Live GTFS-RT observations',
  'punctuality.tripsLatestBucketOne': '1 trip (latest bucket)',
  'punctuality.tripsLatestBucket': '{count} trips (latest bucket)',
  'punctuality.syncingFeed': 'Syncing live feed',
  'punctuality.footnote':
    'On time is measured within ±{threshold}s of scheduled arrival. Latest period reflects live T2C GTFS-RT telemetry; prior intervals combine observed route snapshots with peak-calibrated baselines.',

  // Service Alerts Drawer
  'alerts.drawerAria': 'Service Alerts and Disruption History',
  'alerts.title': 'Service Alerts & Disruption History',
  'alerts.subtitleUpdated': '{source} · Updated {time}',
  'alerts.connecting': 'Connecting to T2C ServiceAlerts feed…',
  'alerts.refreshAria': 'Refresh service alerts',
  'alerts.closeAria': 'Close service alerts',
  'alerts.kpiYourLines': 'Your Lines',
  'alerts.kpiNetworkActive': 'Network Active',
  'alerts.kpiHistoryLog': 'History Log',
  'alerts.kpiLinesImpacted': 'Lines Impacted',
  'alerts.tablistAria': 'Service alert views',
  'alerts.tabActive': 'Active Alerts',
  'alerts.tabHistory': 'Disruption History',
  'alerts.scopeActiveLines': 'Your Active Lines ({count})',
  'alerts.scopeAllNetwork': 'All Network',
  'alerts.filterPlaceholder': 'Filter by stop, street, line, or alert ID…',
  'alerts.filterAria': 'Filter disruptions',
  'alerts.clearFilterAria': 'Clear disruption filter',
  'alerts.filterLineAria': 'Filter by transit line',
  'alerts.filterCauseAria': 'Filter by cause',
  'alerts.filterStatusAria': 'Filter by disruption status',
  'alerts.allLines': 'All Lines',
  'alerts.allCauses': 'All Causes',
  'alerts.allStatuses': 'All Statuses',
  'alerts.statusActiveOnly': 'Active Only',
  'alerts.statusResolvedOnly': 'Resolved Only',
  'alerts.lineOption': 'Line {line}',
  'alerts.emptyActiveTitle': 'No disruptions on your active lines',
  'alerts.emptyFilterTitle': 'No disruptions match your filters',
  'alerts.emptyOtherLinesBody': 'There are {count} active advisories on other T2C lines.',
  'alerts.emptyNormalBody': 'Traffic is operating normally across the selected filter scope.',
  'alerts.viewAllDisruptions': 'View all {count} network disruptions',
  'alerts.sevResolved': 'Resolved',
  'alerts.sevSevere': 'Severe',
  'alerts.sevModerate': 'Moderate',
  'alerts.sevAdvisory': 'Advisory',
  'alerts.activeLineTag': 'Active line',
  'alerts.stopsReferencedOne': '1 stop referenced',
  'alerts.stopsReferencedMany': '{count} stops referenced',
  'alerts.metaStart': 'Effective start',
  'alerts.metaImmediate': 'Immediate',
  'alerts.metaResolvedAt': 'Resolved at',
  'alerts.metaScheduledEnd': 'Scheduled end',
  'alerts.metaLastUpdate': 'Last operator update',
  'alerts.metaCauseEffect': 'GTFS-RT cause & effect',
  'alerts.metaFeedSource': 'Feed source',
  'alerts.metaIdPriority': 'Disruption ID · Priority',
  'alerts.impactedStops': 'Impacted & relocated stops ({count})',
  'alerts.officialDetails': 'Official T2C advisory details',
  'alerts.revisionLog': 'Disruption lifecycle & revision log',
  'alerts.firstObserved': 'First observed live:',
  'alerts.showOneLineOnMap': 'Show Line {line} on Map',
  'alerts.showManyLinesOnMap': 'Show {count} Lines on Map',

  // Android / PWA installation & offline status
  'pwa.installApp': 'Install App',
  'pwa.installAppAria': 'Install T2Cramptés as an Android app',
  'pwa.androidApp': 'Android App',
  'pwa.androidAppAria': 'Install T2Cramptés on Android',
  'pwa.installIosShort': 'Install App',
  'pwa.installIosAria': 'Install T2Cramptés on iPhone or iPad',
  'pwa.badgeAndroid': 'Android',
  'pwa.badgeApk': 'APK',
  'pwa.downloadApk': 'Download Latest APK',
  'pwa.downloadApkAria': 'Download the latest T2Cramptés Android APK from GitHub Releases',
  'pwa.instantBadge': 'Instant',
  'pwa.modalAndroidTitle': 'Get T2Cramptés on Android',
  'pwa.modalIosTitle': 'Install on iPhone / iPad',
  'pwa.modalSubtitle': 'Full-screen home screen app + offline topology cache',
  'pwa.androidOption1Title': 'Instant Web Install (Chrome on Android)',
  'pwa.androidStep1': 'Open this page in Chrome on your Android phone.',
  'pwa.androidStep2': 'Tap the ⋮ menu in the top-right corner of Chrome.',
  'pwa.androidStep3': 'Tap “Install app” (or “Add to Home screen”) for a standalone full-screen Android app.',
  'pwa.androidOption2Title': 'Native Android APK (GitHub Releases)',
  'pwa.androidApkDesc':
    'Every build publishes T2Cramptes-latest.apk to GitHub Releases (.github/workflows/build-android-apk.yml). You can also build locally with Capacitor:',
  'pwa.iosStepsHeading': 'Add to your Home Screen in Safari',
  'pwa.iosStep1': 'Tap the Share button in the Safari toolbar.',
  'pwa.iosStep2': 'Scroll down and tap “Add to Home Screen”.',
  'pwa.iosStep3': 'Tap “Add” to launch T2Cramptés full-screen.',
  'pwa.offlineCachedBanner': 'Offline Mode — Showing cached T2C network data',

  // GPS / Around Me
  'map.locateMeAria': 'Center map on my location',
  'map.locateMeTitle': 'Around me (GPS)',
  'map.locatingTitle': 'Locating…',
  'sidebar.nearMeTitle': 'Near me',
  'sidebar.locateBtn': 'Around me',
  'sidebar.locatingBtn': 'Locating…',
  'sidebar.walkMin': '{mins} min walk',
  'sidebar.gpsDenied': 'Location permission denied.',
  'sidebar.gpsUnavailable': 'Unable to determine your location.',
  'sidebar.noNearbyStops': 'No T2C stops found within 2.5 km.',

  // Station direction grouping
  'inspector.viewByDirection': 'By direction',
  'inspector.viewChrono': 'Chronological',
  'inspector.nextDeparturesCount': '{count} upcoming',

  // Departure reminders
  'reminder.setAria': 'Alert 5 min before Line {line} to {headsign}',
  'reminder.removeAria': 'Cancel alert for Line {line} to {headsign}',
  'reminder.setTitle': 'Alert 5 min before arrival',
  'reminder.armedTitle': 'Reminder active (5 min before) — click to cancel',
  'reminder.bannerTitle': 'Line {line} approaching {station}',
  'reminder.bannerBody': 'Toward {headsign} · arrives in {eta}',
  'reminder.notifTitle': 'T2Cramptés — Line {line} at {station}',
  'reminder.notifBody': 'Toward {headsign} arriving in ~{mins} min.',

  // GTFS topology freshness
  'status.gtfsTopology': 'GTFS topology',
  'status.gtfsFresh': 'Up to date',
  'status.gtfsStale': '{days} days old',
  'status.gtfsStaleNotice':
    'Static GTFS map data is {days} days old. Update the app or rebuild static data for the latest route changes.',

  // Android update checker
  'update.availableText': 'New Android version available ({version})',
  'update.downloadCta': 'Update APK',
} as const;

export type TranslationKey = keyof typeof en;

const fr: Record<TranslationKey, string> = {
  // Document & Brand
  'app.documentTitle': 'T2Cramptés — Trafic T2C en direct',
  'app.brand': 'T2Cramptés',
  'app.city': 'Clermont-Ferrand',
  'app.openMenu': 'Ouvrir le menu des lignes et arrêts',
  'app.retry': 'Réessayer',
  'app.refresh': 'Actualiser',
  'app.refreshTrafficAria': 'Actualiser le trafic en temps réel',
  'app.cancel': 'Annuler',
  'app.close': 'Fermer',
  'app.closeEsc': 'Fermer (Échap)',
  'app.view': 'Voir',

  // Language switcher
  'lang.groupAria': 'Choix de la langue',
  'lang.switchToFr': 'Passer l’interface en français',
  'lang.switchToEn': 'Passer l’interface en anglais (English)',
  'lang.toggleAriaFr': 'Langue : Français — Toucher pour passer en anglais',
  'lang.toggleAriaEn': 'Langue : English — Toucher pour passer en français',

  // Network / API errors
  'error.loadNetwork': 'Impossible de charger le réseau T2C de Clermont-Ferrand.',
  'error.reachLiveFeed': 'Impossible de joindre le flux temps réel',
  'error.loadStation': 'Impossible de charger les prochains passages pour cet arrêt.',
  'error.loadAlerts': 'Impossible de charger les infos trafic T2C pour le moment.',
  'error.loadPunctuality': 'Impossible de charger l’historique de ponctualité.',

  // Search
  'search.placeholderDesktop': 'Rechercher un arrêt ou une ligne (ex. Jaude, Gare, A)…',
  'search.placeholderMobile': 'Arrêt ou ligne (Jaude, Gare, A)…',
  'search.titleDesktop': 'Rechercher un arrêt ou une ligne T2C (Touche / · ↑↓ + Entrée)',
  'search.aria': 'Rechercher un arrêt ou une ligne T2C',
  'search.clearAria': 'Effacer la recherche',
  'search.suggestionsAria': 'Suggestions de recherche',
  'search.mobileSuggestionsAria': 'Suggestions de recherche mobile',
  'search.noMatches': 'Aucun arrêt ni ligne T2C ne correspond à « {query} ».',
  'search.sectionLines': 'Lignes',
  'search.lineShown': 'Affichée',
  'search.lineShow': 'Afficher',
  'search.pinnedStops': 'Arrêts favoris',
  'search.stationsHintDesktop': 'Arrêts (Entrée ou clic pour les passages)',
  'search.stationsHintMobile': 'Arrêts (Toucher pour les prochains passages)',

  // Header alerts button
  'header.alertsLabel': 'Infos trafic',
  'header.alertsAriaActiveOne': 'Infos trafic : 1 perturbation active sur vos lignes sélectionnées',
  'header.alertsAriaActiveMany': 'Infos trafic : {count} perturbations actives sur vos lignes sélectionnées',
  'header.alertsAriaNone': 'Infos trafic : aucune perturbation sur vos lignes. Ouvrir l’historique',

  // Mobile inspector bottom sheet
  'sheet.collapseAria': 'Réduire le panneau de détails',
  'sheet.expandAria': 'Agrandir le panneau de détails',

  // Control Sidebar
  'sidebar.aria': 'Contrôles du réseau T2C',
  'sidebar.drawerTitle': 'Explorateur du réseau',
  'sidebar.closeDrawerAria': 'Fermer le panneau du réseau',
  'sidebar.tablistAria': 'Sections du panneau latéral',
  'sidebar.tabLines': 'Lignes ({count})',
  'sidebar.tabLinesTitle': 'Lignes du réseau (Touche 1)',
  'sidebar.tabStations': 'Arrêts',
  'sidebar.tabStationsTitle': 'Arrêts et favoris (Touche 2)',
  'sidebar.tabLive': 'Direct ({count})',
  'sidebar.tabLiveTitle': 'Véhicules en circulation (Touche 3)',
  'sidebar.presetsLabel': 'Sélections rapides',
  'sidebar.presetCore': 'A · B · C',
  'sidebar.presetFull': 'Complet',
  'sidebar.presetClear': 'Effacer',
  'sidebar.tierAll': 'Toutes',
  'sidebar.tierLocal': 'Locales',
  'sidebar.noMatchingRoutes': 'Aucune ligne T2C ne correspond à ce filtre.',
  'sidebar.visible': 'Visible',
  'sidebar.hidden': 'Masquée',
  'sidebar.routeAlertTitleOne': '1 alerte trafic active sur la ligne {line} — cliquer pour consulter',
  'sidebar.routeAlertTitleMany': '{count} alertes trafic actives sur la ligne {line} — cliquer pour consulter',
  'sidebar.routeAlertAriaOne': 'Voir 1 alerte trafic active sur la ligne {line}',
  'sidebar.routeAlertAriaMany': 'Voir les {count} alertes trafic actives sur la ligne {line}',
  'sidebar.matchingStations': 'Arrêts trouvés ({count})',
  'sidebar.activeLineStops': 'Arrêts actifs ({count})',
  'sidebar.clickForArrivals': 'Voir les horaires',
  'sidebar.hubBadge': 'Pôle',
  'sidebar.unpinAria': 'Retirer {station} des favoris',
  'sidebar.unpinTitle': 'Retirer des favoris',
  'sidebar.pinAria': 'Ajouter {station} aux favoris',
  'sidebar.pinTitle': 'Ajouter aux favoris',
  'sidebar.noStations': 'Aucun arrêt trouvé. Essayez Place de Jaude, Gare SNCF ou Royat.',
  'sidebar.movingOnEnabled': 'En circulation sur vos lignes',
  'sidebar.activeVehiclesCountOne': '1 actif',
  'sidebar.activeVehiclesCount': '{count} actifs',
  'sidebar.noActiveVehicles': 'Aucun véhicule actuellement en circulation sur les lignes affichées.',
  'sidebar.nextStopPrefix': 'Prochain : {stop}',

  // Detail Inspector (Vehicle & Station)
  'inspector.vehicleAria': 'Véhicule en direct Ligne {line} direction {headsign}',
  'inspector.tramLine': 'Tramway Ligne {line}',
  'inspector.busLine': 'Bus / BHNS Ligne {line}',
  'inspector.unitLabel': 'Véhicule {label}',
  'inspector.closeVehicleAria': 'Fermer la fiche du véhicule',
  'inspector.routeAdvisoryOne': '1 info trafic active sur la ligne {line}',
  'inspector.routeAdvisoryMany': '{count} infos trafic actives sur la ligne {line}',
  'inspector.vehicleTabsAria': 'Vues du véhicule',
  'inspector.tabLiveTrip': 'Trajet en direct',
  'inspector.tabPunctuality': 'Ponctualité',
  'inspector.following': 'Suivi actif',
  'inspector.followVehicle': 'Suivre',
  'inspector.depPrefix': 'Dép. {time}',
  'inspector.arrivingNow': 'À l’approche',
  'inspector.nextIn': 'Prochain dans {eta}',
  'inspector.stopsLeftOne': '1 arrêt restant',
  'inspector.stopsLeftMany': '{count} arrêts restants',
  'inspector.upcomingStopsTitle': 'Prochains arrêts (temps réel)',
  'inspector.nextStopTag': 'Prochain arrêt',

  'inspector.stationAria': 'Prochains passages à {station}',
  'inspector.stationSubtitle': 'Prochains passages',
  'inspector.stepFree': 'Accessible PMR',
  'inspector.updatedAt': 'Màj {time}',
  'inspector.removePinTitle': 'Retirer des arrêts favoris',
  'inspector.linkCopiedAria': 'Lien copié dans le presse-papiers',
  'inspector.copyLinkAria': 'Copier un lien de partage vers cet arrêt',
  'inspector.linkCopiedTitle': 'Lien copié !',
  'inspector.copyLinkTitle': 'Copier le lien de partage',
  'inspector.refreshStationAria': 'Actualiser les passages à l’arrêt',
  'inspector.refreshStationTitle': 'Actualiser les passages',
  'inspector.closeStationAria': 'Fermer les passages à l’arrêt',
  'inspector.stationAdvisoriesOne': 'Infos trafic sur la ligne {lines}',
  'inspector.stationAdvisoriesMany': 'Infos trafic sur les lignes {lines}',
  'inspector.allLines': 'Toutes',
  'inspector.filterByLineTitle': 'Filtrer par la ligne {line}',
  'inspector.colLine': 'Ligne',
  'inspector.colDestStatus': 'Destination & état',
  'inspector.colArrival': 'Passage',
  'inspector.noDeparturesTitle': 'Aucun passage temps réel à venir',
  'inspector.noDeparturesBody': 'Aucun véhicule n’est prévu à cet arrêt dans les 90 prochaines minutes pour le filtre sélectionné.',
  'inspector.trackLive': 'Suivre en direct',

  // Network Status Indicator
  'status.warningAria': 'Alerte état du réseau : {headline}. {detail}',
  'status.okAria': 'État du réseau : {headline}. Mis à jour {age}.',
  'status.dialogAria': 'État du flux temps réel',
  'status.lastUpdate': 'Dernière mise à jour',
  'status.gtfsFeedTime': 'Horodatage GTFS-RT',
  'status.retryNow': 'Réessayer',
  'status.checkNow': 'Vérifier',

  // Transit Map
  'map.aria': 'Carte interactive du trafic T2C de Clermont-Ferrand en direct',
  'map.stationClickHint': '{station} — Cliquer pour les prochains passages',
  'map.vehicleTooltip': 'Ligne {line} → {headsign} (Prochain : {stop})',
  'map.vehicleMovingSingular': 'véhicule en direct',
  'map.vehiclesMoving': 'véhicules en direct',
  'map.vehiclesLiveShort': 'en direct',
  'map.lineSingular': 'ligne',
  'map.linePlural': 'lignes',
  'map.densityLabel': 'Densité',
  'map.densityHideAria': 'Masquer la carte de densité du trafic',
  'map.densityShowAria': 'Afficher la carte de densité du trafic',
  'map.densityHideTitle': 'Masquer la densité du trafic (D)',
  'map.densityShowTitle': 'Afficher la densité du trafic (D)',
  'map.densityTitle': 'Densité du trafic',
  'map.densityCongestion': 'Congestion',
  'map.densityVolume': 'Volume',
  'map.unitSingular': 'véhicule',
  'map.unitPlural': 'véhicules',
  'map.delayedCount': '{count} en retard',
  'map.scopeFullNetwork': 'Tout le réseau',
  'map.scopeActiveLines': 'Lignes actives',
  'map.scaleLow': 'Fluide',
  'map.scaleModerate': 'Modéré',
  'map.scaleCongested': 'Chargé',
  'map.scalePeak': 'Dense',
  'map.peakSectors': 'Secteurs denses',
  'map.sectorFallback': 'Secteur {num}',
  'map.linesPrefix': 'Lignes {lines}',
  'map.avgDelayShort': '+{mins} min moy.',
  'map.onTime': 'À l’heure',
  'map.zoomInAria': 'Zoomer',
  'map.zoomOutAria': 'Dézoomer',
  'map.recenterAria': 'Recentrer sur Clermont-Ferrand',
  'map.switchToStreetAria': 'Passer au fond de carte Clair',
  'map.switchToDarkAria': 'Passer au fond de carte Sombre',
  'map.basemapDarkLabel': 'Carte Sombre (Vecteur)',
  'map.basemapStreetLabel': 'Carte Claire (Vecteur)',
  'map.basemapTitle': 'Fond de carte : {label} (Touche M)',
  'map.hideStopsAria': 'Masquer les arrêts',
  'map.showStopsAria': 'Afficher les arrêts',
  'map.hideLabelsAria': 'Masquer les noms des arrêts sur la carte',
  'map.showLabelsAria': 'Afficher les noms des arrêts sur la carte',
  'map.labelsTitle': 'Afficher / masquer les noms des arrêts (Touche L)',
  'map.labelsShort': 'Noms des arrêts',
  'map.labelsCompact': 'Noms',
  'map.resumeMotionAria': 'Reprendre l’animation des véhicules',
  'map.pauseMotionAria': 'Mettre en pause l’animation des véhicules',
  'map.resumeMotionTitle': 'Reprendre le mouvement (Espace)',
  'map.pauseMotionTitle': 'Mettre en pause le mouvement (Espace)',
  'map.hoverLiveCount': '{count} en direct',
  'map.hoverAdvisoryOne': '1 info trafic active',
  'map.hoverAdvisoryMany': '{count} infos trafic actives',

  // Route Punctuality Chart
  'punctuality.periodGroupAria': 'Période de ponctualité',
  'punctuality.period6h': '6H',
  'punctuality.period6hTitle': '6 dernières heures (tranches de 30 min)',
  'punctuality.period24h': '24H',
  'punctuality.period24hTitle': '24 dernières heures (par heure)',
  'punctuality.period7d': '7J',
  'punctuality.period7dTitle': '7 derniers jours (par jour)',
  'punctuality.period30d': '30J',
  'punctuality.period30dTitle': '30 derniers jours',
  'punctuality.periodAll': 'Tout',
  'punctuality.periodAllTitle': 'Historique annuel (12 mois)',
  'punctuality.lineHeader': 'Ligne {line} · Ponctualité',
  'punctuality.modeEarlyLate': 'Avance / Retard',
  'punctuality.modeFullSplit': 'Répartition',
  'punctuality.onTime': 'À l’heure',
  'punctuality.late': 'Retard (>90s)',
  'punctuality.early': 'Avance (>90s)',
  'punctuality.onTimePct': 'À l’heure %',
  'punctuality.latePct': 'Retard %',
  'punctuality.earlyPct': 'Avance %',
  'punctuality.sourceLive': 'GTFS-RT direct',
  'punctuality.sourceBaseline': 'Référence',
  'punctuality.avgLabel': 'Moy. {value}',
  'punctuality.nowBucket': 'Actuel',
  'punctuality.rowAvgOffset': 'Écart horaire moyen',
  'punctuality.rowPeakLate': 'Pic de retard',
  'punctuality.rowBestOnTime': 'Meilleure ponctualité',
  'punctuality.rowLiveObs': 'Mesures GTFS-RT en direct',
  'punctuality.tripsLatestBucketOne': '1 course (dernier créneau)',
  'punctuality.tripsLatestBucket': '{count} courses (dernier créneau)',
  'punctuality.syncingFeed': 'Synchronisation du flux',
  'punctuality.footnote':
    'Un passage est considéré à l’heure dans un intervalle de ±{threshold} s par rapport à l’horaire prévu. La dernière tranche reflète la télémétrie GTFS-RT T2C en direct ; les tranches précédentes combinent les relevés observés et des références calibrées.',

  // Service Alerts Drawer
  'alerts.drawerAria': 'Infos trafic et historique des perturbations',
  'alerts.title': 'Infos trafic & historique',
  'alerts.subtitleUpdated': '{source} · Màj {time}',
  'alerts.connecting': 'Connexion au flux ServiceAlerts T2C…',
  'alerts.refreshAria': 'Actualiser les infos trafic',
  'alerts.closeAria': 'Fermer les infos trafic',
  'alerts.kpiYourLines': 'Vos lignes',
  'alerts.kpiNetworkActive': 'Réseau actif',
  'alerts.kpiHistoryLog': 'Historique',
  'alerts.kpiLinesImpacted': 'Lignes impactées',
  'alerts.tablistAria': 'Vues des alertes trafic',
  'alerts.tabActive': 'Alertes actives',
  'alerts.tabHistory': 'Historique',
  'alerts.scopeActiveLines': 'Vos lignes ({count})',
  'alerts.scopeAllNetwork': 'Tout le réseau',
  'alerts.filterPlaceholder': 'Filtrer par arrêt, rue, ligne ou n° d’alerte…',
  'alerts.filterAria': 'Filtrer les perturbations',
  'alerts.clearFilterAria': 'Effacer le filtre',
  'alerts.filterLineAria': 'Filtrer par ligne',
  'alerts.filterCauseAria': 'Filtrer par cause',
  'alerts.filterStatusAria': 'Filtrer par statut',
  'alerts.allLines': 'Toutes les lignes',
  'alerts.allCauses': 'Toutes causes',
  'alerts.allStatuses': 'Tous statuts',
  'alerts.statusActiveOnly': 'Actives uniquement',
  'alerts.statusResolvedOnly': 'Résolues uniquement',
  'alerts.lineOption': 'Ligne {line}',
  'alerts.emptyActiveTitle': 'Aucune perturbation sur vos lignes actives',
  'alerts.emptyFilterTitle': 'Aucune perturbation ne correspond à vos filtres',
  'alerts.emptyOtherLinesBody': 'Il y a {count} infos trafic actives sur d’autres lignes T2C.',
  'alerts.emptyNormalBody': 'Le trafic circule normalement sur le périmètre sélectionné.',
  'alerts.viewAllDisruptions': 'Voir les {count} perturbations du réseau',
  'alerts.sevResolved': 'Résolue',
  'alerts.sevSevere': 'Majeure',
  'alerts.sevModerate': 'Modérée',
  'alerts.sevAdvisory': 'Information',
  'alerts.activeLineTag': 'Ligne active',
  'alerts.stopsReferencedOne': '1 arrêt mentionné',
  'alerts.stopsReferencedMany': '{count} arrêts mentionnés',
  'alerts.metaStart': 'Début d’effet',
  'alerts.metaImmediate': 'Immédiat',
  'alerts.metaResolvedAt': 'Résolue le',
  'alerts.metaScheduledEnd': 'Fin prévue',
  'alerts.metaLastUpdate': 'Dernière mise à jour',
  'alerts.metaCauseEffect': 'Cause & effet GTFS-RT',
  'alerts.metaFeedSource': 'Source du flux',
  'alerts.metaIdPriority': 'ID perturbation · Priorité',
  'alerts.impactedStops': 'Arrêts impactés ou reportés ({count})',
  'alerts.officialDetails': 'Détails officiels T2C',
  'alerts.revisionLog': 'Cycle de vie & révisions',
  'alerts.firstObserved': 'Première observation :',
  'alerts.showOneLineOnMap': 'Afficher la ligne {line} sur la carte',
  'alerts.showManyLinesOnMap': 'Afficher les {count} lignes sur la carte',

  // Android / PWA installation & offline status
  'pwa.installApp': 'Installer',
  'pwa.installAppAria': 'Installer T2Cramptés sur Android',
  'pwa.androidApp': 'App Android',
  'pwa.androidAppAria': 'Installer T2Cramptés sur Android',
  'pwa.installIosShort': 'Installer',
  'pwa.installIosAria': 'Installer T2Cramptés sur iPhone ou iPad',
  'pwa.badgeAndroid': 'Android',
  'pwa.badgeApk': 'APK',
  'pwa.downloadApk': 'Télécharger l’APK',
  'pwa.downloadApkAria': 'Télécharger la dernière version APK Android de T2Cramptés depuis GitHub Releases',
  'pwa.instantBadge': 'Instantané',
  'pwa.modalAndroidTitle': 'Installer T2Cramptés sur Android',
  'pwa.modalIosTitle': 'Installer sur iPhone / iPad',
  'pwa.modalSubtitle': 'Application plein écran + carte du réseau hors ligne',
  'pwa.androidOption1Title': 'Installation web directe (Chrome Android)',
  'pwa.androidStep1': 'Ouvrez cette page dans Chrome sur votre téléphone Android.',
  'pwa.androidStep2': 'Touchez le menu ⋮ en haut à droite de Chrome.',
  'pwa.androidStep3': 'Sélectionnez « Installer l’application » (ou « Ajouter à l’écran d’accueil »).',
  'pwa.androidOption2Title': 'APK Android natif (GitHub Releases)',
  'pwa.androidApkDesc':
    'Chaque build publie T2Cramptes-latest.apk sur la page GitHub Releases (.github/workflows/build-android-apk.yml). Vous pouvez aussi compiler localement avec Capacitor :',
  'pwa.iosStepsHeading': 'Ajouter à l’écran d’accueil dans Safari',
  'pwa.iosStep1': 'Touchez le bouton Partager dans la barre Safari.',
  'pwa.iosStep2': 'Faites défiler et touchez « Sur l’écran d’accueil ».',
  'pwa.iosStep3': 'Touchez « Ajouter » pour lancer T2Cramptés en plein écran.',
  'pwa.offlineCachedBanner': 'Mode hors ligne — Données T2C en cache affichées',

  // GPS / Autour de moi
  'map.locateMeAria': 'Centrer la carte sur ma position',
  'map.locateMeTitle': 'Autour de moi (GPS)',
  'map.locatingTitle': 'Localisation…',
  'sidebar.nearMeTitle': 'Près de moi',
  'sidebar.locateBtn': 'Autour de moi',
  'sidebar.locatingBtn': 'Localisation…',
  'sidebar.walkMin': '{mins} min à pied',
  'sidebar.gpsDenied': 'Autorisation GPS refusée.',
  'sidebar.gpsUnavailable': 'Position GPS indisponible.',
  'sidebar.noNearbyStops': 'Aucun arrêt T2C à moins de 2,5 km.',

  // Groupement par direction
  'inspector.viewByDirection': 'Par direction',
  'inspector.viewChrono': 'Chronologique',
  'inspector.nextDeparturesCount': '{count} passages',

  // Rappel d'approche
  'reminder.setAria': 'Alerte 5 min avant la ligne {line} vers {headsign}',
  'reminder.removeAria': 'Annuler l’alerte pour la ligne {line} vers {headsign}',
  'reminder.setTitle': 'Alerte 5 min avant le passage',
  'reminder.armedTitle': 'Rappel actif (5 min avant) — cliquer pour annuler',
  'reminder.bannerTitle': 'Ligne {line} à l’approche de {station}',
  'reminder.bannerBody': 'Direction {headsign} · passage dans {eta}',
  'reminder.notifTitle': 'T2Cramptés — Ligne {line} à {station}',
  'reminder.notifBody': 'Direction {headsign} dans environ {mins} min.',

  // Fraîcheur topologie GTFS
  'status.gtfsTopology': 'Topologie GTFS',
  'status.gtfsFresh': 'À jour',
  'status.gtfsStale': 'Âgée de {days} j',
  'status.gtfsStaleNotice':
    'Les données statiques GTFS datent de {days} jours. Mettez à jour l’application pour intégrer les derniers tracés.',

  // Mise à jour Android
  'update.availableText': 'Nouvelle version Android disponible ({version})',
  'update.downloadCta': 'Mettre à jour',
};

export const TRANSLATIONS: Record<AppLocale, Record<TranslationKey, string>> = {
  en,
  fr,
};

export function translate(
  locale: AppLocale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
  let template = dict[key] ?? TRANSLATIONS.en[key] ?? key;
  if (!params) return template;
  for (const [k, v] of Object.entries(params)) {
    template = template.replaceAll(`{${k}}`, String(v));
  }
  return template;
}

const REVISION_SUMMARY_FR: Record<string, string> = {
  'Active period began (GTFS-RT ServiceAlerts)': 'Début de la période d’effet (GTFS-RT ServiceAlerts)',
  'Observed live in GTFS-RT ServiceAlerts feed': 'Observée en direct dans le flux GTFS-RT ServiceAlerts',
  'Advisory created in T2C SIV': 'Alerte créée dans le SIV T2C',
  'Disruption effective window began': 'Début de la période de perturbation',
  'Latest operator update published': 'Dernière mise à jour opérateur publiée',
  'First observed in live monitoring feed': 'Première observation dans le flux en direct',
  'Disruption re-appeared in live feed': 'Perturbation réapparue dans le flux en direct',
  'Advisory text or affected stop details updated': 'Texte ou arrêts concernés mis à jour',
  'Operator timestamp refreshed': 'Horodatage opérateur actualisé',
  'Cleared from live ServiceAlerts feed': 'Levée du flux ServiceAlerts en direct',
};

export function localizeRevisionSummary(summary: string, locale: AppLocale): string {
  if (locale !== 'fr') return summary;
  const direct = REVISION_SUMMARY_FR[summary];
  if (direct) return direct;
  const delayDetectMatch =
    /^Detected via live GTFS-RT TripUpdates \((\d+)\/(\d+) vehicles delayed\)$/.exec(summary);
  if (delayDetectMatch) {
    return `Détectée via GTFS-RT TripUpdates en direct (${delayDetectMatch[1]}/${delayDetectMatch[2]} véhicules en retard)`;
  }
  return summary;
}

const ALERT_LINK_LABEL_FR: Record<string, string> = {
  'Official T2C Notice': 'Notice officielle T2C',
  'Official Alert Link': 'Lien officiel de l’alerte',
};

export function localizeAlertLinkLabel(label: string, locale: AppLocale): string {
  if (locale !== 'fr') return label;
  return ALERT_LINK_LABEL_FR[label] ?? label;
}

const ALERT_SOURCE_LABEL_FR: Record<string, string> = {
  'GTFS-RT TripUpdates Telemetry': 'Télémétrie GTFS-RT TripUpdates',
  'GTFS-RT ServiceAlerts': 'Alertes GTFS-RT ServiceAlerts',
  'T2C ServiceAlerts (SIV)': 'Infos trafic T2C (SIV)',
};

export function localizeServiceAlertText(
  alert: {
    source: string;
    sourceLabel: string;
    headerText: string;
    paragraphs: string[];
  },
  locale: AppLocale
): { sourceLabel: string; headerText: string; paragraphs: string[] } {
  if (locale !== 'fr') {
    return {
      sourceLabel: alert.sourceLabel,
      headerText: alert.headerText,
      paragraphs: alert.paragraphs,
    };
  }

  const sourceLabel = ALERT_SOURCE_LABEL_FR[alert.sourceLabel] ?? alert.sourceLabel;
  let headerText = alert.headerText;
  let paragraphs = alert.paragraphs;

  if (alert.headerText === 'Service Disruption') {
    headerText = 'Perturbation sur le réseau';
  } else if (alert.headerText === 'T2C Service Advisory') {
    headerText = 'Information trafic T2C';
  } else if (alert.source === 'gtfs-rt-delay') {
    const headerMatch =
      /^Line ([^:]+): Significant delays detected \(\+(\d+) min avg\)$/.exec(alert.headerText);
    if (headerMatch) {
      headerText = `Ligne ${headerMatch[1]} : retards importants détectés (+${headerMatch[2]} min moy.)`;
    }
    paragraphs = alert.paragraphs.map((p) => {
      const p1 =
        /^(\d+) of (\d+) active vehicles on Line (.+?) are currently delayed by more than 3 minutes in real-time GTFS-RT telemetry\.$/.exec(
          p
        );
      if (p1) {
        return `${p1[1]} véhicules actifs sur ${p1[2]} de la ligne ${p1[3]} accusent actuellement plus de 3 minutes de retard dans la télémétrie GTFS-RT en temps réel.`;
      }
      const p2 =
        /^Average schedule offset across active units is \+(\d+) min, with a peak observed delay of \+(\d+) min\.$/.exec(
          p
        );
      if (p2) {
        return `L’écart horaire moyen sur les véhicules en circulation est de +${p2[1]} min, avec un pic observé à +${p2[2]} min.`;
      }
      return p;
    });
  }

  return { sourceLabel, headerText, paragraphs };
}

const ALERT_FEED_SOURCE_FR: Record<string, string> = {
  'GTFS-RT ServiceAlerts + T2C SIV': 'GTFS-RT ServiceAlerts + SIV T2C',
  'T2C ServiceAlerts (SIV + GTFS-RT)': 'Infos trafic T2C (SIV + GTFS-RT)',
  'T2C ServiceAlerts (Snapshot)': 'Infos trafic T2C (instantané)',
};

export function localizeAlertFeedSource(feedSource: string, locale: AppLocale): string {
  if (locale !== 'fr') return feedSource;
  return ALERT_FEED_SOURCE_FR[feedSource] ?? feedSource;
}

const PUNCTUALITY_TOKEN_FR: Record<string, string> = {
  Mon: 'Lun',
  Tue: 'Mar',
  Wed: 'Mer',
  Thu: 'Jeu',
  Fri: 'Ven',
  Sat: 'Sam',
  Sun: 'Dim',
  Jan: 'Janv.',
  Feb: 'Fév.',
  Mar: 'Mars',
  Apr: 'Avr.',
  May: 'Mai',
  Jun: 'Juin',
  Jul: 'Juil.',
  Aug: 'Août',
  Sep: 'Sept.',
  Oct: 'Oct.',
  Nov: 'Nov.',
  Dec: 'Déc.',
};

const PUNCTUALITY_TOKEN_REGEX = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;

export function localizePunctualityLabel(label: string, locale: AppLocale): string {
  if (locale !== 'fr') return label;
  if (label === 'Now') return TRANSLATIONS.fr['punctuality.nowBucket'];
  // Single-pass replacement so weekday "Tue" -> "Mar" is never re-matched as month "Mar" -> "Mars"
  return label.replace(PUNCTUALITY_TOKEN_REGEX, (token) => PUNCTUALITY_TOKEN_FR[token] ?? token);
}
