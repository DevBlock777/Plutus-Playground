import express, { json } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import session from 'express-session';
import FileStore from 'session-file-store';
import { v4 as uuidv4 } from 'uuid';
import { extractModuleName } from './utils.js';
import { registerRoutes, requireAuth } from './auth.js';
import { hashSource, getCache, setCache, cacheStats } from './cache.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Middleware ──
app.use(json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: false })); // SSR : pas besoin de CORS cross-origin

// ── Sessions persistées dans ./sessions/ ──
const SessionFileStore = FileStore(session);
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

app.use(session({
    store: new SessionFileStore({
        path: SESSIONS_DIR,
        ttl: 7 * 24 * 60 * 60,   // 7 jours en secondes
        reapInterval: 3600,        // nettoyage des sessions expirées toutes les heures
        logFn: () => {}            // silencieux
    }),
    name: 'plutus.sid',
    secret: process.env.SESSION_SECRET || 'plutus-session-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,            // inaccessible depuis JS côté client
        secure: false,             // passer à true si HTTPS en prod
        maxAge: 7 * 24 * 60 * 60 * 1000  // 7 jours en ms
    }
}));

// ── Routes publiques ──
app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/ide');
    res.redirect('/login');
});

// ── Auth routes (login, register pages + POST handlers) ──
registerRoutes(app);

// ── Page IDE (protégée) ──
app.get('/ide', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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

// Dossier Docker isolé par user
function userWspace(userId) {
    return `/app/code/wspace/users/${userId}`;
}
function ensureUserDir(userId, cb) {
    exec(`docker exec plutus-runner mkdir -p "${userWspace(userId)}"`, cb);
}

// ══════════════════════════════════════════
//  WORKSPACE (toutes routes protégées SSR)
// ══════════════════════════════════════════

// Lister un dossier
app.get('/workspace/files', requireAuth, (req, res) => {
    const subPath = req.query.path || "";
    const base = userWspace(req.session.user.id);
    const targetDir = subPath ? `${base}/${subPath}` : base;

    ensureUserDir(req.session.user.id, () => {
        exec(`docker exec plutus-runner ls -p "${targetDir}"`, (err, stdout) => {
            if (err) return res.json([]);
            const items = stdout.split('\n')
                .filter(l => l.trim() !== '')
                .map(name => ({
                    name: name.replace(/\/$/, ''),
                    isDirectory: name.endsWith('/'),
                    fullPath: subPath
                        ? `${subPath}/${name.replace(/\/$/, '')}`
                        : name.replace(/\/$/, '')
                }));
            res.json(items);
        });
    });
});

// Lire un fichier
app.get('/workspace/file', requireAuth, (req, res) => {
    const filePath = req.query.name;
    if (!filePath) return res.status(400).send("Missing 'name' parameter");
    const fullPath = `${userWspace(req.session.user.id)}/${filePath}`;
    exec(`docker exec plutus-runner cat "${fullPath}"`, (err, stdout) => {
        if (err) return res.status(404).send("File not found");
        res.send(stdout);
    });
});

// Créer un fichier
app.post('/workspace/create', requireAuth, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("Missing filePath");

    const baseName = path.basename(filePath);
    const dirInContainer = `${userWspace(req.session.user.id)}/${path.dirname(filePath)}`.replace(/\/\.$/, '');
    const tmpPath = path.join(TMP_DIR, `new_${uuidv4()}_${baseName}`);

    fs.writeFileSync(tmpPath, content || '');
    const cmd = `docker exec plutus-runner mkdir -p "${dirInContainer}" && docker cp "${tmpPath}" plutus-runner:"${userWspace(req.session.user.id)}/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("File created");
    });
});

// Sauvegarder un fichier
app.post('/workspace/save', requireAuth, (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("Missing filePath");

    const baseName = path.basename(filePath);
    const tmpPath = path.join(TMP_DIR, `save_${uuidv4()}_${baseName}`);

    fs.writeFileSync(tmpPath, content || '');
    const cmd = `docker cp "${tmpPath}" plutus-runner:"${userWspace(req.session.user.id)}/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("Saved");
    });
});

// ══════════════════════════════════════════
//  COMPILATION
// ══════════════════════════════════════════
app.post('/run', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { code, fileName, validatorName } = req.body;
    const jobId = uuidv4();
    const userId = req.session.user.id;
    const userDir = userWspace(userId);

    // MODE FICHIER
    if (fileName) {
        const moduleName = path.basename(fileName).replace('.hs', '');
        const sourceFile = `${userDir}/${fileName}`;

        sendSSE(res, `> Compiling ${moduleName}...\n`, 'compilation');

        exec(`docker exec plutus-runner test -f "${sourceFile}" && echo "FOUND" || echo "MISSING"`, (err, out) => {
            if (out.trim() === 'MISSING') {
                sendSSE(res, `> ERROR: ${moduleName}.hs not found in workspace.\n`, 'compilation');
                return endSSE(res);
            }

            // Read source from Docker
            exec(`docker exec plutus-runner cat "${sourceFile}"`, (err2, sourceCode) => {
                if (err2) {
                    sendSSE(res, `> ERROR: Could not read source file.\n`, 'compilation');
                    return endSSE(res);
                }

                // Check cache on original source (before injection)
                const hash  = hashSource(sourceCode);
                const entry = getCache(hash);
                if (entry) {
                    sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
                    sendSSE(res, `> CBOR retrieved from cache.\n`, 'stdout');
                    sendSSE(res, entry.cborHex, 'cbor');
                    sendSSE(res, `> Cache: ${cacheStats().entries}/${cacheStats().maxEntries} entries.\n`, 'stdout');
                    return endSSE(res);
                }

                sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

                // Build augmented source: user code + injected CBOR block
                const augmented   = buildAugmentedSource(sourceCode, moduleName, jobId, validatorName);
                const lectureDir  = `/app/code/wspace/lecture`;
                const tmpSrc      = path.join(TMP_DIR, `${moduleName}_${jobId}.hs`);
                fs.writeFileSync(tmpSrc, augmented);

                // Copy augmented file as Main.hs (module is now "module Main")
                const dockerCmd = `docker cp "${tmpSrc}" plutus-runner:${lectureDir}/Main.hs && \
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe 2>&1
"`;
                const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 50 });
                child.stdout.on('data', (d) => sendSSE(res, d, d.includes('written successfully') ? 'stdout' : 'compilation'));
                child.stderr.on('data', (d) => sendSSE(res, d, 'compilation'));
                child.on('close', (code) => {
                    if (fs.existsSync(tmpSrc)) fs.unlinkSync(tmpSrc);
                    handleClose(res, code, jobId, hash);
                });
                req.on('close', () => child.kill());
            });
        });
        return;
    }

    // MODE ÉDITEUR
    if (!code) {
        sendSSE(res, 'Error: No code provided.\n', 'compilation');
        return endSSE(res);
    }

    const moduleName = extractModuleName(code);

    // ── Check cache first ──
    const hash  = hashSource(code);
    const entry = getCache(hash);

    if (entry) {
        sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
        sendSSE(res, `> CBOR retrieved from cache.\n`, 'stdout');
        sendSSE(res, entry.cborHex, 'cbor');
        const stats = cacheStats();
        sendSSE(res, `> Cache: ${stats.entries}/${stats.maxEntries} entries.\n`, 'stdout');
        return endSSE(res);
    }

    sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

    const augmented = buildAugmentedSource(code, moduleName, jobId, validatorName);
    const jobDir    = path.join(TMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    // Write augmented source as Main.hs (module is now "module Main")
    fs.writeFileSync(path.join(jobDir, 'Main.hs'), augmented);
    sendSSE(res, `[${jobId}] Initializing...\n`, 'compilation');

    const dockerCmd = `
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cp /app/jobs/${jobId}/Main.hs /app/code/wspace/lecture/Main.hs && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe
"`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 10 });
    child.stdout.on('data', (d) => sendSSE(res, d, d.includes('Validator CBOR written') ? 'stdout' : 'compilation'));
    child.stderr.on('data', (d) => sendSSE(res, d, 'compilation'));
    child.on('close', (exitCode) => {
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {}
        handleClose(res, exitCode, jobId, hash);
    });
    child.on('error', (err) => { sendSSE(res, `Fatal Error: ${err.message}\n`, 'compilation'); endSSE(res); });
    req.on('close', () => child.kill());
});

/**
 * Appends the CBOR generation block to the user's source file.
 * validatorName replaces "mValidator" — it's the function the user defined
 * that has type  BuiltinData -> BuiltinData -> BuiltinData -> ()
 *
 * The injected block mirrors exactly what was manually added before:
 *
 *   {-# INLINEABLE untypedValidator #-}
 *   untypedValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
 *   untypedValidator d r c = P.check (mValidator (from d) (from r) (from c))
 *
 *   validatorScript :: PlutusV2.Validator
 *   validatorScript = PlutusV2.mkValidatorScript $$(PlutusTx.compile [||untypedValidator||])
 *
 *   getCbor :: IO ()
 *   getCbor = writeValidatorToFile "./assets/xxx.plutus" validatorScript
 *   main = getCbor
 */
function buildAugmentedSource(sourceCode, moduleName, jobId, validatorName) {
    // Rename module to Main so cabal can run it as an executable
    const withMain = sourceCode.replace(/^module\s+\S+/m, 'module Main');

    const block = `

-- ── Auto-injected by Plutus IDE ──────────────────
{-# INLINEABLE _ide_untypedValidator #-}
_ide_untypedValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
_ide_untypedValidator mDatum mRedeemer ctx =
  P.check
    ( ${validatorName}
        (PlutusTx.unsafeFromBuiltinData mDatum)
        (PlutusTx.unsafeFromBuiltinData mRedeemer)
        (PlutusTx.unsafeFromBuiltinData ctx)
    )

_ide_validatorScript :: PlutusV2.Validator
_ide_validatorScript = PlutusV2.mkValidatorScript $$(PlutusTx.compile [||_ide_untypedValidator||])

getCbor :: IO ()
getCbor = writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript

main :: IO ()
main = getCbor
-- ── End auto-injected block ──────────────────────
`;

    return withMain + block;
}

function handleClose(res, exitCode, jobId, sourceHash = null) {
    if (exitCode === null || exitCode === 0) {
        sendSSE(res, "> Extracting CBOR...\n", 'stdout');
        exec(`docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`, (err, stdout) => {
            if (err) {
                sendSSE(res, `> Error reading CBOR: ${err.message}\n`, 'compilation');
            } else {
                try {
                    const parsed  = JSON.parse(stdout);
                    const cborHex = parsed.cborHex || stdout;
                    sendSSE(res, cborHex, 'cbor');
                    sendSSE(res, "> CBOR generated successfully.\n", 'stdout');

                    // ── Save to cache if we have a hash ──
                    if (sourceHash) {
                        setCache(sourceHash, cborHex);
                        const stats = cacheStats();
                        sendSSE(res, `> Result saved to cache (${stats.entries} entries).\n`, 'stdout');
                        console.log(`[cache] Saved entry ${sourceHash.slice(0, 8)}… — ${stats.entries}/${stats.maxEntries} entries`);
                    }
                } catch (e) {
                    const raw = stdout.trim();
                    sendSSE(res, raw, 'cbor');
                    if (sourceHash) {
                        setCache(sourceHash, raw);
                        sendSSE(res, `> Result saved to cache.\n`, 'stdout');
                    }
                }
            }
            endSSE(res);
        });
    } else {
        sendSSE(res, `\n> Build failed (exit code ${exitCode}).\n`, 'compilation');
        endSSE(res);
    }
}

app.listen(PORT, () => {
    console.log(`Plutus IDE running on http://localhost:${PORT}`);
});