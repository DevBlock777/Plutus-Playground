# Plutus Playground Backend

## Description

Ce projet est le backend du Plutus Playground, un environnement de développement intégré (IDE) web pour créer et tester des contrats intelligents Plutus sur la blockchain Cardano. Le backend gère l'authentification des utilisateurs, la gestion des sessions, les opérations sur le système de fichiers, la mise en cache des compilations, et l'intégration avec Docker pour exécuter du code Plutus.

## Fonctionnalités principales

- **Authentification** : Inscription, connexion et gestion des sessions avec hachage des mots de passe via bcrypt.
- **Gestion des fichiers** : Espaces de travail isolés par utilisateur via des conteneurs Docker, avec support pour la création, l'édition et la suppression de fichiers.
- **Compilation et exécution** : Compilation du code Plutus à l'aide de Docker, avec mise en cache des résultats pour améliorer les performances. Sortie en temps réel via Server-Sent Events (SSE).
- **Intégration portefeuille** : Connexion aux portefeuilles Cardano (Nami, Lace, Eternl) pour déployer et interagir avec les contrats intelligents.
- **Sessions et cache** : Stockage des sessions dans Redis, système de cache pour les résultats de compilation.

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
- **Docker** : Le conteneur `plutus-runner` doit être configuré pour monter les espaces de travail utilisateurs.

## Lancement

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