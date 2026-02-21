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

/**
 * Envoie des données au format Server-Sent Events avec un type
 * @param {Response} res - L'objet réponse Express
 * @param {string} data - Le contenu à envoyer
 * @param {string} type - 'compilation', 'stdout' ou 'cbor'
 */
function sendSSE(res, data, type = 'stdout') {
    res.write(`data: ${JSON.stringify({ type: type, output: data })}\n\n`);
}

function endSSE(res) {
    res.write('event: done\ndata: {}\n\n');
    res.end();
}

app.post('/run', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let { code } = req.body;
    const moduleName = extractModuleName(code)
    console.log("module name is ",moduleName);
    
    if (!code) {
        sendSSE(res, 'Error: No code provided.\n', 'compilation');
        return endSSE(res);
    }

    // Normalisation du module
    // if (!code.includes('module')) {
    //     code = "module UserCode where\n\n" + code;
    // } else {
    //     code = code.replace(/^module\s+[A-Z][A-Za-z0-9_.']*\s+where/m, 'module UserCode where');
    // }

    const jobId = uuidv4();
    const jobDir = path.join(TMP_DIR, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Écriture des fichiers
    fs.writeFileSync(path.join(jobDir, `${moduleName}.hs`), code);

    const wrapper = `
{-# LANGUAGE DataKinds #-}
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

    // Commande Docker unique pour la préparation et la compilation
    const dockerCmd = `
docker exec plutus-runner bash -lc "
  source /root/.nix-profile/etc/profile.d/nix.sh && \
  cp /app/jobs/${jobId}/${moduleName}.hs /app/code/wspace/lecture/${moduleName}.hs && \
  cp /app/jobs/${jobId}/Main.hs /app/code/wspace/lecture/Main.hs && \
  cd /app/code/wspace && \
  nix develop . --command cabal run alw-exe
"
`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 10 });

    // Capture des logs de compilation en temps réel
    child.stdout.on('data', (data) => {
        // Si la ligne contient le message de succès du wrapper, on peut aussi l'envoyer en stdout
        if (data.includes("Validator CBOR written")) {
            sendSSE(res, data, 'stdout');
        } else {
            sendSSE(res, data, 'compilation');
        }
    });

    child.stderr.on('data', (data) => {
        sendSSE(res, data, 'compilation');
    });

  
        child.on('close', (exitCode) => {
        console.log(`Compilation finie. Code: ${exitCode}`);

        if (exitCode === null || exitCode === 0) {
            // ÉTAPE 2 : Si succès, on récupère le CBOR via une commande séparée
            sendSSE(res, "Extraction du CBOR...\n", 'stdout');
            
            const readCborCmd = `docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`;

            exec(readCborCmd, (err, stdout) => {
                if (err) {
                    sendSSE(res, "Erreur lors de la lecture du fichier généré.\n", 'compilation');
                } else {
                    try {
                        // On tente de parser pour voir si c'est du JSON Plutus standard
                        const plutusJson = JSON.parse(stdout);
                        // On envoie seulement le Hex au panneau CBOR pour la propreté
                        sendSSE(res, plutusJson.cborHex || stdout, 'cbor');
                        sendSSE(res, "CBOR généré avec succès.\n", 'stdout');
                    } catch (e) {
                        // Si c'est pas du JSON, on envoie le brut
                        sendSSE(res, stdout, 'cbor');
                    }
                }
                cleanup(jobDir, jobId);
                endSSE(res);
            });
        } else {
            sendSSE(res, `\nErreur lors de la compilation (Code ${exitCode}). Vérifiez la syntaxe Haskell.\n`, 'compilation');
            cleanup(jobDir, jobId);
            endSSE(res);
        }
    });

    child.on('error', (err) => {
        sendSSE(res, `Fatal Error: ${err.message}\n`, 'compilation');
        endSSE(res);
    });

    // Nettoyage des fichiers temporaires
    function cleanup(dir, id) {
        try {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`[${id}] Workspace nettoyé.`);
        } catch (e) {
            console.error("Erreur cleanup:", e);
        }
    }

    req.on('close', () => {
        if (child) child.kill();
    });
});

app.listen(PORT, () => {
    console.log(`Architect Backend running on http://localhost:${PORT}`);
});