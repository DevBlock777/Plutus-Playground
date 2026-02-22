/**
 * auth.js — Authentication routes + middleware
 *
 * User storage: Redis DB 2 (replaces users.json)
 *   Key format:  user:by_id:{id}        → full user object (JSON)
 *               user:by_name:{username} → id string (for login lookup)
 *
 * Sessions: managed by express-session + connect-redis (DB 0), configured in server.js
 */

import bcrypt from 'bcrypt';
import path from 'path';
import { fileURLToPath } from 'url';
import { usersClient } from './redis.js';

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const SALT_ROUNDS = 10;

// ── Redis key helpers ─────────────────────────────

const keyById   = (id)       => `user:by_id:${id}`;
const keyByName = (username) => `user:by_name:${username.toLowerCase()}`;

// ── Internal helpers ──────────────────────────────

async function getUserById(id) {
    const raw = await usersClient.get(keyById(id));
    return raw ? JSON.parse(raw) : null;
}

async function getUserByUsername(username) {
    const id = await usersClient.get(keyByName(username));
    if (!id) return null;
    return getUserById(id);
}

async function saveUser(user) {
    await usersClient.set(keyById(user.id),              JSON.stringify(user));
    await usersClient.set(keyByName(user.username), user.id);
}

// ── Middleware ────────────────────────────────────

export function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.redirect('/login');
}

// ── Routes ────────────────────────────────────────

export function registerRoutes(app) {

    // Login page
    app.get('/login', (req, res) => {
        if (req.session && req.session.user) return res.redirect('/ide');
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    app.get('/register', (req, res) => {
        if (req.session && req.session.user) return res.redirect('/ide');
        res.sendFile(path.join(__dirname, 'login.html'));
    });

    // Register
    app.post('/auth/register', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password)
            return res.status(400).json({ error: 'Missing fields' });
        if (username.length < 3)
            return res.status(400).json({ error: 'Username too short (min 3 characters)' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password too short (min 6 characters)' });
        if (!/^[a-zA-Z0-9_]+$/.test(username))
            return res.status(400).json({ error: 'Username: letters, numbers and _ only' });

        const existing = await getUserByUsername(username);
        if (existing)
            return res.status(409).json({ error: 'Username already taken' });

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const newUser = {
            id:           `user_${Date.now()}`,
            username,
            passwordHash,
            createdAt:    new Date().toISOString(),
        };

        await saveUser(newUser);

        // Auto-login after registration
        req.session.user = { id: newUser.id, username: newUser.username };
        res.json({ ok: true, username: newUser.username });
    });

    // Login
    app.post('/auth/login', async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password)
            return res.status(400).json({ error: 'Missing fields' });

        const user = await getUserByUsername(username);
        if (!user)
            return res.status(401).json({ error: 'User not found' });

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid)
            return res.status(401).json({ error: 'Incorrect password' });

        req.session.user = { id: user.id, username: user.username };
        res.json({ ok: true, username: user.username });
    });

    // Logout
    app.post('/auth/logout', (req, res) => {
        req.session.destroy(() => {
            res.clearCookie('plutus.sid');
            res.json({ ok: true });
        });
    });

    // Current session info
    app.get('/auth/me', (req, res) => {
        if (!req.session || !req.session.user)
            return res.status(401).json({ error: 'Not logged in' });
        res.json({ id: req.session.user.id, username: req.session.user.username });
    });
}