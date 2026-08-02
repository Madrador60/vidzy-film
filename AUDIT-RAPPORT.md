# Rapport d’audit Vidzy

## Audit de production — 2 août 2026

Déploiement audité : `https://vidzy-madra.onrender.com`

Commit de départ : `55d39a2`

Périmètre : démarrage Render, API, sécurité, interface, lecteurs, responsive, accessibilité, SEO, cache et gestion des erreurs.

### Corrections appliquées

- écoute explicite sur `0.0.0.0` et arrêt propre sur `SIGTERM`/`SIGINT` ;
- nom Blueprint aligné sur `vidzy-madra`, `npm ci`, `npm start` et `/api/health` conservés ;
- vraie page 404 avec code HTTP 404 au lieu d’un retour silencieux vers l’accueil ;
- messages d’erreur externes nettoyés, timeouts 12 secondes côté navigateur et réponses 413/JSON invalides lisibles ;
- bouton Réessayer pour catalogue, Direct, sélections, ambiances et lecteurs ;
- état d’échec du lecteur intégré, rechargement de source et maintien de la liste blanche HTTPS ;
- fallback visuel automatique pour les images cassées ;
- cartes harmonisées avec titres sur deux lignes et survol discret ;
- métadonnées Open Graph, canonical, titre, description et identité « Vidzy Madra » ;
- contrôles accessibles nommés, profil unique rendu non interactif et focus visible ;
- cache public court sur les API GET non sensibles, compression et cache interne conservés ;
- tests supplémentaires : sécurité HTTP, limite JSON, page 404, écoute réseau et 40 requêtes parallèles.

### Résultats avant correction

- 16 parcours HTTP vérifiés : toutes les API fonctionnelles répondaient, mais une page inexistante renvoyait `200` ;
- aucune erreur JavaScript détectée dans la console sur l’accueil, Films et la recherche ;
- recherche « Matrix » : 13 résultats, catalogue Films : 20 cartes ;
- API Direct : 431 chaînes, environ 164 Ko ;
- audit accessibilité automatisé : 2 boutons cachés sans nom et 1 champ caché sans label, corrigés ;
- `npm audit --omit=dev` : 0 vulnérabilité connue.

### Limites externes restantes

- un fournisseur en iframe peut déclencher `load` puis afficher sa propre erreur, sans API permettant à Vidzy de la lire ;
- Vidzy, Hesgoaler, TMDB, YouTube et EPG.pw peuvent changer, expirer ou appliquer des restrictions géographiques ;
- la progression reste estimée en l’absence d’API temps réel du lecteur tiers ;
- Render Free peut mettre le service en veille et ralentir la première requête ;
- favoris et historique restent locaux à chaque navigateur.

Date : 27 juillet 2026  
Version auditée : 2.0.0  
Stack : Node.js, Express, JavaScript natif, HTML/CSS, TMDB, Vidzy, Hesgoaler, PWA.

## Résumé

Le projet était fonctionnel mais incomplet pour une mise en production : réponses API hétérogènes, tests absents, validations permissives, cache artisanal, sécurité HTTP partielle, service worker trop large et documentation insuffisante. Les problèmes critiques et élevés identifiés ci-dessous ont été corrigés directement.

## Problèmes détectés et corrections

| Gravité | Problème | Fichiers | Correction |
|---|---|---|---|
| Critique | Aucun test automatisé malgré des routes externes et des validations sensibles | `package.json`, serveur | Ajout de `node:test`, Supertest et 7 tests initiaux couvrant santé, 404, invalides, normalisation, cache et URL |
| Élevée | Réponses API incompatibles entre routes | `server.js`, `public/app.js` | Enveloppe uniforme `{ok,data}` et `{ok:false,error}`, déballage centralisé côté client |
| Élevée | Validation permissive des types, pages, années, genres et recherches | `server.js` | Module `lib/validation.js`, limites strictes et erreurs 400 avant appel externe |
| Élevée | En-têtes de sécurité manuels et incomplets | `server.js` | Helmet, CSP, `frame-ancestors`, nosniff, Referrer-Policy, Permissions-Policy |
| Élevée | Iframes sans bac à sable | fichiers HTML | Ajout d’un `sandbox` limité et d’une politique de référent stricte |
| Élevée | Aucune liste blanche réutilisable pour les lecteurs | lecteurs | `lib/player-url.js`, domaines configurables et tests contre `javascript:`, `data:` et domaines inconnus |
| Élevée | Cache Vidzy pouvant conserver trop d’entrées et sans vraie abstraction | `server.js` | `BoundedCache`, TTL, LRU simple et maximum de 2 000 entrées |
| Moyenne | Limitation de débit non structurée | `server.js` | Réponse 429 cohérente et en-têtes RateLimit |
| Moyenne | Absence de compression HTTP | serveur | Ajout de `compression` |
| Moyenne | Route santé trop pauvre | `server.js` | Version, démarrage, uptime, présence TMDB et statut, sans secret |
| Moyenne | Recherche d’acteur limitée à quelques œuvres et requêtes obsolètes possibles | `server.js`, `public/app.js` | Résultats personnes dédiés, fiche artiste, `AbortController` et rejet des anciennes réponses |
| Moyenne | Flux TV en double et structure incomplète | `server.js` | Déduplication par ID et ajout de `logo`, `language`, `sources` |
| Moyenne | Historique et liste sans suppression globale | interface | Suppression individuelle d’historique, vidage confirmé de l’historique et de Ma liste |
| Moyenne | PWA mettant potentiellement en cache trop de ressources | `public/sw.js` | Aucun cache API/vidéo, navigation network-first, statiques cache-first, images TMDB limitées à 80 |
| Moyenne | Pas de page hors connexion | PWA | Ajout de `public/offline.html` |
| Faible | `.env.example` non générique et documentation courte | racine | Valeurs fictives, README complet et configuration Render |
| Faible | Serveur impossible à importer sans écouter un port | `server.js` | Export de `app`, `startServer` et `normalizeItem` |

## Sécurité et secrets

- Aucun jeton réel n’a été trouvé dans les fichiers de l’archive.
- `.env` est exclu par `.gitignore`.
- `.env.example` ne contient que des valeurs fictives.
- Si un jeton a déjà été publié dans un ancien ZIP ou dépôt, il doit être révoqué et régénéré depuis TMDB.
- Les erreurs de production sont masquées par le gestionnaire central lorsqu’elles lui parviennent.

## Vérifications exécutées

- `npm install` : réussi, 0 vulnérabilité ;
- `npm run check` : réussi ;
- `npm test` : 7 tests réussis, 0 échec ;
- contrôle des routes déclarées : aucun doublon détecté ;
- contrôle des motifs de secrets : aucun secret probable détecté ;
- contrôle des iframes et liens externes : protections ajoutées ;
- contrôle du service worker : stratégies séparées et caches bornés.
- test navigateur de l’accueil enrichi : 19 cartes catalogue et 108 cartes de carrousels chargées ;
- test de navigation : onglets Accueil, Films, Séries, Animés, Tendances, TV et Sport présents ; l’onglet Animés applique bien le genre 16 ;
- test de recherche avancée : filtres de type, année et note présents, Leonardo DiCaprio apparaît comme personne ;
- test de recherche : Leonardo DiCaprio apparaît comme personne et ses œuvres compatibles restent séparées ;
- test de fiche artiste : photo, biographie de 2 356 caractères et 124 rôles chargés ;
- test responsive à 390×844 : aucun débordement horizontal et filmographie sur deux colonnes.

## Éléments dépendant de services externes

- La présence d’une œuvre chez Vidzy ne garantit pas que son lecteur tiers répondra dans tous les pays ou navigateurs.
- Certains flux TV/sport peuvent expirer ou refuser l’intégration.
- TMDB peut limiter les requêtes ou ne pas fournir de synopsis, image, bande-annonce ou traduction française.
- Le lecteur tiers ne fournit pas une API de progression fiable ; la progression reste estimée.

## Recommandations restantes

- Ajouter un stockage persistant partagé (Redis) si plusieurs instances Render sont utilisées.
- Ajouter des tests end-to-end hébergés dans une CI avec un jeton TMDB de test.
- Remplacer l’icône SVG par des PNG 192×192 et 512×512 si une boutique ou un validateur PWA strict l’exige.
- Mettre en place une supervision externe de `/api/health`.
