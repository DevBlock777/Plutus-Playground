import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_FILE = path.join(__dirname, 'users.json');
const SALT_ROUNDS = 10;

// ── Helpers ──
export function readUsers() {
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function writeUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Middleware : redirige vers /login si pas de session ──
export function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
}

// ── Routes auth ──
export function registerRoutes(app) {

    // Page login (GET)
    app.get('/login', (req, res) => {
        if (req.session && req.session.user) return res.redirect('/ide');
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    // Page register (GET)
    app.get('/register', (req, res) => {
        if (req.session && req.session.user) return res.redirect('/ide');
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    // Inscription (POST)
    app.post('/auth/register', async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: 'Champs manquants' });
        if (username.length < 3)
            return res.status(400).json({ error: 'Username trop court (min 3 caractères)' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Mot de passe trop court (min 6 caractères)' });
        if (!/^[a-zA-Z0-9_]+$/.test(username))
            return res.status(400).json({ error: 'Username : lettres, chiffres et _ uniquement' });

        const users = readUsers();
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
            return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris' });

        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = {
            id: `user_${Date.now()}`,
            username,
            passwordHash: hash,
            createdAt: new Date().toISOString()
        };
        users.push(newUser);
        writeUsers(users);

        // Connexion automatique après inscription
        req.session.user = { id: newUser.id, username: newUser.username };
        res.json({ ok: true, username: newUser.username });
    });

    // Connexion (POST)
    app.post('/auth/login', async (req, res) => {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: 'Champs manquants' });

        const users = readUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user)
            return res.status(401).json({ error: 'Utilisateur introuvable' });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid)
            return res.status(401).json({ error: 'Mot de passe incorrect' });

        req.session.user = { id: user.id, username: user.username };
        res.json({ ok: true, username: user.username });
    });

    // Déconnexion (POST)
    app.post('/auth/logout', (req, res) => {
        req.session.destroy(() => {
            res.clearCookie('plutus.sid');
            res.json({ ok: true });
        });
    });

    // Infos session courante (utilisé par le frontend pour afficher le username)
    app.get('/auth/me', (req, res) => {
        if (!req.session || !req.session.user)
            return res.status(401).json({ error: 'Non connecté' });
        res.json({ id: req.session.user.id, username: req.session.user.username });
    });
}
