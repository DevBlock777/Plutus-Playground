import express, { json } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import session from 'express-session';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { v4 as uuidv4 } from 'uuid';
import { extractModuleName } from './utils.js';
import { registerRoutes, requireAuth } from './auth.js';
import { hashSource, getCache, setCache, cacheStats } from './cache.js';
import { connectRedis, sessionClient } from './redis.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Middleware ──
app.use(json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: false }));

// ── Sessions in Redis DB 0 ──
app.use(session({
    store: new RedisStore({ client: sessionClient }),
    name:   'plutus.sid',
    secret: process.env.SESSION_SECRET || 'plutus-session-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure:   false,
        maxAge:   7 * 24 * 60 * 60 * 1000
    }
}));

// ── Routes publiques ──
app.get('/', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/ide');
    res.redirect('/login');
});

registerRoutes(app);

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

function userWspace(userId) {
    return `/app/code/wspace/users/${userId}`;
}
function ensureUserDir(userId, cb) {
    exec(`docker exec plutus-runner mkdir -p "${userWspace(userId)}"`, cb);
}

// ══════════════════════════════════════════
//  WORKSPACE
// ══════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════
//  adjustGHCOutput — Corrige les numéros de ligne GHC
// ══════════════════════════════════════════════════════════
//
//  GHC output :
//    lecture/Main.hs:93:7: error:     →  Testt.hs:86:7: error:
//       |                                   |
//    93 | {-# INLINEABLE ammValidator  →  86 | {-# INLINEABLE ammValidator
//       |                                   |
//
function adjustGHCOutput(text, offset, displayFile) {
    if (!offset || offset <= 0) return text;

    let result = text;

    // 1. Remplacer le nom de fichier pour la lisibilité
    if (displayFile) {
        result = result.replace(/lecture\/Main\.hs/g, displayFile);
    }

    // 2. Ajuster les références "file.hs:LINE:COL:"
    result = result.replace(
        /(\S+\.hs:)(\d+)(:\d+:)/g,
        (_match, prefix, lineStr, suffix) => {
            const adjusted = Math.max(1, parseInt(lineStr) - offset);
            return `${prefix}${adjusted}${suffix}`;
        }
    );

    // 3. Ajuster le contexte source GHC : "  93 | code here"
    result = result.replace(
        /^(\s*)(\d+)(\s*\|)/gm,
        (_match, prefix, lineStr, suffix) => {
            const adjusted = Math.max(1, parseInt(lineStr) - offset);
            return `${prefix}${String(adjusted).padStart(lineStr.length)}${suffix}`;
        }
    );

    return result;
}

// ══════════════════════════════════════════════════════════
//  analyzeValidatorType — Détecte la signature du validateur
// ══════════════════════════════════════════════════════════
function analyzeValidatorType(sourceCode, validatorName) {
    const escaped = validatorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escaped}\\s*::(.+?)(?=\\n\\S|$)`, 'ms');
    const match = sourceCode.match(regex);

    const result = {
        isUntyped:   false,
        returnsBool: false,
        returnsUnit: false,
        found:       false
    };

    if (!match) {
        console.log(`[IDE] Type signature for "${validatorName}" not found — defaulting to typed+Bool`);
        result.returnsBool = true;
        return result;
    }

    result.found = true;
    const sig = match[1].replace(/\s+/g, ' ').trim();
    console.log(`[IDE] Parsed type signature: ${validatorName} :: ${sig}`);

    result.isUntyped = /(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*(?:\w+\.)?BuiltinData\s*->\s*\(\)/.test(sig);
    result.returnsBool = /->[\s]*Bool\s*$/.test(sig);
    result.returnsUnit = /->[\s]*\(\)\s*$/.test(sig);

    console.log(`[IDE] Analysis: isUntyped=${result.isUntyped} returnsBool=${result.returnsBool} returnsUnit=${result.returnsUnit}`);
    return result;
}

// ══════════════════════════════════════════════════════════
//  buildAugmentedSource — Fusionne le code user en Main.hs
//
//  Retourne { source: string, lineOffset: number }
//  lineOffset = nombre de lignes injectées AVANT le code user
// ══════════════════════════════════════════════════════════
function buildAugmentedSource(sourceCode, _moduleName, jobId, validatorName) {
    let src = sourceCode;
    let linesAddedBefore = 0;

    // ─── 0. Analyse du type ──────────────────────────
    const analysis = analyzeValidatorType(src, validatorName);

    // ─── 1. Pragmas requis ───────────────────────────
    const requiredPragmas = ['TemplateHaskell', 'DataKinds', 'NoImplicitPrelude'];
    const missing = requiredPragmas.filter(p => !src.includes(p));
    if (missing.length > 0) {
        const pragmaBlock = missing.map(p => `{-# LANGUAGE ${p} #-}`).join('\n');
        src = pragmaBlock + '\n' + src;
        linesAddedBefore += missing.length;
    }

    // ─── 2. Renommer module → Main ───────────────────
    const hadModule = /^module\s+/m.test(sourceCode);
    if (hadModule) {
        src = src.replace(
            /^module\s+\S+(\s*\([^)]*\))?\s+where/m,
            'module Main where'
        );
        // Remplacement in-place → pas de lignes ajoutées
    } else {
        const lines = src.split('\n');
        let idx = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('{-#') || lines[i].trim() === '') {
                idx = i + 1;
            } else break;
        }
        lines.splice(idx, 0, 'module Main where');
        src = lines.join('\n');
        linesAddedBefore += 1;
    }

    // ─── 3. IDE imports (qualifiés, aliases uniques) ─
    const ideImportLines = [
        '',
        '-- ── IDE auto-imports (do not edit) ──',
        'import qualified PlutusTx              as IDE_PlutusTx',
        'import qualified PlutusTx.Prelude      as IDE_PP',
        'import qualified Plutus.V2.Ledger.Api  as IDE_V2',
        'import           Utilities             (writeValidatorToFile)',
        'import           Prelude               (IO, putStrLn)',
        '-- ──────────────────────────────────────',
        ''
    ];
    const ideImportsText = ideImportLines.join('\n');

    // Insérer après "module Main where"
    // Le \n avant + les lignes du bloc
    const insertedText = '\n' + ideImportsText;
    const insertedNewlines = (insertedText.match(/\n/g) || []).length;
    linesAddedBefore += insertedNewlines;

    src = src.replace(
        /(module\s+Main\s+where)/,
        '$1' + insertedText
    );

    // ─── 4. Supprimer un éventuel main existant ─────
    //    (remplacement in-place, pas de changement de ligne)
    src = src.replace(/^main\s*::\s*IO\s*\(\)\s*$/gm, '-- [IDE removed] main :: IO ()');
    src = src.replace(/^main\s*=\s*.+$/gm,            '-- [IDE removed] main = …');

    // ─── 5. Bloc injecté (fin du fichier) ────────────
    //    N'affecte pas l'offset (ajouté APRÈS le code user)
    let block;

    if (analysis.isUntyped) {
        // CAS A : BuiltinData -> BuiltinData -> BuiltinData -> ()
        // → Compilation directe, pas de wrapper
        block = `

-- ══ Auto-injected by Plutus IDE (untyped validator) ══

_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript $$(IDE_PlutusTx.compile [|| ${validatorName} ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
-- ══ End ══
`;

    } else if (analysis.returnsBool) {
        // CAS B : … -> Bool
        // → Wrapper + unsafeFromBuiltinData + check
        block = `

-- ══ Auto-injected by Plutus IDE (typed validator -> Bool) ══

{-# INLINEABLE _ide_untypedValidator #-}
_ide_untypedValidator :: IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> ()
_ide_untypedValidator datum redeemer ctx =
  IDE_PP.check
    ( ${validatorName}
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
-- ══ End ══
`;

    } else {
        // CAS C : Types custom -> ()
        // → Wrapper + unsafeFromBuiltinData, SANS check
        block = `

-- ══ Auto-injected by Plutus IDE (typed validator -> ()) ══

{-# INLINEABLE _ide_untypedValidator #-}
_ide_untypedValidator :: IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> IDE_PlutusTx.BuiltinData -> ()
_ide_untypedValidator datum redeemer ctx =
  ${validatorName}
    (IDE_PlutusTx.unsafeFromBuiltinData datum)
    (IDE_PlutusTx.unsafeFromBuiltinData redeemer)
    (IDE_PlutusTx.unsafeFromBuiltinData ctx)

_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript $$(IDE_PlutusTx.compile [|| _ide_untypedValidator ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
-- ══ End ══
`;
    }

    src += block;

    console.log(`[IDE] lineOffset = ${linesAddedBefore} (${missing.length} pragmas + ${hadModule ? 0 : 1} module + ${insertedNewlines} imports)`);
    return { source: src, lineOffset: linesAddedBefore };
}

// ══════════════════════════════════════════
//  COMPILATION
// ══════════════════════════════════════════
app.post('/run', requireAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { code, fileName, validatorName } = req.body;
    const jobId = uuidv4();
    const userId = req.session.user.id;
    const userDir = userWspace(userId);

    // ── Helper SSE avec ajustement des lignes ──
    function sendCompilation(res, text, lineOffset, displayFile) {
        const adjusted = adjustGHCOutput(text, lineOffset, displayFile);
        sendSSE(res, adjusted, 'compilation');
    }

    // ────────────────────────────
    //  MODE FICHIER
    // ────────────────────────────
    if (fileName) {
        const moduleName = path.basename(fileName).replace('.hs', '');
        const sourceFile = `${userDir}/${fileName}`;
        const displayFile = path.basename(fileName);

        sendSSE(res, `> Compiling ${moduleName}...\n`, 'compilation');

        exec(`docker exec plutus-runner test -f "${sourceFile}" && echo "FOUND" || echo "MISSING"`, (err, out) => {
            if (out.trim() === 'MISSING') {
                sendSSE(res, `> ERROR: ${moduleName}.hs not found in workspace.\n`, 'compilation');
                return endSSE(res);
            }

            exec(`docker exec plutus-runner cat "${sourceFile}"`, { maxBuffer: 1024 * 1024 * 10 }, (err2, sourceCode) => {
                if (err2) {
                    sendSSE(res, `> ERROR: Could not read source file.\n`, 'compilation');
                    return endSSE(res);
                }

                (async () => {
                    // Cache check
                    const hash  = hashSource(sourceCode);
                    const entry = await getCache(hash);
                    if (entry) {
                        sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
                        sendSSE(res, `> CBOR retrieved from cache.\n`, 'stdout');
                        sendSSE(res, entry.cborHex, 'cbor');
                        const stats = await cacheStats();
                        sendSSE(res, `> Cache: ${stats.entries} entries (TTL ${stats.ttlDays}d).\n`, 'stdout');
                        return endSSE(res);
                    }

                    sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

                    const { source: augmented, lineOffset } = buildAugmentedSource(
                        sourceCode, moduleName, jobId, validatorName
                    );

                    const lectureDir = `/app/code/wspace/lecture`;
                    const tmpSrc     = path.join(TMP_DIR, `Main_${jobId}.hs`);
                    fs.writeFileSync(tmpSrc, augmented);

                    console.log(`[IDE] Generated Main.hs (offset=${lineOffset}) for ${displayFile}`);

                    const dockerCmd = `docker cp "${tmpSrc}" plutus-runner:${lectureDir}/Main.hs && \
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe 2>&1
"`;
                    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 50 });

                    child.stdout.on('data', (d) => {
                        if (d.includes('written successfully')) {
                            sendSSE(res, d, 'stdout');
                        } else {
                            sendCompilation(res, d, lineOffset, displayFile);
                        }
                    });
                    child.stderr.on('data', (d) => {
                        sendCompilation(res, d, lineOffset, displayFile);
                    });

                    child.on('close', (exitCode) => {
                        if (fs.existsSync(tmpSrc)) fs.unlinkSync(tmpSrc);
                        handleClose(res, exitCode, jobId, hash);
                    });
                    req.on('close', () => child.kill());
                })();
            });
        });
        return;
    }

    // ────────────────────────────
    //  MODE ÉDITEUR
    // ────────────────────────────
    if (!code) {
        sendSSE(res, 'Error: No code provided.\n', 'compilation');
        return endSSE(res);
    }

    const moduleName  = extractModuleName(code);
    const displayFile = `${moduleName}.hs`;

    // Cache check
    const hash  = hashSource(code);
    const entry = await getCache(hash);

    if (entry) {
        sendSSE(res, `> Cache hit — skipping compilation.\n`, 'compilation');
        sendSSE(res, `> CBOR retrieved from cache.\n`, 'stdout');
        sendSSE(res, entry.cborHex, 'cbor');
        const stats = await cacheStats();
        sendSSE(res, `> Cache: ${stats.entries} entries (TTL ${stats.ttlDays}d).\n`, 'stdout');
        return endSSE(res);
    }

    sendSSE(res, `> Cache miss — starting GHC...\n`, 'compilation');

    const { source: augmented, lineOffset } = buildAugmentedSource(
        code, moduleName, jobId, validatorName
    );

    const jobDir = path.join(TMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'Main.hs'), augmented);

    console.log(`[IDE] Generated Main.hs (offset=${lineOffset}) for editor mode`);

    sendSSE(res, `[${jobId}] Initializing...\n`, 'compilation');

    const dockerCmd = `
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cp /app/jobs/${jobId}/Main.hs /app/code/wspace/lecture/Main.hs && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe
"`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 10 });

    child.stdout.on('data', (d) => {
        if (d.includes('Validator CBOR written')) {
            sendSSE(res, d, 'stdout');
        } else {
            sendCompilation(res, d, lineOffset, displayFile);
        }
    });
    child.stderr.on('data', (d) => {
        sendCompilation(res, d, lineOffset, displayFile);
    });

    child.on('close', (exitCode) => {
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {}
        handleClose(res, exitCode, jobId, hash);
    });
    child.on('error', (err) => {
        sendSSE(res, `Fatal Error: ${err.message}\n`, 'compilation');
        endSSE(res);
    });
    req.on('close', () => child.kill());
});

function handleClose(res, exitCode, jobId, sourceHash = null) {
    if (exitCode === null || exitCode === 0) {
        sendSSE(res, "> Extracting CBOR...\n", 'stdout');
        exec(`docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`, async (err, stdout) => {
            if (err) {
                sendSSE(res, `> Error reading CBOR: ${err.message}\n`, 'compilation');
            } else {
                try {
                    const parsed  = JSON.parse(stdout);
                    const cborHex = parsed.cborHex || stdout.trim();
                    sendSSE(res, cborHex, 'cbor');
                    sendSSE(res, "> CBOR generated successfully.\n", 'stdout');
                    if (sourceHash) {
                        await setCache(sourceHash, cborHex);
                        const stats = await cacheStats();
                        sendSSE(res, `> Result saved to cache (${stats.entries} entries, TTL ${stats.ttlDays}d).\n`, 'stdout');
                        console.log(`[cache] Saved ${sourceHash.slice(0, 8)}… — ${stats.entries} entries`);
                    }
                } catch (e) {
                    const raw = stdout.trim();
                    sendSSE(res, raw, 'cbor');
                    if (sourceHash) {
                        await setCache(sourceHash, raw);
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

// ── Bootstrap ──
connectRedis()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Plutus IDE running on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('[Fatal] Could not connect to Redis:', err.message);
        process.exit(1);
    });