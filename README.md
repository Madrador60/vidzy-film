# Vidzy — par Madra

Vidzy — par Madra est une interface de découverte et de lecture de films, séries, télévision et sport. Le catalogue et les métadonnées proviennent de TMDB. La disponibilité vidéo dépend de Vidzy et les chaînes en direct du flux configuré dans le serveur.

## Prérequis

- Node.js 18 ou plus récent (Node.js 20 ou 22 LTS recommandé)
- npm
- un jeton d’accès en lecture TMDB

## Installation

```bash
npm install
copy .env.example .env
```

Sous macOS ou Linux, utilise `cp .env.example .env`.

Crée un compte sur [TMDB](https://www.themoviedb.org/), ouvre les paramètres API, puis place le jeton d’accès en lecture dans `.env` :

```env
PORT=3000
NODE_ENV=development
TMDB_BEARER_TOKEN=your_tmdb_bearer_token_here
ALLOWED_PLAYER_HOSTS=vidzy.org,www.vidzy.org,hesgoaler.com,www.youtube-nocookie.com
ALLOWED_HLS_HOSTS=hesgoaler.com
```

Le projet utilise uniquement `TMDB_BEARER_TOKEN` (jeton de lecture API TMDB v4). Ne publie jamais `.env` et n’expose jamais ce jeton au navigateur.

Si ce secret manque, le serveur journalise clairement l’erreur de configuration mais continue de servir le Direct et l’EPG. L’interface publique affiche uniquement un message temporaire avec un bouton Réessayer, sans révéler le nom du secret ni d’instruction technique.

## Commandes

```bash
npm start       # production locale
npm run dev     # rechargement automatique
npm run check   # syntaxe de tous les fichiers JavaScript
npm test        # tests Node et API
```

Le site est disponible sur `http://localhost:3000` avec la configuration d’exemple.

## Fonctionnalités

- Navigation simplifiée : Accueil, Films, Séries et TV.
- Accueil éditorial avec tendances quotidiennes, nouveautés et sélections par genre.
- Recherche globale par titre ou artiste, avec filtres de type, année, note et historique récent.

- accueil dynamique et carrousels accessibles au clavier ;
- films, séries, saisons et épisodes ;
- recherche temporisée de films, séries et personnes avec annulation des requêtes obsolètes ;
- fiche détaillée, casting cliquable et filmographie ;
- bandes-annonces et recommandations ;
- lecteur plein écran, choix VF/VOSTFR, retour vers la fiche et progression locale ;
- épisodes terminés et dernier épisode sélectionné mémorisés par profil ;
- Ma liste, historique, suppression individuelle et suppression globale confirmée ;
- profil local unique Madra, sans compte serveur ;
- télévision et sport lancés immédiatement à partir du flux externe configuré ;
- programmes XMLTV français intégrés directement sous chaque chaîne du Direct, fournis par EPG.PW, avec émission en cours, horaires, progression et programme suivant ;
- PWA installable avec page hors connexion ;
- API protégée par CSP, Helmet, limitation de débit, validation, cache borné et déduplication des requêtes TMDB.

## Versions récentes

- **Audit production août 2026** : démarrage `0.0.0.0`, vraie page 404, erreurs publiques nettoyées, timeouts et boutons Réessayer, fallback d’images, SEO enrichi et arrêt Render propre.
- **Vidzy 4.0** : Mon espace, statistiques, ambiances, coups de cœur et bouton « Surprenez-moi ».
- **Vidzy 3.0** : fiches partageables, recherche par genre, reprise des séries et interface recentrée.
- **Direct** : lecture immédiate, plein écran, isolation des pop-ups et accès au guide TV français.

Le guide est consultable en français sur [epg.pw — France](https://epg.pw/areas/fr.html?lang=fr). Sa couverture dépend des chaînes référencées par ce service externe.

Le serveur télécharge `https://epg.pw/xmltv/epg_FR.xml.gz`, le décompresse et le parse en streaming. La grille est conservée en mémoire pendant huit heures, rafraîchie automatiquement et réutilisée en mode dégradé si la source devient momentanément indisponible. Les alias de chaînes sont centralisés dans `lib/epg-service.js` pour faciliter l’ajout de nouveaux mappings ou de nouvelles sources XMLTV.

Le service worker utilise une stratégie réseau prioritaire pour le JavaScript et le CSS. Les pages HTML et `sw.js` sont servis sans cache persistant afin qu’une ancienne interface ne survive pas à un redéploiement Render.

Routes Direct et Programme TV :

- `GET /api/direct/channels` (`/api/live` reste compatible) ;
- `GET /api/epg/status` ;
- `GET /api/epg/channels` ;
- `GET /api/epg/now` ;
- `GET /api/epg/channel/:id` ;
- `POST /api/epg/refresh`.

## Structure

```text
lib/                 validation, cache et sécurité des lecteurs
public/              interface, lecteurs, styles, manifest et service worker
scripts/check.js     vérification syntaxique
test/                tests unitaires et API
server.js            serveur Express et intégrations externes
render.yaml          configuration de déploiement Render
AUDIT-RAPPORT.md     audit et corrections
```

## Déploiement sur Render

1. Publie ce dossier dans un dépôt Git privé ou public sans `.env`.
2. Dans Render, choisis **New > Blueprint** et sélectionne le dépôt contenant `render.yaml`.
3. Renseigne `TMDB_BEARER_TOKEN` dans les variables secrètes.
4. Vérifie que la commande de build est `npm ci` et la commande de démarrage `npm start`.
5. Déploie puis ouvre `/api/health`.

Render fournit automatiquement `PORT`. Ne le fixe pas dans l’interface Render.

Variables Render obligatoires :

- `NODE_ENV=production` ;
- `TMDB_BEARER_TOKEN` : jeton de lecture TMDB, configuré comme secret ;
- `ALLOWED_PLAYER_HOSTS=vidzy.org,www.vidzy.org,hesgoaler.com,www.youtube-nocookie.com`.
- `ALLOWED_HLS_HOSTS=hesgoaler.com` : domaines HTTPS autorisés à fournir des manifestes `.m3u8`.

## Limites connues

- Vidzy, Hesgoaler, YouTube et TMDB sont des services externes : disponibilité, CORS, restrictions d’iframe et temps de réponse peuvent changer.
- Une iframe peut déclencher son événement `load` même si le fournisseur affiche ensuite une erreur interne ; Vidzy ne prétend donc pas garantir la lecture.
- La progression est estimée tant que le lecteur externe ne fournit pas d’API de temps de lecture.
- Le mode hors connexion conserve uniquement l’interface et un nombre limité d’images, jamais les vidéos, les chaînes ou les réponses API.
- Les favoris, profils et historiques sont locaux au navigateur et ne sont pas synchronisés entre appareils.

## Sécurité

Les domaines de lecteur sont limités par `ALLOWED_PLAYER_HOSTS` et les flux HLS par `ALLOWED_HLS_HOSTS`. Les URL vides, non HTTPS, privées, avec identifiants ou appartenant à un domaine inconnu sont refusées par les utilitaires testés. Chaque redirection HLS est vérifiée côté serveur avant transmission au navigateur et reste obligatoirement sur la liste blanche. Le Direct utilise HLS natif ou Hls.js lorsqu’un manifeste autorisé est fourni et conserve l’iframe historique dans les autres cas. Les iframes utilisent un `sandbox` minimal. Consulte `AUDIT-RAPPORT.md` pour le détail.
