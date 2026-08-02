# Vidzy

Vidzy est une interface de découverte et de lecture de films, séries, télévision et sport. Le catalogue et les métadonnées proviennent de TMDB. La disponibilité vidéo dépend de Vidzy et les chaînes en direct du flux configuré dans le serveur.

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
```

`TMDB_API_KEY` est documenté dans `.env.example` pour les environnements qui le demandent, mais le serveur utilise le jeton Bearer. Ne publie jamais `.env`.

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
- guide TV français accessible depuis le Direct, fourni par `epg.pw` ;
- PWA installable avec page hors connexion ;
- API protégée par CSP, Helmet, limitation de débit, validation, cache borné et déduplication des requêtes TMDB.

## Versions récentes

- **Vidzy 4.0** : Mon espace, statistiques, ambiances, coups de cœur et bouton « Surprenez-moi ».
- **Vidzy 3.0** : fiches partageables, recherche par genre, reprise des séries et interface recentrée.
- **Direct** : lecture immédiate, plein écran, isolation des pop-ups et accès au guide TV français.

Le guide est consultable sur [epg.pw — France](https://epg.pw/areas/fr/epg.html?lang=en). Sa couverture dépend des chaînes référencées par ce service externe.

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

## Limites connues

- Vidzy, Hesgoaler, YouTube et TMDB sont des services externes : disponibilité, CORS, restrictions d’iframe et temps de réponse peuvent changer.
- Une iframe peut déclencher son événement `load` même si le fournisseur affiche ensuite une erreur interne ; Vidzy ne prétend donc pas garantir la lecture.
- La progression est estimée tant que le lecteur externe ne fournit pas d’API de temps de lecture.
- Le mode hors connexion conserve uniquement l’interface et un nombre limité d’images, jamais les vidéos, les chaînes ou les réponses API.
- Les favoris, profils et historiques sont locaux au navigateur et ne sont pas synchronisés entre appareils.

## Sécurité

Les domaines de lecteur sont limités par `ALLOWED_PLAYER_HOSTS`. Les URL vides, non HTTPS, avec identifiants ou appartenant à un domaine inconnu sont refusées par les utilitaires testés. Les iframes utilisent un `sandbox` minimal. Consulte `AUDIT-RAPPORT.md` pour le détail.
