import express, { json } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { extractModuleName } from './utils.js';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(json());
app.use(cors({
    origin: '*',
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, './index.html'));
});

const TMP_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function sendSSE(res, data, type = 'stdout') {
    res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
}
function endSSE(res) {
    res.write('event: done\ndata: {}\n\n');
    res.end();
}

// ── Lister un dossier dans le container ──
app.get('/workspace/files', (req, res) => {
    const subPath = req.query.path || "";
    const targetDir = `/app/code/wspace${subPath ? '/' + subPath : ''}`;
    const cmd = `docker exec plutus-runner ls -p "${targetDir}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.json([]);
        const items = stdout.split('\n')
            .filter(line => line.trim() !== '')
            .map(name => ({
                name: name.replace(/\/$/, ''),
                isDirectory: name.endsWith('/'),
                fullPath: subPath ? `${subPath}/${name.replace(/\/$/, '')}` : name.replace(/\/$/, '')
            }));
        res.json(items);
    });
});

// ── Lire un fichier du container ──
app.get('/workspace/file', (req, res) => {
    const filePath = req.query.name;
    if (!filePath) return res.status(400).send("Paramètre 'name' manquant");
    const cmd = `docker exec plutus-runner cat "/app/code/wspace/${filePath}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.status(404).send("Fichier introuvable");
        res.send(stdout);
    });
});

// ── Créer un nouveau fichier dans le container ──
app.post('/workspace/create', (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("filePath manquant");

    const baseName = path.basename(filePath);
    const dirInContainer = `/app/code/wspace/${path.dirname(filePath)}`.replace(/\/\.$/, '');
    const tmpPath = path.join(TMP_DIR, `new_${uuidv4()}_${baseName}`);

    fs.writeFileSync(tmpPath, content || '');

    const cmd = `docker exec plutus-runner mkdir -p "${dirInContainer}" && docker cp "${tmpPath}" plutus-runner:"/app/code/wspace/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("Fichier créé");
    });
});

// ── Sauvegarder un fichier existant ──
app.post('/workspace/save', (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath) return res.status(400).send("filePath manquant");

    const baseName = path.basename(filePath);
    const tmpPath = path.join(TMP_DIR, `save_${uuidv4()}_${baseName}`);

    fs.writeFileSync(tmpPath, content || '');

    const cmd = `docker cp "${tmpPath}" plutus-runner:"/app/code/wspace/${filePath}"`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("Sauvegardé");
    });
});

// ── Compilation ──
app.post('/run', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { code, fileName } = req.body;
    const jobId = uuidv4();

    // ── MODE FICHIER ──
    if (fileName) {
        const moduleName = path.basename(fileName).replace('.hs', '');
        const lectureDir = `/app/code/wspace/lecture`;

        sendSSE(res, `> Compilation de ${moduleName}...\n`, 'compilation');

        // Étape 1 : vérifier que le fichier source est bien dans lecture/
        exec(`docker exec plutus-runner ls "${lectureDir}/"`, (err, lsOut) => {
            sendSSE(res, `> Contenu de lecture/ : ${lsOut.trim()}\n`, 'compilation');

            const sourceFile = `${lectureDir}/${moduleName}.hs`;
            const checkCmd = `docker exec plutus-runner test -f "${sourceFile}" && echo "FOUND" || echo "MISSING"`;

            exec(checkCmd, (err2, checkOut) => {
                const fileStatus = checkOut.trim();
                sendSSE(res, `> Fichier ${moduleName}.hs : ${fileStatus}\n`, 'compilation');

                if (fileStatus === 'MISSING') {
                    sendSSE(res, `\n> ERREUR : ${moduleName}.hs introuvable dans lecture/.\n> Vérifiez que le fichier a bien été créé via le bouton ＋.\n`, 'compilation');
                    return endSSE(res);
                }

                // Étape 2 : écrire le wrapper Main.hs
                const wrapper = `{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
module Main where
import Utilities (writeValidatorToFile)
import qualified ${moduleName}
main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" ${moduleName}.validatorScript
  putStrLn "Validator CBOR written successfully."
`;
                const tmpWrapper = path.join(TMP_DIR, `Main_${jobId}.hs`);
                fs.writeFileSync(tmpWrapper, wrapper);

                // Étape 3 : copier le wrapper et compiler
                const dockerCmd = `docker cp "${tmpWrapper}" plutus-runner:${lectureDir}/Main.hs && \
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe 2>&1
"`;

                sendSSE(res, `> Lancement de cabal...\n`, 'compilation');
                const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 50 });

                child.stdout.on('data', (d) => {
                    sendSSE(res, d, d.includes('written successfully') ? 'stdout' : 'compilation');
                });
                child.stderr.on('data', (d) => sendSSE(res, d, 'compilation'));

                child.on('close', (exitCode) => {
                    if (fs.existsSync(tmpWrapper)) fs.unlinkSync(tmpWrapper);
                    sendSSE(res, `> cabal terminé avec code ${exitCode}\n`, 'compilation');

                    // Vérifier ce qu'il y a dans assets/ pour le debug
                    exec(`docker exec plutus-runner ls /app/code/wspace/assets/ 2>&1`, (e, assetsOut) => {
                        sendSSE(res, `> Contenu assets/ : ${assetsOut.trim()}\n`, 'compilation');
                        handleClose(res, exitCode, jobId);
                    });
                });

                req.on('close', () => child.kill());
            });
        });
        return;
    }

    // ── MODE ÉDITEUR (original intact) ──
    if (!code) {
        sendSSE(res, 'Error: No code provided.\n', 'compilation');
        return endSSE(res);
    }

    const moduleName = extractModuleName(code);
    console.log("module name is", moduleName);

    const jobDir = path.join(TMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, `${moduleName}.hs`), code);

    const wrapper = `{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE OverloadedStrings #-}
module Main where
import Utilities (writeValidatorToFile)
import qualified ${moduleName}
main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" ${moduleName}.validatorScript
  putStrLn "Validator CBOR written successfully."
`;
    fs.writeFileSync(path.join(jobDir, 'Main.hs'), wrapper);
    sendSSE(res, `[${jobId}] Initialisation de l'environnement Docker...\n`, 'compilation');

    const dockerCmd = `
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cp /app/jobs/${jobId}/${moduleName}.hs /app/code/wspace/lecture/${moduleName}.hs && \
  cp /app/jobs/${jobId}/Main.hs /app/code/wspace/lecture/Main.hs && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe
"`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 10 });
    child.stdout.on('data', (d) => sendSSE(res, d, d.includes('Validator CBOR written') ? 'stdout' : 'compilation'));
    child.stderr.on('data', (d) => sendSSE(res, d, 'compilation'));
    child.on('close', (exitCode) => {
        try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (e) {}
        handleClose(res, exitCode, jobId);
    });
    child.on('error', (err) => { sendSSE(res, `Fatal Error: ${err.message}\n`, 'compilation'); endSSE(res); });
    req.on('close', () => child.kill());
});

// ── Lecture CBOR après compilation ──
function handleClose(res, exitCode, jobId) {
    if (exitCode === null || exitCode === 0) {
        sendSSE(res, "> Extraction du CBOR...\n", 'stdout');
        exec(`docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`, (err, stdout) => {
            if (err) {
                sendSSE(res, `> Erreur lecture CBOR : ${err.message}\n`, 'compilation');
            } else {
                try {
                    const json = JSON.parse(stdout);
                    sendSSE(res, json.cborHex || stdout, 'cbor');
                    sendSSE(res, "> CBOR généré avec succès.\n", 'stdout');
                } catch (e) {
                    sendSSE(res, stdout, 'cbor');
                }
            }
            endSSE(res);
        });
    } else {
        sendSSE(res, `\n> Échec compilation (Code ${exitCode}).\n`, 'compilation');
        endSSE(res);
    }
}

app.listen(PORT, () => {
    console.log(`Architect Backend running on http://localhost:${PORT}`);
});