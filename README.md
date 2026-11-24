# T2Cramptés

Suivi en temps réel du réseau **T2C Clermont-Ferrand** (Tramway A, BHNS B & C et l'ensemble des lignes de bus) — **100 % gratuit, open-source et sans clé API**.

- **Web (GitHub Pages)** : https://aure0.github.io/t2cramptes-android/
- **APK Android (dernière version)** : [Télécharger `T2Cramptes-latest.apk`](https://github.com/aure0/t2cramptes-android/releases/latest/download/T2Cramptes-latest.apk)

---

## Fonctionnalités

- **Carte vectorielle haute fluidité (WebGL)** : MapLibre GL JS + OpenFreeMap (thèmes Sombre & Clair), fusion aller/retour par ligne, empilement parallèle des tronçons partagés, pôles multi-modes distincts (ex. Jaude Tram / Bus) et arrêts fixes rendus nativement sur GPU.
- **Véhicules en direct & suivi** : flux officiel GTFS-RT T2C (`transport.data.gouv.fr`) actualisé toutes les 12 s, projection exacte sur le tracé, interpolation curviligne 30 fps avec cap lissé et suivi caméra à zone morte.
- **Horaires en temps réel aux arrêts** : prochains passages, retard/avance, accessibilité PMR, favoris persistants et liens partageables (`?lines=A,B&station=…`).
- **Infos trafic, densité & ponctualité** : perturbations T2C SIV + historique, carte de chaleur de congestion/volume et graphiques de ponctualité par ligne (`6H` / `24H` / `7J` / `30J` / `Tout`).
- **Interface FR / EN & raccourcis clavier** : `/` recherche, `↑↓` + `Entrée`, `L` noms des arrêts, `D` densité, `M` fond de carte, `Espace` pause, `1/2/3` onglets, `Échap` fermer.

---

## Application Android (APK & PWA)

- **APK natif (recommandé)** : téléchargez `T2Cramptes-latest.apk` depuis la page [Releases](https://github.com/aure0/t2cramptes-android/releases/latest). Chaque push sur `main` recompile et met à jour automatiquement la release `latest` via `.github/workflows/build-android-apk.yml`.
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
# Build statique GitHub Pages (pré-exporte GTFS + alertes dans dist/data/)
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
| Front-end | React 19, TypeScript, Tailwind CSS v4, Vite, Workbox PWA |
| Cartographie | MapLibre GL JS (couches GeoJSON WebGL) + OpenFreeMap |
| Données temps réel | GTFS-RT TripUpdates (`proxy.transport.data.gouv.fr`) — décodé côté client en mode statique |
| Topologie & alertes | GTFS statique T2C + SIV T2C (rafraîchis toutes les 6 h par `.github/workflows/deploy-pages.yml`) |
| Mobile Android | Capacitor 8 + navigation native du bouton Retour |

> **Optionnel (alertes SIV minute par minute)** : déployez `server.ts` sur un hébergeur Node et renseignez la variable de dépôt GitHub `VITE_API_BASE_URL` pour basculer du snapshot 6 h au polling SIV en direct toutes les 30 s.
