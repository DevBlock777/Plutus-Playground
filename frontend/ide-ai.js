// ════════════════════════════════════════════════════════════════
// AI Chat Module (ide-ai.js)
// ════════════════════════════════════════════════════════════════

let aiMessages = [];
let isAIResponding = false;

// ── Initialize AI Chat ──────────────────────────────────────────
function initAIChat() {
    console.log('🤖 Initializing AI Chat...');

    const aiInput = document.getElementById('ai-input');
    const aiSendBtn = document.getElementById('ai-send-btn');

    if (!aiInput || !aiSendBtn) {
        console.error('❌ AI elements not found:', { aiInput, aiSendBtn });
        return;
    }

    // Ensure input is enabled
    aiInput.disabled = false;
    aiInput.focus();

    // Enter key to send
    aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAIMessage();
        }
    });

    // Auto-resize textarea
    aiInput.addEventListener('input', () => {
        aiInput.style.height = 'auto';
        aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
    });

    // Add welcome message
    addAIMessage('assistant', t('aiWelcome'));

    // ── Probe Ollama status and update badge ──
    probeAIStatus();
}

async function probeAIStatus() {
    const badge = document.getElementById('aiModelBadge');
    if (!badge) return;
    try {
        const r    = await fetch('/ai/status');
        const data = await r.json();
        if (data.resolved) {
            // Connected — show online status with model name
            const modelShort = (data.model || 'qwen').split(':')[0];
            badge.textContent = '● ' + t('online');
            badge.style.color = '#34d399';
            badge.title = `Ollama: ${data.resolved}\nModèle: ${data.model}\nModèles dispo: ${(data.models || []).join(', ') || 'aucun'}`;
            badge.onclick = null;
        } else {
            // Not connected — show warning with instructions
            badge.textContent = '⚠ ' + t('offline');
            badge.style.color = '#f87171';
            badge.style.cursor = 'pointer';
            badge.title = data.hint;
            badge.onclick = () => showOllamaHelp(data);
            // Show help message in chat
            showOllamaHelp(data);
        }
    } catch (_) {
        if (badge) { badge.textContent = '⚠ ' + t('offline'); badge.style.color = '#f87171'; }
    }
}

function showOllamaHelp(data) {
    const tried = Object.entries(data.probes || {})
        .map(([url, ok]) => `  ${ok ? '✓' : '✗'} ${url}`)
        .join('\n');
    addAIMessage('system',
        `⚠️ **${t('ollamaNotFoundTitle')}**\n\n` +
        `${t('testedUrls')}\n${tried}\n\n` +
        `${t('solutions')}\n` +
        `1. ${t('ollamaOnHost')}\n` +
        `   ${t('setOllamaHostLocal')}\n\n` +
        `2. ${t('nodejsInDocker')}\n` +
        `   ${t('setOllamaHostDocker')}\n\n` +
        `3. ${t('checkOllamaRunning')}\n` +
        `   \`ollama serve\`\n\n` +
        `4. ${t('checkModelDownloaded')}\n` +
        `   \`ollama pull qwen2.5-coder:7b\``
    );
}

// ── Send AI Message ─────────────────────────────────────────────

// ── Format AI response text (basic markdown) ──────────────────
function formatAIText(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```haskell\n([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$1</code></pre>')
        .replace(/```([\s\S]*?)```/g, '<pre class="ai-code-block"><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

async function sendAIMessage() {
    const aiInput = document.getElementById('ai-input');
    const aiSendBtn = document.getElementById('ai-send-btn');
    const message = aiInput.value.trim();

    if (!message || isAIResponding) return;

    // Add user message
    addAIMessage('user', message);
    aiInput.value = '';
    aiInput.style.height = 'auto';

    // Disable input while responding
    isAIResponding = true;
    aiSendBtn.disabled = true;
    aiInput.disabled = true;
    aiSendBtn.textContent = '⏳';
    aiInput.placeholder = 'Qwen réfléchit...';

    try {
        const code     = window.editor ? window.editor.getValue() : '';
        const language = getCurrentLanguage();

        const response = await fetch('/ai/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ message, code, language })
        });

        if (!response.ok) {
            // Server returned an error — read as JSON not SSE
            const errData = await response.json().catch(() => ({ error: 'Erreur HTTP ' + response.status }));
            throw new Error(errData.error || 'Erreur HTTP ' + response.status);
        }

        // Verify we got SSE back (not a JSON error slipping through)
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            const text = await response.text();
            try { const j = JSON.parse(text); throw new Error(j.error || text); }
            catch (e) { throw new Error('Réponse inattendue du serveur: ' + text.slice(0, 100)); }
        }

        // ── Stream SSE tokens into a live bubble ──
        const reader  = response.body.getReader();
        const decoder = new TextDecoder();

        // Remove thinking indicator, create streaming bubble
        const thinkingEl = document.getElementById('ai-thinking');
        if (thinkingEl) thinkingEl.remove();

        const bubble = document.createElement('div');
        bubble.className = 'ai-message assistant';
        document.getElementById('ai-messages').appendChild(bubble);

        let   fullText = '';
        let   buf      = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') break;
                try {
                    const obj = JSON.parse(payload);
                    if (obj.error) {
                        const thinkEl = document.getElementById('ai-thinking');
                        if (thinkEl) thinkEl.remove();
                        addAIMessage('system', obj.error);
                        return; // stop processing
                    }
                    if (obj.token) {
                        fullText += obj.token;
                        bubble.innerHTML = formatAIText(fullText) + '<span class="ai-cursor">▋</span>';
                        bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                } catch (parseErr) {
                    console.warn('[AI] SSE parse error on line:', JSON.stringify(line), parseErr.message);
                }
            }
        }

        // Final render without cursor
        bubble.innerHTML = formatAIText(fullText);

        // Add insert button if code block present
        if (fullText.includes('```')) {
            const btn = document.createElement('button');
            btn.className = 'ai-insert-btn';
            btn.textContent = '📝 Insert into editor';
            btn.onclick = () => insertCodeIntoEditor(fullText);
            bubble.appendChild(btn);
        }

        aiMessages.push({ type: 'assistant', content: fullText, timestamp: Date.now() });

    } catch (error) {
        const thinkingEl = document.getElementById('ai-thinking');
        if (thinkingEl) thinkingEl.remove();
        console.error('AI error:', error);
        addAIMessage('system', 'Erreur: ' + error.message + '. Vérifiez que votre modèle Qwen est bien démarré.');
    } finally {
        isAIResponding = false;
        aiSendBtn.disabled = false;
        aiInput.disabled = false;
        aiSendBtn.textContent = '➤';
        aiInput.placeholder = 'Ask a question or describe what you want to build…';
        // Remove any leftover cursor
        document.querySelectorAll('.ai-cursor').forEach(el => el.remove());
        aiInput.focus();
    }
}

// ── Quick Actions ───────────────────────────────────────────────
function askAboutCode() {
    const code = window.editor ? window.editor.getValue() : '';
    if (!code.trim()) {
        addAIMessage('system', 'Aucun code dans l\'éditeur. Veuillez d\'abord écrire du code Haskell.');
        return;
    }

    document.getElementById('ai-input').value = 'Analyse ce code Haskell/Plutus et donne-moi des suggestions d\'amélioration, d\'optimisation ou d\'explication.';
    sendAIMessage();
}

function generatePlutusContract() {
    const prompt = `Génère un contrat intelligent Plutus complet en Haskell avec :
- Un validator fonctionnel
- Les types de données appropriés (Datum, Redeemer)
- La logique métier
- Les imports nécessaires
- Des commentaires explicatifs

Le contrat devrait être prêt à compiler et déployer. Décris brièvement ce que fait le contrat.`;

    document.getElementById('ai-input').value = prompt;
    sendAIMessage();
}

function generateHaskellFunction() {
    const prompt = `Génère une fonction Haskell utile pour le développement Plutus avec :
- Le type signature complet
- La logique implémentée
- Des commentaires explicatifs
- Des exemples d'utilisation si pertinent

La fonction devrait être pure, bien typée et suivre les bonnes pratiques Haskell.`;

    document.getElementById('ai-input').value = prompt;
    sendAIMessage();
}

function askForHelp() {
    document.getElementById('ai-input').value = t('aiNeedHelp');
    sendAIMessage();
}

function clearAIChat() {
    aiMessages = [];
    document.getElementById('ai-messages').innerHTML = '';
    addAIMessage('assistant', t('chatCleared'));
}

// ── Insert Code into Editor ────────────────────────────────────
async function insertCodeIntoEditor(content) {
    if (!window.editor) {
        addAIMessage('system', 'Erreur: Éditeur non disponible.');
        return;
    }

    // ── Extraire le bloc de code Haskell ──
    const codeBlockRegex = /```haskell\s*\n([\s\S]*?)```|```\s*\n([\s\S]*?)```/;
    const match = content.match(codeBlockRegex);

    if (!match) {
        addAIMessage('system', 'Aucun bloc de code Haskell trouvé dans la réponse.');
        return;
    }

    const code = (match[1] || match[2]).trim();

    // ── Extraire le nom du module pour nommer le fichier ──
    const moduleMatch = code.match(/^module\s+([A-Z][A-Za-z0-9_.]*)/m);
    const moduleName  = moduleMatch ? moduleMatch[1].split('.').pop() : 'AIGenerated';
    const fileName    = moduleName + '.hs';

    // ── Construire le chemin (dans le dossier courant de la sidebar) ──
    const dir      = window.currentSidebarPath || '';
    const filePath = dir ? `${dir}/${fileName}` : fileName;

    // ── Vérifier si le fichier existe déjà → proposer un nom alternatif ──
    let finalPath = filePath;
    let finalName = fileName;
    try {
        const check = await fetch(`/workspace/file?name=${encodeURIComponent(filePath)}`);
        if (check.ok) {
            // Fichier existe — ajouter suffixe timestamp
            const suffix   = '_' + Date.now().toString(36).toUpperCase();
            finalName = moduleName + suffix + '.hs';
            finalPath = dir ? `${dir}/${finalName}` : finalName;
        }
    } catch (_) {}

    // ── Créer le fichier dans le workspace ──
    const r = await fetch('/workspace/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: finalPath, content: code })
    });

    if (!r.ok) {
        addAIMessage('system', `❌ Erreur lors de la création du fichier : ${await r.text()}`);
        return;
    }

    // ── Ouvrir le fichier dans l'éditeur ──
    await window.selectFile(finalPath, finalName);

    // ── Pré-remplir le validator name si détectable ──
    const validatorMatch = code.match(/\{-#\s*INLINABLE\s+(\w+)\s*#-\}|^(\w+)\s*::\s*.*BuiltinData.*->.*BuiltinData.*->.*BuiltinData/m);
    if (validatorMatch) {
        const vName = validatorMatch[1] || validatorMatch[2];
        if (vName) {
            document.getElementById('validatorNameInput').value = vName;
        }
    }

    addAIMessage('system', `✅ Fichier **${finalName}** créé et ouvert. Clique sur ▶ Compile pour le compiler.`);

    // ── Rafraîchir la sidebar ──
    window.refreshFiles();
}

// ── Add AI Message to Chat ──────────────────────────────────────
function addAIMessage(type, content) {
    const messagesDiv = document.getElementById('ai-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${type}`;

    // Convert markdown-like formatting to HTML
    let formattedContent = content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');

    messageDiv.innerHTML = formattedContent;

    // Add insert button for assistant messages that contain code
    if (type === 'assistant' && (content.includes('```haskell') || content.includes('```'))) {
        const insertBtn = document.createElement('button');
        insertBtn.className = 'ai-insert-btn';
        insertBtn.textContent = '📝 Insérer dans l\'éditeur';
        insertBtn.onclick = () => insertCodeIntoEditor(content);
        messageDiv.appendChild(insertBtn);
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    aiMessages.push({ type, content, timestamp: Date.now() });
}

function getCurrentLanguage() {
    if (!window.editor) return 'haskell';

    const model = window.editor.getModel();
    if (!model) return 'haskell';

    const language = model.getLanguageId();
    return language === 'haskell' ? 'haskell' : 'plaintext';
}

// ── Initialize when DOM is ready ───────────────────────────────
document.addEventListener('DOMContentLoaded', initAIChat);

// ── Handle tab switching to ensure AI input is enabled ──────────
function onAITabShown() {
    const aiInput = document.getElementById('ai-input');
    const aiSendBtn = document.getElementById('ai-send-btn');

    if (aiInput && aiSendBtn) {
        aiInput.disabled = false;
        aiSendBtn.disabled = false;
        aiInput.focus();
        console.log('🔄 AI tab activated - input enabled');
    }
}

function testAIInput() {
    const aiInput = document.getElementById('ai-input');
    if (aiInput) {
        aiInput.value = 'Test de saisie - ceci est un message de test pour vérifier que l\'input fonctionne.';
        aiInput.focus();
        console.log('🧪 Test input: input is working, value set to:', aiInput.value);
    } else {
        console.error('❌ Test input: ai-input element not found');
    }
}

// ════════════════════════════════════════════════════════════════
//  RAG — Gestion des fichiers de référence
// ════════════════════════════════════════════════════════════════

async function loadRagPanel() {
    const r = await fetch('/rag/files').catch(() => null);
    if (!r || !r.ok) return;
    const { files, stats } = await r.json();

    const container = document.getElementById('rag-file-list');
    if (!container) return;

    if (files.length === 0) {
        container.innerHTML = `<div class="rag-empty">Aucun fichier de référence.<br>Uploadez des .hs pour améliorer l'IA.</div>`;
    } else {
        container.innerHTML = files.map(f => `
            <div class="rag-file-item">
                <div class="rag-file-info">
                    <span class="rag-file-name">λ ${f.name}</span>
                    <span class="rag-file-meta">${f.chunks} chunks · ${(f.size/1024).toFixed(1)} KB</span>
                </div>
                <button class="rag-del-btn" onclick="deleteRagFile('${f.name}')" title="Supprimer">🗑</button>
            </div>`).join('');
    }

    const badge = document.getElementById('rag-stats-badge');
    if (badge) badge.textContent = `${stats.files} fichiers · ${stats.chunks} chunks`;
}

async function uploadRagFile() {
    const input = document.getElementById('rag-upload-input');
    if (!input || !input.files.length) return notify('Sélectionnez un fichier .hs', 'warn');

    const file = input.files[0];
    if (!file.name.endsWith('.hs')) return notify('Seuls les fichiers .hs sont acceptés', 'warn');

    const content = await file.text();
    const r = await fetch('/rag/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, content })
    });

    if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'Erreur inconnue' }));
        return notify('Erreur upload: ' + err.error, 'error');
    }

    const { stats } = await r.json();
    notify(`✅ ${file.name} ajouté (${stats.chunks} chunks total)`, 'ok', 3000);
    input.value = '';
    loadRagPanel();
    addAIMessage('system', `📚 Fichier de référence **${file.name}** indexé. L'IA va maintenant utiliser ses patterns.`);
}

async function uploadRagFromWorkspace() {
    // Uploader le fichier actuellement ouvert dans l'éditeur comme référence
    if (!window.selectedFileName || !window.selectedFileName.endsWith('.hs')) {
        return notify('Ouvrez un fichier .hs dans l\'éditeur d\'abord', 'warn');
    }
    const content = window.editor ? window.editor.getValue() : '';
    if (!content.trim()) return notify('Le fichier est vide', 'warn');

    const name = window.selectedFileName;
    const r = await fetch('/rag/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content })
    });
    if (!r.ok) return notify('Erreur: ' + (await r.json().catch(() => ({}))).error, 'error');
    const { stats } = await r.json();
    notify(`✅ ${name} ajouté comme référence RAG`, 'ok', 3000);
    loadRagPanel();
    addAIMessage('system', `📚 **${name}** ajouté comme exemple de référence (${stats.chunks} chunks).`);
}

async function deleteRagFile(name) {
    const r = await fetch(`/rag/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) return notify('Erreur suppression', 'error');
    notify(`"${name}" retiré de la base RAG`, 'ok', 2000);
    loadRagPanel();
}

function toggleRagPanel() {
    const body  = document.getElementById('rag-body');
    const arrow = document.getElementById('rag-toggle-arrow');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display  = open ? 'block' : 'none';
    arrow.textContent   = open ? '▾' : '▸';
    if (open) loadRagPanel();
}

// Initialiser le panel RAG quand on passe sur l'onglet AI
const _origOnAITabShown = window.onAITabShown;
function onAITabShown() {
    if (_origOnAITabShown) _origOnAITabShown();
    loadRagPanel();
}

// ── Expose functions globally for HTML onclick handlers ────────
window.sendAIMessage = sendAIMessage;
window.askAboutCode = askAboutCode;
window.generatePlutusContract = generatePlutusContract;
window.generateHaskellFunction = generateHaskellFunction;
window.askForHelp = askForHelp;
window.clearAIChat = clearAIChat;
window.onAITabShown = onAITabShown;
window.testAIInput = testAIInput;
window.probeAIStatus = probeAIStatus;
window.uploadRagFile = uploadRagFile;
window.uploadRagFromWorkspace = uploadRagFromWorkspace;
window.deleteRagFile = deleteRagFile;
window.loadRagPanel = loadRagPanel;
window.toggleRagPanel = toggleRagPanel;