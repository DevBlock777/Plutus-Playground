/**
 * rag.js — Retrieval-Augmented Generation pour Plutus/Haskell
 *
 * Exports attendus par server.js :
 *   buildRagContext(query, code?)  → string  injecté dans le prompt
 *   rebuildIndex()                 → void    recharge tout depuis le disque
 *   addFileToIndex(name, content)  → void    ajoute un fichier à chaud
 *   removeFileFromIndex(name)      → void    supprime un fichier de l'index
 *   listRagFiles()                 → array   liste des fichiers indexés
 *   getRagStats()                  → object  { files, chunks, ragDir }
 *   RAG_DIR                        → string  chemin du dossier de référence
 *
 * Structure du dossier rag/ (à la racine du projet ou dans backend/) :
 *   rag/
 *     Vesting.hs
 *     ParameterizedVesting.hs
 *     Utils.hs
 *     ...
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────
// Cherche le dossier rag/ à plusieurs emplacements
function findRagDir() {
    const candidates = [
        process.env.RAG_DIR,
        path.join(__dirname, '..', 'rag'),   // projet/rag  (si server.js est dans backend/)
        path.join(__dirname, 'rag'),          // backend/rag
        path.join(process.cwd(), 'rag'),      // depuis où Node est lancé
    ].filter(Boolean);

    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    }
    // Créer le dossier par défaut s'il n'existe pas
    const defaultDir = path.join(__dirname, '..', 'rag');
    fs.mkdirSync(defaultDir, { recursive: true });
    // Écrire un README explicatif
    fs.writeFileSync(path.join(defaultDir, 'README.md'), [
        '# RAG Reference Files',
        '',
        'Place correct, working Plutus v2 Haskell files here (.hs).',
        'They will be used as context by the AI assistant.',
        '',
        'Files are ranked by relevance to each user question.',
        'Restart the server OR call POST /ai/rag/reload after adding files.',
    ].join('\n'));
    return defaultDir;
}

export const RAG_DIR = findRagDir();

const MAX_DOCS       = parseInt(process.env.RAG_MAX_DOCS  || '3');   // fichiers injectés max
const MAX_FILE_CHARS = parseInt(process.env.RAG_MAX_CHARS || '3000'); // taille max par fichier

// ── Index en mémoire ──────────────────────────────────────────────
// [{ name, content, tokens }]
let index = [];

// ── Mots vides ────────────────────────────────────────────────────
const STOPWORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'of','in','to','for','with','on','at','by','from','as','into',
    'and','or','not','but','if','then','else','let','where','case',
    'import','qualified','module','data','type','newtype','class',
    'instance','deriving','return','show','read','true','false',
]);

function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9_']/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// ── TF-IDF ────────────────────────────────────────────────────────
let idfMap = {};

function computeIDF() {
    const N = index.length;
    if (N === 0) { idfMap = {}; return; }
    const df = {};
    for (const doc of index) {
        const uniq = new Set(doc.tokens);
        for (const t of uniq) df[t] = (df[t] || 0) + 1;
    }
    idfMap = {};
    for (const [term, freq] of Object.entries(df)) {
        idfMap[term] = Math.log((N + 1) / (freq + 1)) + 1;
    }
}

function scoreDoc(queryTokens, docTokens) {
    if (!queryTokens.length || !docTokens.length) return 0;
    const tf = {};
    for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;
    const maxTf = Math.max(...Object.values(tf), 1);
    let score = 0;
    for (const qt of queryTokens) {
        if (tf[qt]) score += (tf[qt] / maxTf) * (idfMap[qt] || 1);
    }
    return score;
}

// ── API publique ──────────────────────────────────────────────────

/** Recharge tous les fichiers .hs depuis RAG_DIR */
export function rebuildIndex() {
    index = [];
    if (!fs.existsSync(RAG_DIR)) return;

    const files = fs.readdirSync(RAG_DIR).filter(f => f.endsWith('.hs'));
    for (const file of files) {
        try {
            const content = fs.readFileSync(path.join(RAG_DIR, file), 'utf8');
            index.push({ name: file, content, tokens: tokenize(content) });
        } catch (e) {
            console.warn(`[RAG] Cannot load ${file}:`, e.message);
        }
    }
    computeIDF();
    if (index.length > 0) {
        console.log(`[RAG] Index built: ${index.length} files`);
        index.forEach(d => console.log(`[RAG]   • ${d.name} (${d.content.length} chars)`));
    } else {
        console.log(`[RAG] No .hs files in ${RAG_DIR} — add reference files to enable RAG`);
    }
}

/** Ajoute ou met à jour un fichier dans l'index sans recharger tout */
export function addFileToIndex(name, content) {
    const existing = index.findIndex(d => d.name === name);
    const entry = { name, content, tokens: tokenize(content) };
    if (existing >= 0) index[existing] = entry;
    else index.push(entry);
    computeIDF();
}

/** Retire un fichier de l'index */
export function removeFileFromIndex(name) {
    index = index.filter(d => d.name !== name);
    computeIDF();
}

/** Liste les fichiers indexés */
export function listRagFiles() {
    return index.map(d => ({ name: d.name, chars: d.content.length }));
}

/** Stats globales */
export function getRagStats() {
    return {
        files:  index.length,
        chunks: index.reduce((s, d) => s + d.tokens.length, 0),
        ragDir: RAG_DIR,
    };
}

/**
 * Sélectionne les fichiers les plus pertinents et construit
 * le bloc de contexte à injecter dans le prompt.
 */
export function buildRagContext(query = '', code = '') {
    if (index.length === 0) return '';

    const queryTokens = tokenize((query + ' ' + code).slice(0, 2000));
    const scored = index
        .map(doc => ({ doc, score: scoreDoc(queryTokens, doc.tokens) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_DOCS);

    if (scored.length === 0) {
        // Aucun match pertinent — injecter quand même le(s) premier(s) fichier(s)
        // car pour Plutus tout contexte est utile
        scored.push(...index.slice(0, Math.min(2, index.length)).map(doc => ({ doc, score: 0 })));
    }

    const lines = [
        '=== PLUTUS/HASKELL REFERENCE EXAMPLES (correct, working code) ===',
        'Study the imports, types, and patterns in these files carefully.',
        'Replicate their structure exactly when generating new code.',
        '',
    ];

    for (const { doc, score } of scored) {
        const content = doc.content.length > MAX_FILE_CHARS
            ? doc.content.slice(0, MAX_FILE_CHARS) + '\n-- [file truncated]'
            : doc.content;
        lines.push(`--- ${doc.name} ---`);
        lines.push(content);
        lines.push('');
        if (score > 0) console.log(`[RAG] +${doc.name} (score=${score.toFixed(2)})`);
        else           console.log(`[RAG] +${doc.name} (fallback)`);
    }

    lines.push('=== END OF REFERENCE EXAMPLES ===');
    return lines.join('\n');
}

// ── Charger l'index au démarrage du module ─────────────────────
rebuildIndex();