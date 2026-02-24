// Internationalization / Traductions
const translations = {
    en: {
        // AI messages
        aiWelcome: "Hello! I am your AI assistant for Plutus/Haskell development. I can help you analyze your code, answer your questions, and guide you in your smart contract projects. How can I help you today?",
        aiNeedHelp: "I need help developing Plutus smart contracts in Haskell. Can you guide me on concepts, best practices, or answer my specific questions?",
        chatCleared: "Chat cleared. How can I help you?",

        // Modal
        newItem: "+ New item",
        file: "📄 File",
        folder: "📁 Folder",
        location: "Location",
        fileName: "File name",
        exampleFile: "ex: MyValidator.hs",
        mustStartUppercase: "Must start with uppercase, end with .hs",
        cancel: "Cancel",
        create: "Create",

        // Terminal
        typeHelp: "  Type  help  for available commands.",
        availableCommands: "  status · file · clear · help",
        typeHelpForCommands: "  Type help for commands.",
        unknownCommand: "Unknown",

        // Ollama help
        ollamaNotFound: "⚠️ **Ollama not found.**",
        testedUrls: "Tested URLs:",
        solutions: "**Solutions :**",
        clickForInstructions: "Click for installation instructions",

        // Buttons and labels
        analyzeCode: "🔍 Analyze code",
        send: "Send",
        clearChat: "🗑️ Clear chat",
        help: "❓ Help",

        // Status
        online: "online",
        offline: "offline",

        // Tabs
        workspace: "Workspace",
        ai: "AI",
        terminal: "Terminal",

        // AI Assistant
        plutusAIAssistant: "Plutus AI Assistant",
        haskellSmartContracts: "Haskell · Smart Contracts · Plutus",

        // Buttons
        compile: "Compile",
        connectWallet: "Connect Wallet",
        delete: "Delete",

        // Modal delete
        confirmDelete: "Are you sure you want to delete this file?",
        thisActionCannotBeUndone: "This action cannot be undone.",

        // Ollama help detailed
        ollamaNotFoundTitle: "Ollama not found.",
        testedUrls: "Tested URLs:",
        solutions: "Solutions:",
        ollamaOnHost: "If Ollama is running on your PC (not in Docker):",
        setOllamaHostLocal: "Set `OLLAMA_HOST=http://127.0.0.1:11434` in your .env",
        nodejsInDocker: "If Node.js is running in Docker:",
        setOllamaHostDocker: "Set `OLLAMA_HOST=http://host.docker.internal:11434`",
        checkOllamaRunning: "Check that Ollama is started:",
        checkModelDownloaded: "Check that the model is downloaded:"
    },
    fr: {
        // AI messages
        aiWelcome: "Bonjour ! Je suis votre assistant IA pour le développement Plutus/Haskell. Je peux vous aider à analyser votre code, répondre à vos questions, et vous guider dans vos projets smart contracts. Comment puis-je vous aider aujourd'hui ?",
        aiNeedHelp: "J'ai besoin d'aide pour développer des smart contracts Plutus en Haskell. Peux-tu me guider sur les concepts, les bonnes pratiques, ou répondre à mes questions spécifiques ?",
        chatCleared: "Chat effacé. Comment puis-je vous aider ?",

        // Modal
        newItem: "+ Nouvel élément",
        file: "📄 Fichier",
        folder: "📁 Dossier",
        location: "Emplacement",
        fileName: "Nom du fichier",
        exampleFile: "ex: MonValidateur.hs",
        mustStartUppercase: "Doit commencer par une majuscule, finir par .hs",
        cancel: "Annuler",
        create: "Créer",

        // Terminal
        typeHelp: "  Tapez  help  pour les commandes disponibles.",
        availableCommands: "  status · file · clear · help",
        typeHelpForCommands: "  Tapez help pour les commandes.",
        unknownCommand: "Inconnu",

        // Ollama help
        ollamaNotFound: "⚠️ **Ollama introuvable.**",
        testedUrls: "URLs testées :",
        solutions: "**Solutions :**",
        clickForInstructions: "Cliquez pour les instructions d'installation",

        // Buttons and labels
        analyzeCode: "🔍 Analyser le code",
        send: "Envoyer",
        clearChat: "🗑️ Effacer le chat",
        help: "❓ Aide",

        // Status
        online: "en ligne",
        offline: "hors ligne",

        // Tabs
        workspace: "Espace de travail",
        ai: "IA",
        terminal: "Terminal",

        // AI Assistant
        plutusAIAssistant: "Assistant IA Plutus",
        haskellSmartContracts: "Haskell · Smart Contracts · Plutus",

        // Buttons
        compile: "Compiler",
        connectWallet: "Connecter Wallet",
        delete: "Supprimer",

        // Modal delete
        confirmDelete: "Êtes-vous sûr de vouloir supprimer ce fichier ?",
        thisActionCannotBeUndone: "Cette action ne peut pas être annulée.",

        // Ollama help detailed
        ollamaNotFoundTitle: "Ollama introuvable.",
        testedUrls: "URLs testées :",
        solutions: "Solutions :",
        ollamaOnHost: "Si Ollama tourne sur votre PC (hors Docker) :",
        setOllamaHostLocal: "Définissez `OLLAMA_HOST=http://127.0.0.1:11434` dans votre .env",
        nodejsInDocker: "Si Node.js tourne dans Docker :",
        setOllamaHostDocker: "Définissez `OLLAMA_HOST=http://host.docker.internal:11434`",
        checkOllamaRunning: "Vérifiez qu'Ollama est démarré :",
        checkModelDownloaded: "Vérifiez que le modèle est téléchargé :"
    }
};

// Detect browser language
function getBrowserLanguage() {
    return 'en';  // Force English for user interface
}

// Get translation function
function t(key) {
    const lang = getBrowserLanguage();
    return translations[lang][key] || translations['en'][key] || key;
}

// Export for global use
window.t = t;
window.getBrowserLanguage = getBrowserLanguage;