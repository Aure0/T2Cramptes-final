# T2Cramptés

Suivi en temps réel du réseau **T2C Clermont-Ferrand** (Tramway A, BHNS B & C et l'ensemble des lignes de bus) — **100 % gratuit, open-source et sans clé API**.

- **Web (GitHub Pages)** : https://aure0.github.io/t2cramptes-android/
- **APK Android (dernière version)** : [Télécharger `T2Cramptes-latest.apk`](https://github.com/aure0/t2cramptes-android/releases/latest/download/T2Cramptes-latest.apk)

---

## Fonctionnalités

- **Carte vectorielle haute fluidité (100 % WebGL GPU)** : MapLibre GL JS + CARTO Vector avec secours OpenFreeMap / Raster (Sombre & Clair), fusion aller/retour, empilement parallèle des tronçons partagés, pôles multi-modes distincts (ex. Jaude Tram / Bus), arrêts fixes et **véhicules rendus sur couche WebGL GPU** avec flèches de direction orientées.
- **Véhicules en direct & suivi** : flux officiel GTFS-RT T2C (`transport.data.gouv.fr`) actualisé toutes les 12 s, projection exacte sur le tracé, interpolation curviligne 30 fps avec cap lissé et suivi caméra à zone morte.
- **Autour de moi (GPS), horaires par direction & alertes d'approche** : localisation de l'utilisateur et tri des arrêts les plus proches avec temps de marche, regroupement des prochains départs par terminus/direction ou chronologique, rappel 5 minutes avant l'arrivée (notification + vibration), favoris persistants et liens partageables (`?lines=A,B&station=…`).
- **Infos trafic, densité & ponctualité** : perturbations T2C SIV + historique, indicateur de fraîcheur de la topologie GTFS, carte de chaleur de congestion/volume et graphiques SVG natifs de ponctualité par ligne (`6H` / `24H` / `7J` / `30J` / `Tout`).
- **Interface FR / EN & raccourcis clavier** : `/` recherche, `↑↓` + `Entrée`, `L` noms des arrêts, `D` densité, `M` fond de carte, `Espace` pause, `1/2/3` onglets, `Échap` fermer.

---

## Application Android (APK, Widget & PWA)

- **APK natif (recommandé)** : téléchargez `T2Cramptes-latest.apk` depuis la page [Releases](https://github.com/aure0/t2cramptes-android/releases/latest). Inclut un **widget d'écran d'accueil Android**, la vérification intégrée des mises à jour et le support GPS. Chaque push sur `main` (ou déclenchement manuel) recompile et met à jour la release `latest` via `.github/workflows/build-android-apk.yml`.
- **Installation instantanée (PWA)** : ouvrez la version web dans Chrome sur Android puis touchez **Installer l'application** (mode plein écran + cache hors ligne Workbox).

---

## Développement local

```bash
npm install
npm run dev        # Serveur Express + Vite sur http://localhost:3000
npm test           # Suite de tests unitaires (node:test)
npm run lint       # Vérification TypeScript (tsc --noEmit)
```

### Builds de production

```bash
# Build statique GitHub Pages (exporte un index GTFS compacté Polyline dans dist/data/)
npm run build:pages
npx vite preview --port 4173

# Build & synchronisation Capacitor Android
npm run build:android
npx cap open android
```

---

## Architecture & sources de données

| Couche | Technologie / Source |
| --- | --- |
| Front-end | React 19, TypeScript, Tailwind CSS v4, graphiques SVG natifs, Vite, Workbox PWA |
| Cartographie | MapLibre GL JS (tracés, arrêts et véhicules 100 % couches WebGL) + CARTO / OpenFreeMap / Raster |
| Données temps réel | GTFS-RT TripUpdates (`proxy.transport.data.gouv.fr`) — décodé côté client en mode statique |
| Topologie & alertes | GTFS statique T2C (encodé Polyline v2) + SIV T2C (exportés au build ou proxy temps réel) |
| Mobile Android | Capacitor 8, widget natif (`T2CWidgetProvider`), minification R8 et vérificateur de mise à jour |

### Options avancées (GitHub Actions)

- **Alertes SIV en direct sans serveur (gratuit)** : déployez `cloudflare-worker/t2c-siv-proxy.js` via `wrangler deploy` (offre gratuite Cloudflare Workers) puis renseignez la variable de dépôt GitHub `VITE_ALERTS_PROXY_URL` (et également `VITE_API_BASE_URL` si vous hébergez `server.ts`).
- **APK Release signé (R8 minifié)** : ajoutez les secrets GitHub `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD` pour activer automatiquement `assembleRelease` signé ; sinon le workflow produit un APK Debug fonctionnel.
