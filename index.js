import express, { json } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(json());
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['Content-Type'],
}));


const TMP_DIR = path.join(__dirname, 'workspaces');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

function sendSSE(res, data) {

  res.write(`data: ${JSON.stringify({ output: data })}\n\n`);

}

function endSSE(res) {
  res.write('event: done\ndata: {}\n\n');
  res.end();
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, './index.html'));
});

app.post('/run', (req, res) => {
  // Headers SSE dès le début
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let { code } = req.body;

  if (!code) {
    sendSSE(res, 'Error: No code provided.\n');
    return endSSE(res);
  }

  // Renomme le module en Main
  code = code.replace(
    /^module\s+[A-Z][A-Za-z0-9_.']*\s+where/m,
    'module Main where'
  );

  if (!/^\s*main\s*::/m.test(code) && !/^\s*main\s*=/m.test(code)) {
  code += '\n\nmain :: IO ()\nmain = return ()\n';
}

  const jobId = uuidv4();
  const jobDir = path.join(TMP_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'Main.hs'), code);

  console.log(`[${jobId}] Starting compilation...`);
  sendSSE(res, `[${jobId}] Starting compilation...\n`);

  const dockerCmd = `
    docker exec plutus-runner \
    bash -lc "source /root/.nix-profile/etc/profile.d/nix.sh && \
              cp /app/jobs/${jobId}/Main.hs /app/code/wspace/lecture/Main.hs && \
              touch /app/code/wspace/lecture/Main.hs && \
              cd /app/code/wspace && \
              nix develop . --command cabal build alw-exe"
  `;

  const child = exec(dockerCmd, { maxBuffer: 1024 * 1024 * 10 });

  child.stdout.on('data', (data) => {
    console.log(`[${jobId}] stdout:`, data);
    sendSSE(res, data);
  });

  child.stderr.on('data', (data) => {
    console.log(`[${jobId}] stderr:`, data);
    sendSSE(res, data);
  });

  child.on('close', (exitCode) => {
    console.log(`[${jobId}] Done. Exit code: ${exitCode}`);
    // sendSSE(res, `\n[Done] Exit code: ${exitCode}\n`);
    endSSE(res);
  });

  child.on('error', (err) => {
    console.error(`[${jobId}] Process error:`, err.message);
    sendSSE(res, `Error: ${err.message}\n`);
    endSSE(res);
  });

  req.on('close', () => {
    console.log(`[${jobId}] Client disconnected — killing process`);
    child.kill();
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.setTimeout(900000);