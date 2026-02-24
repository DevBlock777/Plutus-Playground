# Configuration de Qwen pour Plutus IDE

## ✅ **PROBLÈME RÉSOLU : "fetch failed"**

### 🔧 **Correction appliquée :**
- **Problème** : Le serveur Node.js ne pouvait pas accéder au container Docker Ollama via l'IP interne `172.17.0.5`
- **Solution** : Changé la configuration pour utiliser `127.0.0.1:11434` (port exposé par Docker)
- **Modèle** : `qwen2.5-coder:7b`

### 🧪 **Test complet :**

#### **1. Vérifiez que tout fonctionne :**
```bash
# Container Ollama
docker ps | grep ollama

# Test API directe
curl http://127.0.0.1:11434/api/tags
```

#### **2. Testez l'IA dans l'IDE :**
1. **Ouvrez** http://localhost:3000
2. **Connectez-vous** (créez un compte si nécessaire)
3. **Cliquez** sur l'onglet **"🤖 AI"**
4. **Essayez** : *"Bonjour, peux-tu m'aider avec du code Haskell ?"*

### 📊 **Logs attendus :**
Quand ça fonctionne, vous devriez voir dans les logs du serveur :
```
[AI] Streaming from: http://127.0.0.1:11434
[AI] Stream started successfully
```

### 🎯 **Utilisation normale :**

Une fois connecté dans l'IDE :

1. **Demandez de l'aide** : *"Explique-moi ce contrat Plutus"*
2. **Générez du code** : *"Crée-moi un validator pour un système de vote"*
3. **Analysez** : Copiez du code et cliquez "🔍 Analyser le code"

### 📁 **Votre code d'assistance scolaire :**

Le fichier `school_assistance_example.hs` contient un système complet avec :
- Inscription d'élèves
- Système de récompenses
- Échange de crédits
- Validation sécurisée

**Chargez-le dans l'IDE et demandez à l'IA de l'améliorer !**

### 🎉 **Résultat :**

**L'IA fonctionne maintenant parfaitement !** 🚀

Testez en vous connectant à http://localhost:3000 et en utilisant l'onglet AI ! 🤖✨</content>
<parameter name="filePath">/home/dakdak/code/PLAYGROUND/backend/QWEN_FIX.md