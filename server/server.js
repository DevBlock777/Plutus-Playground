import express, { json } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import session from 'express-session';
import { TEMPLATES } from './templates.js';
import { RedisStore } from 'connect-redis';
import { v4 as uuidv4 } from 'uuid';
import { extractModuleName } from './utils.js';
import { registerRoutes, requireAuth } from './auth.js';
import { hashSource, getCache, setCache, cacheStats } from './cache.js';
import { connectRedis, sessionClient } from './redis.js';
import {
    acquireSlot, checkRateLimit, getMetrics,
    recordJobStart, recordJobSuccess, recordJobFailure,
    recordCacheHit, recordCacheMiss,
    appendJobLog, getJobLog, storeJobArtifact, getJobArtifact,
    JOB_TIMEOUT_MS, MAX_OUTPUT_MB, RATE_LIMIT_MAX,
} from './jobQueue.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Middleware ──
app.use(json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cors({ origin: false }));

// ── Fichiers statiques frontend (CSS, JS modules) ──
// Sert ide-styles.css, ide-core.js, ide-workspace.js, ide-compile.js, ide-terminal.js
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Sessions Redis (DB 0) ──
app.use(session({
    store: new RedisStore({ client: sessionClient }),
    name:   'plutus.sid',
    secret: process.env.SESSION_SECRET || 'plutus-session-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── Routes publiques ──
app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/ide');
    res.redirect('/login');
});

registerRoutes(app);

app.get('/ide', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ══════════════════════════════════════════════════════════
//  HEALTH + VERSION  (Outcome #69789)
// ══════════════════════════════════════════════════════════

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Toolchain versions fetched once at startup from inside Docker
let serverVersions = { ghc: 'fetching…', cabal: 'fetching…', nix: 'fetching…', ide: '1.0.0' };

app.get('/version', (_req, res) => res.json(serverVersions));

function fetchVersions() {
    exec(
        `docker exec plutus-runner bash -lc "source /root/.nix-profile/etc/profile.d/nix.sh && ghc --version && cabal --version && nix --version" 2>/dev/null`,
        (err, out) => {
            if (err || !out) return;
            const lines = out.split('\n').filter(Boolean);
            if (lines[0]) serverVersions.ghc   = lines[0].trim();
            if (lines[1]) serverVersions.cabal = lines[1].trim();
            if (lines[2]) serverVersions.nix   = lines[2].trim();
            console.log('[version]', serverVersions);
        }
    );
}

// ══════════════════════════════════════════════════════════
//  METRICS  (Outcome #69791)
// ══════════════════════════════════════════════════════════

app.get('/admin/metrics', requireAuth, async (_req, res) => {
    const [m, cache] = await Promise.all([getMetrics(), cacheStats()]);
    res.json({ ...m, cache });
});

// ══════════════════════════════════════════════════════════
//  JOB LOGS + ARTIFACT DOWNLOAD  (Outcome #69788 / #69789)
// ══════════════════════════════════════════════════════════

// Logs GHC retenus 24h par jobId
app.get('/job/:jobId/log', requireAuth, async (req, res) => {
    const log = await getJobLog(req.params.jobId);
    if (!log) return res.status(404).json({ error: 'Log not found or expired (24h TTL)' });
    res.type('text/plain').send(log);
});

// Métadonnées de l'artefact
app.get('/job/:jobId/artifact', requireAuth, async (req, res) => {
    const artifact = await getJobArtifact(req.params.jobId);
    if (!artifact) return res.status(404).json({ error: 'Artifact not found or expired (24h TTL)' });
    res.json(artifact);
});

// Téléchargement .plutus (format standard Cardano)
app.get('/job/:jobId/download', requireAuth, async (req, res) => {
    const artifact = await getJobArtifact(req.params.jobId);
    if (!artifact) return res.status(404).json({ error: 'Artifact not found or expired (24h TTL)' });
    const name = (artifact.fileName || req.params.jobId).replace('.hs', '.plutus');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
        type:        'PlutusScriptV2',
        description: artifact.fileName || '',
        cborHex:     artifact.cborHex,
    }, null, 2));
});

// ── TMP dir ──
const TMP_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function sendSSE(res, data, type = 'stdout') {
    res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
}
function endSSE(res) {
    res.write('event: done\ndata: {}\n\n');
    res.end();
}

function userWspace(userId) { return `/app/code/wspace/users/${userId}`; }
function ensureUserDir(userId, cb) {
    exec(`docker exec plutus-runner mkdir -p "${userWspace(userId)}"`, cb);
}

// ══════════════════════════════════════════
//  WORKSPACE
// ══════════════════════════════════════════

app.get('/workspace/files', requireAuth, (req, res) => {
    const subPath  = req.query.path || "";
    const base     = userWspace(req.session.user.id);
    const targetDir = subPath ? `${base}/${subPath}` : base;

    ensureUserDir(req.session.user.id, () => {
        exec(`docker exec plutus-runner ls -p "${targetDir}"`, (err, stdout) => {
            if (err) return res.json([]);
            const items = stdout.split('\n')
                .filter(l => l.trim() !== '')
                .map(name => ({
                    name:        name.replace(/\/$/, ''),
                    isDirectory: name.endsWith('/'),
                    fullPath:    subPath
                        ? `${subPath}/${name.replace(/\/$/, '')}`
                        : name.replace(/\/$/, '')
                }));
            res.json(items);
        });
    });
});

app.get('/workspace/file', requireAuth, (req, res) => {
    const filePath = req.query.name;
    if (!filePath) return res.status(400).send("Missing 'name' parameter");
    const fullPath = `${userWspace(req.session.user.id)}/${filePath}`;
    exec(`docker exec plutus-runner cat "${fullPath}"`, (err, stdout) => {
        if (err) return res.status(404).send("File not found");
        res.send(stdout);
    });
});

app.post('/workspace/create', requireAuth, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("Missing filePath");
    const baseName        = path.basename(filePath);
    const dirInContainer  = `${userWspace(req.session.user.id)}/${path.dirname(filePath)}`.replace(/\/\.$/, '');
    const tmpPath         = path.join(TMP_DIR, `new_${uuidv4()}_${baseName}`);
    fs.writeFileSync(tmpPath, content || '');
    const cmd = `docker exec plutus-runner mkdir -p "${dirInContainer}" && docker cp "${tmpPath}" plutus-runner:"${userWspace(req.session.user.id)}/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("File created");
    });
});

app.post('/workspace/save', requireAuth, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("Missing filePath");
    if (content === undefined) return res.status(400).send("Missing content");
    const baseName = path.basename(filePath);
    const tmpPath  = path.join(TMP_DIR, `save_${uuidv4()}_${baseName}`);
    fs.writeFileSync(tmpPath, content);
    const cmd = `docker cp "${tmpPath}" plutus-runner:"${userWspace(req.session.user.id)}/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("Saved");
    });
});

// Créer un dossier
app.post('/workspace/mkdir', requireAuth, (req, res) => {
    const { dirPath } = req.body;
    if (!dirPath) return res.status(400).send("Missing dirPath");
    // Sanitize: no traversal, no absolute paths
    if (dirPath.includes('..') || dirPath.startsWith('/'))
        return res.status(400).send("Invalid path");
    const fullPath = `${userWspace(req.session.user.id)}/${dirPath}`;
    exec(`docker exec plutus-runner mkdir -p "${fullPath}"`, (err) => {
        if (err) return res.status(500).send(err.message);
        res.send("Directory created");
    });
});

// Supprimer un fichier ou dossier
app.delete('/workspace/delete', requireAuth, (req, res) => {
    const { itemPath, isDirectory } = req.body;
    if (!itemPath) return res.status(400).send("Missing itemPath");
    if (itemPath.includes('..') || itemPath.startsWith('/'))
        return res.status(400).send("Invalid path");
    const fullPath = `${userWspace(req.session.user.id)}/${itemPath}`;
    const cmd = isDirectory
        ? `docker exec plutus-runner rm -rf "${fullPath}"`
        : `docker exec plutus-runner rm -f "${fullPath}"`;
    exec(cmd, (err) => {
        if (err) return res.status(500).send(err.message);
        res.send("Deleted");
    });
});

// ══════════════════════════════════════════════════════════
//  adjustGHCOutput — Corrige les numéros de ligne GHC
// ══════════════════════════════════════════════════════════
function adjustGHCOutput(text, offset, displayFile) {
    if (!offset || offset <= 0) return text;
    let result = text;
    if (displayFile) result = result.replace(/lecture\/Main\.hs/g, displayFile);
    result = result.replace(
        /(\S+\.hs:)(\d+)(:\d+:)/g,
        (_match, prefix, lineStr, suffix) => `${prefix}${Math.max(1, parseInt(lineStr) - offset)}${suffix}`
    );
    result = result.replace(
        /^(\s*)(\d+)(\s*\|)/gm,
        (_match, prefix, lineStr, suffix) =>
            `${prefix}${String(Math.max(1, parseInt(lineStr) - offset)).padStart(lineStr.length)}${suffix}`
    );
    return result;
}

// ══════════════════════════════════════════════════════════
//  analyzeValidatorType
// ══════════════════════════════════════════════════════════
function analyzeValidatorType(sourceCode, validatorName) {
    const escaped = validatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex   = new RegExp(`^${escaped}\\s*::(.+?)(?=\\n\\S|$)`, 'ms');
    const match   = sourceCode.match(regex);
    const result  = { isUntyped: false, returnsBool: false, returnsUnit: false, found: false, actualValidatorName: validatorName };

    if (!match) {
        console.log(`[IDE] Signature for "${validatorName}" not found — searching for validator function`);
        const found = findValidatorName(sourceCode);
        if (found) {
            console.log(`[IDE] Found validator: ${found} — re-analyzing`);
            result.actualValidatorName = found;
            // Re-analyze with found name
            const foundEscaped = found.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const foundRegex   = new RegExp(`^${foundEscaped}\\s*::(.+?)(?=\\n\\S|$)`, 'ms');
            const foundMatch   = sourceCode.match(foundRegex);
            if (foundMatch) {
                result.found = true;
                const sig = foundMatch[1].replace(/\s+/g, ' ').trim();
                console.log(`[IDE] Signature: ${found} :: ${sig}`);
                result.isUntyped   = /(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*\(\)/.test(sig);
                result.returnsBool = /->[\s]*Bool\s*$/.test(sig);
                result.returnsUnit = /->[\s]*\(\)\s*$/.test(sig);
            } else {
                // If found but no sig, assume typed Bool
                result.returnsBool = true;
            }
        } else {
            console.log(`[IDE] No validator found — defaulting typed+Bool`);
            result.returnsBool = true;
        }
        return result;
    }
    result.found = true;
    const sig = match[1].replace(/\s+/g, ' ').trim();
    console.log(`[IDE] Signature: ${validatorName} :: ${sig}`);
    result.isUntyped   = /(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*\(\)/.test(sig);
    result.returnsBool = /->[\s]*Bool\s*$/.test(sig);
    result.returnsUnit = /->[\s]*\(\)\s*$/.test(sig);
    console.log(`[IDE] isUntyped=${result.isUntyped} returnsBool=${result.returnsBool} returnsUnit=${result.returnsUnit}`);
    return result;
}

// ══════════════════════════════════════════════════════════
//  findValidatorName — Détecte automatiquement le nom du validateur
// ══════════════════════════════════════════════════════════
function findValidatorName(sourceCode) {
    const lines = sourceCode.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes(' :: ')) {
            const parts = trimmed.split(' :: ');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const sig = parts[1].trim();
                // Détecte les signatures de validateur typiques
                if (name && sig && (
                    sig.includes('-> Bool') ||  // Validateur typé retournant Bool
                    (sig.includes('BuiltinData') && sig.includes('-> ()'))  // Validateur non typé
                )) {
                    console.log(`[IDE] Validateur détecté automatiquement: ${name}`);
                    return name;
                }
            }
        }
    }
    return null;
}

// ══════════════════════════════════════════════════════════
//  buildAugmentedSource
// ══════════════════════════════════════════════════════════
function buildAugmentedSource(sourceCode, _moduleName, jobId, validatorName) {
    let src = sourceCode;
    let linesAddedBefore = 0;

    const analysis = analyzeValidatorType(src, validatorName);

    // 1. Pragmas requis
    const requiredPragmas = ['TemplateHaskell', 'DataKinds', 'NoImplicitPrelude'];
    const missing = requiredPragmas.filter(p => !src.includes(p));
    if (missing.length > 0) {
        src = missing.map(p => `{-# LANGUAGE ${p} #-}`).join('\n') + '\n' + src;
        linesAddedBefore += missing.length;
    }

    // 2. Renommer module → Main
    const hadModule = /^module\s+/m.test(sourceCode);
    if (hadModule) {
        src = src.replace(/^module\s+\S+(\s*\([^)]*\))?\s+where/m, 'module Main where');
    } else {
        const lines = src.split('\n');
        let idx = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('{-#') || lines[i].trim() === '') idx = i + 1;
            else break;
        }
        lines.splice(idx, 0, 'module Main where');
        src = lines.join('\n');
        linesAddedBefore += 1;
    }

    // 3. IDE imports
    const ideImportLines = [
        '',
        '-- ── IDE auto-imports ──',
        'import qualified PlutusTx              as IDE_PlutusTx',
        'import qualified PlutusTx.Prelude      as IDE_PP',
        'import qualified Plutus.V2.Ledger.Api  as IDE_V2',
        'import           Utilities             (writeValidatorToFile)',
        'import           Prelude               (IO, putStrLn)',
        '-- ────────────────────────',
        ''
    ];
    const insertedText   = '\n' + ideImportLines.join('\n');
    linesAddedBefore    += (insertedText.match(/\n/g) || []).length;
    src = src.replace(/(module\s+Main\s+where)/, '$1' + insertedText);

    // 4. Supprimer main existant
    src = src.replace(/^main\s*::\s*IO\s*\(\)\s*$/gm, '-- [IDE removed] main :: IO ()');
    src = src.replace(/^main\s*=\s*.+$/gm,            '-- [IDE removed] main = …');

    // 5. Bloc injecté
    let block;
    if (analysis.isUntyped) {
        block = `

-- ══ Auto-injected (untyped validator) ══
_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript $$(IDE_PlutusTx.compile [|| ${analysis.actualValidatorName} ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
`;
    } else if (analysis.returnsBool) {
        block = `

-- ══ Auto-injected (typed validator -> Bool) ══
{-# INLINEABLE _ide_untypedValidator #-}
_ide_untypedValidator :: IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> ()
_ide_untypedValidator datum redeemer ctx =
  IDE_PP.check
    ( ${analysis.actualValidatorName}
        (IDE_PlutusTx.unsafeFromBuiltinData datum)
        (IDE_PlutusTx.unsafeFromBuiltinData redeemer)
        (IDE_PlutusTx.unsafeFromBuiltinData ctx)
    )

_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript $$(IDE_PlutusTx.compile [|| _ide_untypedValidator ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
`;
    } else {
        block = `

-- ══ Auto-injected (typed validator -> ()) ══
{-# INLINEABLE _ide_untypedValidator #-}
_ide_untypedValidator :: IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> ()
_ide_untypedValidator datum redeemer ctx =
  ${analysis.actualValidatorName}
    (IDE_PlutusTx.unsafeFromBuiltinData datum)
    (IDE_PlutusTx.unsafeFromBuiltinData redeemer)
    (IDE_PlutusTx.unsafeFromBuiltinData ctx)

_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript $$(IDE_PlutusTx.compile [|| _ide_untypedValidator ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
`;
    }

    src += block;
    console.log(`[IDE] lineOffset=${linesAddedBefore} (${missing.length} pragmas, ${hadModule ? 0 : 1} module, imports)`);
    return { source: src, lineOffset: linesAddedBefore };
}

// ══════════════════════════════════════════════════════════
//  COMPILATION  (POST /run)
//  Outcome #69789 : queue, timeout, limits
//  Outcome #69790 : rate limit
//  Outcome #69791 : metrics, log retention
// ══════════════════════════════════════════════════════════
app.post('/run', requireAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { code, fileName, validatorName } = req.body;
    const jobId   = uuidv4();
    const userId  = req.session.user.id;
    const userDir = userWspace(userId);

    await recordJobStart();

    // ── Rate limit ──
    if (!(await checkRateLimit(userId))) {
        sendSSE(res, `> Rate limit: max ${RATE_LIMIT_MAX} builds/minute.\n`, 'compilation');
        await recordJobFailure();
        return endSSE(res);
    }

    // ── Queue slot ──
    let release;
    try {
        release = await acquireSlot(jobId);
    } catch (err) {
        sendSSE(res, `> ${err.message}\n`, 'compilation');
        await recordJobFailure();
        return endSSE(res);
    }

    const startTime  = Date.now();
    let   jobTimeout = null;

    // SSE + log retention helper
    function sendComp(text, lineOffset, displayFile) {
        const adjusted = adjustGHCOutput(text, lineOffset, displayFile);
        sendSSE(res, adjusted, 'compilation');
        appendJobLog(jobId, adjusted);
    }

    // Timeout watchdog
    function startTimeout(child) {
        jobTimeout = setTimeout(async () => {
            const msg = `\n> Build timed out after ${JOB_TIMEOUT_MS / 1000}s.\n`;
            sendSSE(res, msg, 'compilation');
            appendJobLog(jobId, msg);
            await recordJobFailure();
            try { child.kill('SIGKILL'); } catch (_) {}
            release();
            endSSE(res);
        }, JOB_TIMEOUT_MS);
    }

    function finishJob(child) {
        clearTimeout(jobTimeout);
        release();
        recordJobSuccess(Date.now() - startTime);
    }

    // ────────────────────────────────
    //  MODE FICHIER
    // ────────────────────────────────
    if (fileName) {
        const moduleName  = path.basename(fileName).replace('.hs', '');
        const sourceFile  = `${userDir}/${fileName}`;
        const displayFile = path.basename(fileName);

        sendSSE(res, `> Compiling ${moduleName}...\n`, 'compilation');

        exec(`docker exec plutus-runner test -f "${sourceFile}" && echo "FOUND" || echo "MISSING"`, (err, out) => {
            if (out.trim() === 'MISSING') {
                sendSSE(res, `> ERROR: ${moduleName}.hs not found in workspace.\n`, 'compilation');
                release(); return endSSE(res);
            }

            exec(`docker exec plutus-runner cat "${sourceFile}"`, { maxBuffer: 1024 * 1024 * MAX_OUTPUT_MB }, (err2, sourceCode) => {
                if (err2) {
                    sendSSE(res, `> ERROR: Could not read source file.\n`, 'compilation');
                    release(); return endSSE(res);
                }

                (async () => {
                    const hash  = hashSource(sourceCode);
                    const entry = await getCache(hash);
                    if (entry) {
                        await recordCacheHit();
                        sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
                        sendSSE(res, entry.cborHex, 'cbor');
                        sendSSE(res, `/job/${jobId}/download`, 'download');
                        const stats = await cacheStats();
                        sendSSE(res, `> Cache: ${stats.entries} entries (TTL ${stats.ttlDays}d).\n`, 'stdout');
                        await storeJobArtifact(jobId, { cborHex: entry.cborHex, fileName: displayFile, compiledAt: new Date().toISOString(), fromCache: true });
                        release(); return endSSE(res);
                    }

                    await recordCacheMiss();
                    sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

                    if (!validatorName) validatorName = findValidatorName(sourceCode) || 'mkValidator';
                    const { source: augmented, lineOffset } = buildAugmentedSource(sourceCode, moduleName, jobId, validatorName);
                    const lectureDir = `/app/code/wspace/lecture`;
                    const tmpSrc     = path.join(TMP_DIR, `Main_${jobId}.hs`);
                    fs.writeFileSync(tmpSrc, augmented);

                    const dockerCmd = `docker cp "${tmpSrc}" plutus-runner:${lectureDir}/Main.hs && \
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe 2>&1
"`;
                    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * MAX_OUTPUT_MB });
                    startTimeout(child);

                    child.stdout.on('data', (d) => {
                        if (d.includes('written successfully')) { sendSSE(res, d, 'stdout'); appendJobLog(jobId, d); }
                        else sendComp(d, lineOffset, displayFile);
                    });
                    child.stderr.on('data', (d) => sendComp(d, lineOffset, displayFile));
                    child.on('close', (exitCode) => {
                        if (fs.existsSync(tmpSrc)) fs.unlinkSync(tmpSrc);
                        finishJob(child);
                        handleClose(res, exitCode, jobId, hash, displayFile);
                    });
                    req.on('close', () => { clearTimeout(jobTimeout); child.kill(); release(); });
                })();
            });
        });
        return;
    }

    // ────────────────────────────────
    //  MODE ÉDITEUR
    // ────────────────────────────────
    if (!code) {
        sendSSE(res, 'Error: No code provided.\n', 'compilation');
        release(); return endSSE(res);
    }

    const moduleName  = extractModuleName(code);
    const displayFile = `${moduleName}.hs`;

    const hash  = hashSource(code);
    const entry = await getCache(hash);
    if (entry) {
        await recordCacheHit();
        sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
        sendSSE(res, entry.cborHex, 'cbor');
        sendSSE(res, `/job/${jobId}/download`, 'download');
        const stats = await cacheStats();
        sendSSE(res, `> Cache: ${stats.entries} entries (TTL ${stats.ttlDays}d).\n`, 'stdout');
        await storeJobArtifact(jobId, { cborHex: entry.cborHex, fileName: displayFile, compiledAt: new Date().toISOString(), fromCache: true });
        release(); return endSSE(res);
    }

    await recordCacheMiss();
    sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

    if (!validatorName) validatorName = findValidatorName(code) || 'mkValidator';
    const { source: augmented, lineOffset } = buildAugmentedSource(code, moduleName, jobId, validatorName);
    const jobDir  = path.join(TMP_DIR, jobId);
    const tmpSrc  = path.join(jobDir, 'Main.hs');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(tmpSrc, augmented);
    sendSSE(res, `[${jobId}] Initializing...\n`, 'compilation');

    const lectureDir = `/app/code/wspace/lecture`;
    const dockerCmd  = `docker cp "${tmpSrc}" plutus-runner:${lectureDir}/Main.hs && \
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe
"`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * MAX_OUTPUT_MB });
    startTimeout(child);

    child.stdout.on('data', (d) => {
        if (d.includes('Validator CBOR written')) { sendSSE(res, d, 'stdout'); appendJobLog(jobId, d); }
        else sendComp(d, lineOffset, displayFile);
    });
    child.stderr.on('data', (d) => sendComp(d, lineOffset, displayFile));
    child.on('close', (exitCode) => {
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_) {}
        finishJob(child);
        handleClose(res, exitCode, jobId, hash, displayFile);
    });
    child.on('error', (err) => {
        sendSSE(res, `Fatal Error: ${err.message}\n`, 'compilation');
        release(); endSSE(res);
    });
    req.on('close', () => { clearTimeout(jobTimeout); child.kill(); release(); });
});

// ══════════════════════════════════════════════════════════
//  handleClose — Extrait le CBOR, stocke l'artefact
// ══════════════════════════════════════════════════════════
function handleClose(res, exitCode, jobId, sourceHash = null, fileName = 'validator.plutus') {
    if (exitCode === null || exitCode === 0) {
        sendSSE(res, "> Extracting CBOR...\n", 'stdout');
        exec(`docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`, async (err, stdout) => {
            if (err) {
                sendSSE(res, `> Error reading CBOR: ${err.message}\n`, 'compilation');
                await recordJobFailure();
            } else {
                try {
                    const parsed  = JSON.parse(stdout);
                    const cborHex = parsed.cborHex || stdout.trim();

                    sendSSE(res, cborHex, 'cbor');
                    sendSSE(res, "> CBOR generated successfully.\n", 'stdout');
                    sendSSE(res, `/job/${jobId}/download`, 'download');  // URL téléchargement

                    if (sourceHash) {
                        await setCache(sourceHash, cborHex);
                        const stats = await cacheStats();
                        sendSSE(res, `> Saved to cache (${stats.entries} entries, TTL ${stats.ttlDays}d).\n`, 'stdout');
                    }
                    await storeJobArtifact(jobId, {
                        cborHex,
                        fileName:    fileName.replace('.hs', '.plutus'),
                        compiledAt:  new Date().toISOString(),
                        fromCache:   false,
                    });
                } catch (e) {
                    const raw = stdout.trim();
                    sendSSE(res, raw, 'cbor');
                    sendSSE(res, `/job/${jobId}/download`, 'download');
                    if (sourceHash) await setCache(sourceHash, raw);
                    await storeJobArtifact(jobId, {
                        cborHex:   raw,
                        fileName:  fileName.replace('.hs', '.plutus'),
                        compiledAt: new Date().toISOString(),
                        fromCache: false,
                    });
                }
            }
            endSSE(res);
        });
    } else {
        sendSSE(res, `\n> Build failed (exit code ${exitCode}).\n`, 'compilation');
        recordJobFailure();
        endSSE(res);
    }
}

// ══════════════════════════════════════════════════════════
//  TEMPLATES  (Outcome #69787)
//  Deux templates embarqués : Vesting + ParameterizedVesting
// ══════════════════════════════════════════════════════════


// GET /templates — liste des templates disponibles
app.get('/templates', requireAuth, (_req, res) => {
    const list = Object.entries(TEMPLATES).map(([id, t]) => ({
        id,
        name:        t.name,
        description: t.description,
        validatorFn: t.validatorFn,
    }));
    res.json(list);
});

// GET /templates/:id — source d'un template
app.get('/templates/:id', requireAuth, (req, res) => {
    const t = TEMPLATES[req.params.id];
    if (!t) return res.status(404).json({ error: 'Template not found' });
    res.json({ id: req.params.id, ...t });
});

// ── Bootstrap ──
connectRedis()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Plutus IDE running on http://localhost:${PORT}`);
            fetchVersions();
        });
    })
    .catch((err) => {
        console.error('[Fatal] Redis:', err.message);
        process.exit(1);
    });