# Plutus Playground Backend

## Description

Ce projet est le backend du Plutus Playground, un environnement de développement intégré (IDE) web pour créer et tester des contrats intelligents Plutus sur la blockchain Cardano. Le backend gère l'authentification des utilisateurs, la gestion des sessions, les opérations sur le système de fichiers, la mise en cache des compilations, et l'intégration avec Docker pour exécuter du code Plutus.

## Fonctionnalités principales

- **Authentification** : Inscription, connexion et gestion des sessions avec hachage des mots de passe via bcrypt.
- **Gestion des fichiers** : Espaces de travail isolés par utilisateur via des conteneurs Docker, avec support pour la création, l'édition et la suppression de fichiers.
- **Compilation et exécution** : Compilation du code Plutus à l'aide de Docker, avec mise en cache des résultats pour améliorer les performances. Sortie en temps réel via Server-Sent Events (SSE).
- **Intégration portefeuille** : Connexion aux portefeuilles Cardano (Nami, Lace, Eternl) pour déployer et interagir avec les contrats intelligents.
- **Sessions et cache** : Stockage des sessions dans Redis, système de cache pour les résultats de compilation.
- **Modèles** : Modèles de contrats Plutus pré-construits (Vesting, NFT Marketplace) pour un démarrage rapide.
- **Gestion de la file d'attente des tâches** : Limites de builds simultanés, gestion de la file d'attente et limitation du taux pour assurer une utilisation équitable des ressources.
- **Métriques et surveillance** : Métriques en temps réel sur les builds, les performances du cache et la santé du système.
- **Gestion des artefacts** : Téléchargement des scripts Plutus compilés (.plutus) et accès aux logs de build.
- **Informations de version** : Affichage des versions de la chaîne d'outils (GHC, Cabal, Nix) pour le débogage.

## Prérequis

- Node.js (version 16 ou supérieure)
- Docker (pour exécuter les conteneurs Plutus)
- Redis (pour le stockage des sessions et du cache)
- Un conteneur Docker nommé `plutus-runner` configuré pour la compilation Plutus

## Installation

1. Clonez ce dépôt :
   ```bash
   git clone <url-du-depot>
   cd backend
   ```

2. Installez les dépendances :
   ```bash
   npm install
   ```

3. Assurez-vous que Docker est en cours d'exécution et que le conteneur `plutus-runner` est disponible.

4. Configurez Redis :
   - Installez et démarrez Redis sur votre système.
   - Le backend utilise Redis pour les sessions (DB 0) et le cache (DB 1).

## Configuration

- **Port** : Le serveur fonctionne sur le port 3000 par défaut.
- **Variables d'environnement** :
  - `SESSION_SECRET` : Clé secrète pour les sessions (changez-la en production).
  - `REDIS_URL` : URL de connexion à Redis (par défaut `redis://localhost:6379`).
  - `MAX_CONCURRENT_BUILDS` : Nombre maximum de tâches de compilation simultanées (défaut : 3).
  - `MAX_QUEUE_SIZE` : Nombre maximum de tâches en file d'attente (défaut : 20).
  - `JOB_TIMEOUT_MS` : Délai d'attente de compilation en millisecondes (défaut : 300000 = 5 minutes).
  - `MAX_OUTPUT_MB` : Taille maximale de sortie de compilation en MB (défaut : 10).
  - `RATE_LIMIT_MAX` : Nombre maximum de builds par utilisateur par minute (défaut : 10).
- **Docker** : Le conteneur `plutus-runner` doit être configuré pour monter les espaces de travail utilisateurs.

## Lancement

Démarrez le serveur :
```bash
npm run dev
```

Le serveur sera disponible sur `http://localhost:3000`.

## Points de terminaison API

### Authentification
- `POST /auth/register` - Inscription utilisateur
- `POST /auth/login` - Connexion utilisateur
- `POST /auth/logout` - Déconnexion utilisateur
- `GET /auth/me` - Obtenir les informations de l'utilisateur actuel

### Espace de travail
- `GET /workspace/files` - Lister les fichiers dans l'espace de travail
- `GET /workspace/file` - Obtenir le contenu d'un fichier
- `POST /workspace/create` - Créer un nouveau fichier
- `POST /workspace/save` - Sauvegarder le contenu d'un fichier

### Compilation
- `POST /run` - Compiler le code Plutus (supporte le mode fichier et éditeur)

### Modèles
- `GET /templates` - Lister les modèles disponibles
- `GET /templates/:id` - Obtenir le code source d'un modèle

### Surveillance
- `GET /health` - Vérification de santé
- `GET /version` - Versions de la chaîne d'outils
- `GET /admin/metrics` - Métriques système (nécessite une authentification)

### Artefacts
- `GET /job/:jobId/log` - Obtenir les logs de compilation
- `GET /job/:jobId/artifact` - Obtenir les métadonnées de l'artefact
- `GET /job/:jobId/download` - Télécharger le fichier .plutus compilé

## Architecture

Le backend se compose de plusieurs composants clés :

- **Serveur** (`server.js`) : Serveur principal Express.js gérant les requêtes HTTP et les connexions WebSocket.
- **Authentification** (`auth.js`) : Gestion des utilisateurs et des sessions.
- **Cache** (`cache.js`) : Mise en cache des résultats de compilation utilisant Redis.
- **File d'attente des tâches** (`jobQueue.js`) : Orchestration des builds, limitation du taux et métriques.
- **Modèles** (`templates.js`) : Modèles de contrats Plutus pré-définis.
- **Redis** (`redis.js`) : Configuration du client Redis et utilitaires.
- **Utilitaires** (`utils.js`) : Fonctions d'aide pour l'analyse et le traitement du code.

## Développement

### Ajouter de nouveaux modèles

Les modèles sont définis dans `templates.js`. Chaque modèle doit inclure :
- `name` : Nom d'affichage
- `description` : Brève description
- `validatorFn` : Nom de la fonction validateur principale
- `source` : Code source Haskell complet

### Surveillance et métriques

Accédez aux métriques sur `/admin/metrics` pour voir :
- Statistiques des tâches (total, taux de succès, taux de succès du cache)
- État de la file d'attente (tâches actives, tâches en attente)
- Limites et configuration du système

### Logs et débogage

- Les logs de compilation sont conservés pendant 24 heures par ID de tâche
- Utilisez `/job/:jobId/log` pour récupérer les logs de débogage
- Les informations de version aident à identifier les problèmes de chaîne d'outils

1. Démarrez Redis si ce n'est pas déjà fait :
   ```bash
   redis-server
   ```

2. Lancez le serveur :
   ```bash
   node server.js
   ```

3. Ouvrez votre navigateur à `http://localhost:3000`.

## Utilisation

- Accédez à la page de connexion pour vous inscrire ou vous connecter.
- Une fois authentifié, accédez à l'IDE pour créer et éditer des fichiers Haskell/Plutus.
- Utilisez les endpoints API pour gérer les fichiers, compiler et exécuter le code.

## Structure du projet

- `server.js` : Serveur Express principal.
- `auth.js` : Module d'authentification.
- `cache.js` : Système de mise en cache.
- `redis.js` : Connexion à Redis.
- `utils.js` : Fonctions utilitaires.
- `assets/` : Ressources statiques (CSS, JS, images).
- `sessions/` : Stockage persistant des sessions.
- `tmp/` : Fichiers temporaires.
- `workspaces/` : Espaces de travail utilisateurs avec fichiers Haskell.

## API Endpoints

### Routes publiques
- `GET /` : Redirection vers la connexion ou l'IDE selon la session.
- `GET /login` : Page de connexion.
- `GET /register` : Page d'inscription.
- `POST /auth/register` : Inscription utilisateur.
- `POST /auth/login` : Connexion utilisateur.

### Routes protégées (authentification requise)
- `GET /ide` : Interface IDE principale.
- `GET /workspace/files` : Lister les fichiers dans l'espace de travail.
- `POST /workspace/files` : Créer/modifier des fichiers.
- `DELETE /workspace/files` : Supprimer des fichiers.
- `POST /compile` : Compiler le code Plutus.
- `POST /run` : Exécuter le code compilé.

## Considérations de sécurité

- Les mots de passe sont hachés avec bcrypt.
- Les sessions sont HTTP-only et sécurisées en production.
- Les espaces de travail utilisateurs sont isolés dans des conteneurs Docker.
- CORS est désactivé pour le rendu côté serveur.

## Contribution

Les contributions sont les bienvenues. Veuillez suivre les meilleures pratiques de codage et ajouter des tests pour les nouvelles fonctionnalités.

## Licence

ISC