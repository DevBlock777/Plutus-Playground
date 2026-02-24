# Configuration de Qwen pour Plutus IDE

## � **ERREUR "fetch failed" - Guide de dépannage**

### 🔍 **Cause du problème :**
L'erreur "fetch failed" se produit parce que **vous n'êtes pas connecté** à l'IDE Plutus. L'IA nécessite une session utilisateur active.

### ✅ **Solution étape par étape :**

#### **1. Vérifiez que tout fonctionne :**
```bash
# Container Ollama
docker ps | grep ollama

# API Ollama
curl http://localhost:11434/api/tags

# Serveur Plutus
curl http://localhost:3000/health
```

#### **2. Connectez-vous à l'IDE :**
1. **Ouvrez** http://localhost:3000
2. **Créez un compte** ou **connectez-vous** avec vos identifiants existants
3. **Vérifiez que vous êtes connecté** (vous devriez voir votre nom en haut à droite)

#### **3. Testez l'IA :**
1. **Cliquez** sur l'onglet **"🤖 AI"**
2. **Essayez** le bouton **"🧪 Tester saisie"** (devrait remplir la zone de texte)
3. **Cliquez** sur **"❓ Aide générale"** (devrait fonctionner maintenant)

### 🔧 **Si le problème persiste :**

#### **A. Redémarrez tout :**
```bash
# Arrêtez le serveur Plutus (Ctrl+C)
# Redémarrez Ollama
docker restart ollama

# Redémarrez le serveur
cd backend
npm run dev
```

#### **B. Vérifiez la console du navigateur :**
1. Ouvrez les outils développeur (F12)
2. Allez dans l'onglet "Console"
3. Cliquez sur un bouton IA
4. **Cherchez les erreurs** et copiez-les ici

#### **C. Testez l'API manuellement :**
```bash
# Créez une session (remplacez USER/PASS par vos identifiants)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"votre_user","password":"votre_pass"}' \
  -c cookies.txt

# Testez l'IA avec la session
curl -X POST http://localhost:3000/ai/chat \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"message":"Bonjour","code":"","language":"haskell"}'
```

### 🎯 **Utilisation normale :**

Une fois connecté, vous pouvez :

1. **Générer du code Plutus :**
   - Cliquez **"📝 Générer contrat Plutus"**
   - Demandez : *"Crée-moi un système d'assistance scolaire en Plutus"*

2. **Analyser du code :**
   - Écrivez du code Haskell
   - Cliquez **"🔍 Analyser le code"**

3. **Poser des questions :**
   - Tapez directement dans la zone de texte
   - Exemple : *"Comment créer un validator Plutus ?"*

### 📊 **État du système :**
- ✅ **Ollama** : Container actif sur port 11434
- ✅ **Qwen** : Modèle `qwen2.5-coder:7b` chargé
- ✅ **Serveur** : Plutus IDE fonctionnel
- ⚠️ **Authentification** : **VOUS DEVEZ ÊTRE CONNECTÉ**

### 🎉 **Résolution :**

**Connectez-vous d'abord à l'IDE !** Une fois connecté, l'IA fonctionnera parfaitement pour vous aider avec votre code Haskell/Plutus pour l'assistance scolaire.

**Testez maintenant :** Allez sur http://localhost:3000, connectez-vous, et essayez l'IA ! 🚀

1. **Installer Ollama** (pour exécuter Qwen localement) :
   ```bash
   # Sur Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   ```

2. **Télécharger et installer Qwen** :
   ```bash
   # Modèle recommandé pour le développement Plutus
   ollama pull qwen2.5:7b

   # Versions alternatives
   ollama pull qwen2.5:3b  # Plus léger
   ollama pull qwen2.5:14b # Plus puissant
   ```

3. **Démarrer Ollama** :
   ```bash
   ollama serve
   ```

## Configuration technique

Le modèle est configuré dans `server/server.js` :
```javascript
model: 'qwen2.5:7b', // Changez selon vos besoins
```

## Dépannage

- **"Erreur: Failed to fetch"** : Vérifiez qu'Ollama est démarré
- **"model not found"** : Installez le modèle avec `ollama pull qwen2.5:7b`
- **Réponses lentes** : Utilisez un modèle plus petit ou vérifiez votre matériel
- **Code non inséré** : Assurez-vous que l'IA utilise les blocs ```haskell

## Fonctionnalités avancées

- **Contexte automatique** : L'IA voit toujours le code dans votre éditeur
- **Génération ciblée** : Spécialisée pour Haskell et Plutus
- **Insertion directe** : Code généré directement intégrable
- **Chat persistant** : Historique conservé pendant la session