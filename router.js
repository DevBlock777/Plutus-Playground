import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { endSSE, sendSSE } from './utils.js';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DIR = path.resolve(__dirname, 'workspaces');
const WSPACE_LECTURE = "/app/code/wspace"; // Racine du workspace dans Docker

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Sert l'interface
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Lister le contenu d'un dossier spécifique
router.get('/workspace/files', (req, res) => {
    const subPath = req.query.path || ""; 
    // On sécurise le chemin pour éviter de remonter trop haut dans le serveur
    const targetDir = path.join(WSPACE_LECTURE, subPath).replace(/\\/g, '/');

    const cmd = `docker exec plutus-runner ls -p "${targetDir}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.json([]);
        const items = stdout.split('\n')
            .filter(line => line.trim() !== '' && !line.includes('dist-newstyle'))
            .map(name => ({
                name: name.replace('/', ''),
                isDirectory: name.endsWith('/'),
                // Le chemin complet pour pouvoir l'ouvrir plus tard
                fullPath: path.join(subPath, name.replace('/', '')).replace(/\\/g, '/')
            }));
        res.json(items);
    });
});

/// 2. Lire un fichier (Correction pour accepter les chemins avec des "/")
// Route fixe sans paramètre dynamique dans l'URL
router.get('/workspace/file', (req, res) => {
    // On récupère le chemin depuis le paramètre ?name=...
    const fileName = req.query.name;

    if (!fileName) {
        return res.status(400).send("Paramètre 'name' manquant");
    }

    // Reconstruction du chemin
    const filePath = path.join(WSPACE_LECTURE, fileName).replace(/\\/g, '/');
    
    console.log(`[READ] Lecture simplifiée de : ${filePath}`);

    const cmd = `docker exec plutus-runner cat "${filePath}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.status(404).send("Fichier introuvable dans le conteneur");
        res.send(stdout);
    });
});

// 3. Sauvegarder (Correction pour s'assurer que le nom inclut le chemin relatif)
router.post('/workspace/save', (req, res) => {
    const { name, content } = req.body;
    // On extrait juste le nom de fichier pour le stockage temporaire local
    const baseName = path.basename(name);
    const tmpPath = path.join(TMP_DIR, baseName);
    
    fs.writeFileSync(tmpPath, content);
    
    // On copie vers le chemin complet dans Docker
    const cmd = `docker cp "${tmpPath}" plutus-runner:${WSPACE_LECTURE}/${name}`;
    exec(cmd, (err) => {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        if (err) return res.status(500).send(err.message);
        res.send("OK");
    });
});

// 4. Exécuter (Run)
router.post('/run', (req, res) => {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).send("No file");
    
    const moduleName = fileName.replace('.hs', '');
    const jobId = uuidv4();
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();

    const wrapper = `
{-# LANGUAGE DataKinds #-}
module Main where
import Utilities (writeValidatorToFile)
import qualified ${moduleName}
main :: IO ()
main = do
  writeValidatorToFile "./assets/${jobId}output.plutus" ${moduleName}.validatorScript
  putStrLn "Validator CBOR written successfully."`;

    const tmpWrapper = path.join(TMP_DIR, `Main_${jobId}.hs`);
    fs.writeFileSync(tmpWrapper, wrapper);

    const dockerCmd = `docker cp "${tmpWrapper}" plutus-runner:${WSPACE_LECTURE}/Main.hs && \
docker exec plutus-runner bash -lc "source /root/.nix-profile/etc/profile.d/nix.sh && cd /app/code/wspace && nix develop . --command cabal run alw-exe"`;

    const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 50 });

    child.stdout.on('data', (data) => sendSSE(res, data, data.includes("written") ? 'stdout' : 'compilation'));
    child.stderr.on('data', (data) => sendSSE(res, data, 'compilation'));

    child.on('close', (code) => {
        if (fs.existsSync(tmpWrapper)) fs.unlinkSync(tmpWrapper);
        if (code === 0 || code === null) {
            exec(`docker exec plutus-runner cat /app/code/wspace/assets/${jobId}output.plutus`, (err, stdout) => {
                try {
                    const json = JSON.parse(stdout);
                    sendSSE(res, json.cborHex || stdout, 'cbor');
                } catch(e) { sendSSE(res, stdout, 'cbor'); }
                endSSE(res);
            });
        } else {
            sendSSE(res, `\nExit Code: ${code}`, 'compilation');
            endSSE(res);
        }
    });
});

export default router;