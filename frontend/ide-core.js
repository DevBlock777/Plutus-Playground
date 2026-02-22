// ═══════════════════════════════════════════════════
//  TOAST NOTIFICATIONS  (replaces all alert())
// ═══════════════════════════════════════════════════
function notify(message, type = 'info', duration = 5000) {
    const icons  = { error:'⛔', warn:'⚠️', ok:'✓', info:'◈' };
    const titles = { error:'Error', warn:'Warning', ok:'Success', info:'Notice' };

    const toast = document.createElement('div');
    toast.className = `toast type-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || '◈'}</div>
        <div class="toast-body">
            <div class="toast-title">${titles[type] || type}</div>
            <div class="toast-msg">${message.replace(/\n/g, '<br>')}</div>
        </div>
        <button class="toast-close" onclick="dismissToast(this.parentElement)">×</button>
    `;

    const container = document.getElementById('toastContainer');
    container.appendChild(toast);

    if (duration > 0) {
        setTimeout(() => dismissToast(toast), duration);
    }
    return toast;
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('removing')) return;
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}
let currentSidebarPath = "";
let selectedFilePath   = null;
let selectedFileName   = null;
let currentUsername    = "";
let allDirs            = [];
let templateMode       = false;   // true = editor has template content, no file backing it

// Wallet state
let lucidInstance = null;
let walletAddress = null;

// sessionStorage key — persists across reloads but NOT across tab-close
const WALLET_KEY   = 'plutus_wallet_name';
const NAV_PATH_KEY = 'plutus_sidebar_path';   // current folder
const SEL_FILE_KEY = 'plutus_selected_file';  // selected file path
const SEL_NAME_KEY = 'plutus_selected_name';  // selected file name

// ═══════════════════════════════════════════════════
//  MONACO INIT
// ═══════════════════════════════════════════════════
require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.39.0/min/vs' }});
require(['vs/editor/editor.main'], function () {

    // ── Haskell tokenizer ──
    monaco.languages.register({ id: 'haskell' });
    monaco.languages.setMonarchTokensProvider('haskell', {
        defaultToken: '', tokenPostfix: '.hs',
        keywords: ['case','class','data','default','deriving','do','else','foreign',
            'if','import','in','infix','infixl','infixr','instance','let',
            'module','newtype','of','then','type','where','qualified','as',
            'hiding','forall','family','mdo','rec','proc'],
        typeKeywords: ['Bool','Char','Double','Float','Int','Integer','IO','String',
            'Maybe','Either','Ordering','Word','Void','Show','Eq','Ord',
            'Num','Enum','Bounded','Read','Functor','Monad','Applicative',
            'Foldable','Traversable','Semigroup','Monoid'],
        operators: ['=','->','<-','::','=>','..','|','\\','@','~',
            '+','-','*','/','<','>','<=','>=','==','/=',
            '&&','||','>>','>>=','<$>','<*>','<|>','$','.',':'],
        symbols:  /[=><!~?:&|+\-*\/\^%@#.\\]+/,
        escapes:  /\\(?:[nrtfb\\"'&]|[0-9]+|x[0-9a-fA-F]+|o[0-7]+)/,
        tokenizer: {
            root: [
                [/\{-#.*?#-\}/, 'keyword.pragma'],
                [/\{-/, 'comment', '@blockComment'],
                [/--.*$/, 'comment'],
                [/"/, 'string', '@string'],
                [/'[^\\']'/, 'string'],
                [/(')(@escapes)(')/, ['string','string.escape','string']],
                [/0[xX][0-9a-fA-F]+/, 'number.hex'],
                [/[0-9]+\.[0-9]+([eE][-+]?[0-9]+)?/, 'number.float'],
                [/[0-9]+/, 'number'],
                [/[A-Z][a-zA-Z0-9_']*/, { cases: { '@typeKeywords': 'type.keyword', '@default': 'type' } }],
                [/[a-z_][a-zA-Z0-9_']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
                [/@symbols/, { cases: { '@operators': 'operator', '@default': 'operator' } }],
                [/[{}()\[\]]/, 'delimiter'], [/[,;]/, 'delimiter'], [/\s+/, 'white'],
            ],
            blockComment: [
                [/[^{-]+/, 'comment'], [/\{-/, 'comment', '@push'],
                [/-\}/, 'comment', '@pop'], [/[{-]/, 'comment'],
            ],
            string: [
                [/[^\\"]+/, 'string'], [/@escapes/, 'string.escape'],
                [/\\./, 'string.escape.invalid'], [/"/, 'string', '@pop'],
            ],
        }
    });

    // ── Theme ──
    monaco.editor.defineTheme('haskell-dark', {
        base: 'vs-dark', inherit: true,
        rules: [
            { token: 'keyword',        foreground: 'c792ea', fontStyle: 'bold' },
            { token: 'keyword.pragma', foreground: '546e7a', fontStyle: 'italic' },
            { token: 'type',           foreground: 'ffcb6b' },
            { token: 'type.keyword',   foreground: 'ffcb6b', fontStyle: 'bold' },
            { token: 'comment',        foreground: '546e7a', fontStyle: 'italic' },
            { token: 'string',         foreground: 'c3e88d' },
            { token: 'string.escape',  foreground: '89ddff' },
            { token: 'number',         foreground: 'f78c6c' },
            { token: 'operator',       foreground: '89ddff' },
            { token: 'delimiter',      foreground: '89ddff' },
            { token: 'identifier',     foreground: 'eeffff' },
        ],
        colors: {
            'editor.background':                 '#1a1a24',
            'editor.foreground':                 '#eeffff',
            'editorLineNumber.foreground':       '#3a3a5c',
            'editorLineNumber.activeForeground': '#7c3aed',
            'editor.lineHighlightBackground':    '#1e1e30',
            'editorCursor.foreground':           '#c792ea',
            'editor.selectionBackground':        '#3a2d6a',
            'editorGutter.background':           '#16161f',
        }
    });

    window.editor = monaco.editor.create(document.getElementById('editor'), {
        value: "-- Select or create a file in the sidebar\n",
        language: 'haskell',
        theme: 'haskell-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: false },
        scrollbar: { vertical: 'visible' },
        renderLineHighlight: 'line',
        bracketPairColorization: { enabled: true },
    });

    // ── GHC markers ──
    window.setGHCMarkers = function(logText) {
        const model = window.editor.getModel();
        if (!model) return;
        const markers = [];
        const pat = /^.*?:(\d+):(\d+)(?:-\d+)?:\s*(error|warning):\s*([\s\S]*?)(?=\n\S|\n\n|$)/gm;
        let m;
        while ((m = pat.exec(logText)) !== null) {
            markers.push({
                startLineNumber: +m[1], startColumn: +m[2],
                endLineNumber:   +m[1], endColumn:   +m[2] + 1,
                message:  m[4].trim().replace(/\n\s+/g, ' '),
                severity: m[3] === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            });
        }
        monaco.editor.setModelMarkers(model, 'ghc', markers);
    };

    // ── Auth check, then auto-reconnect wallet ──
    fetch('/auth/me')
        .then(r => { if (!r.ok) return window.location.href = '/login'; return r.json(); })
        .then(async data => {
            if (!data) return;
            currentUsername = data.username;
            document.getElementById('userLabel').textContent  = data.username;
            document.getElementById('userAvatar').textContent = data.username[0].toUpperCase();

            // ── Restore navigation state from sessionStorage ──
            const savedPath = sessionStorage.getItem(NAV_PATH_KEY);
            const savedFile = sessionStorage.getItem(SEL_FILE_KEY);
            const savedName = sessionStorage.getItem(SEL_NAME_KEY);

            if (savedPath) currentSidebarPath = savedPath;
            await refreshFiles();

            // Re-open the previously selected file silently
            if (savedFile && savedName) {
                try {
                    const r = await fetch(`/workspace/file?name=${encodeURIComponent(savedFile)}`);
                    if (r.ok) {
                        window.editor.setValue(await r.text());
                        const ext = savedName.split('.').pop().toLowerCase();
                        monaco.editor.setModelLanguage(window.editor.getModel(),
                            { hs:'haskell', json:'json', md:'markdown' }[ext] || 'plaintext');
                        selectedFilePath = savedFile;
                        selectedFileName = savedName;
                        document.getElementById('activeFile').textContent = '> ' + savedName;
                        document.getElementById('runFileBtn').disabled = !savedName.endsWith('.hs');
                        refreshFiles(); // refresh to highlight active file
                    } else {
                        // File no longer exists — clear stale state
                        sessionStorage.removeItem(SEL_FILE_KEY);
                        sessionStorage.removeItem(SEL_NAME_KEY);
                    }
                } catch (_) {}
            }

            tryAutoReconnect();
        })
        .catch(() => window.location.href = '/login');
});

// ═══════════════════════════════════════════════════
//  WALLET
// ═══════════════════════════════════════════════════

/**
 * On reload, silently re-enable the previously used wallet.
 * Most wallets allow this without a user popup if the site is already approved.
 */
async function tryAutoReconnect() {
    const saved = sessionStorage.getItem(WALLET_KEY);
    if (!saved) return;
    try {
        await connectWallet(saved, /* silent */ true);
    } catch (_) {
        sessionStorage.removeItem(WALLET_KEY);
    }
}

/**
 * Connect (or re-connect silently) a Cardano wallet.
 * @param {string|null} name    - 'nami' | 'lace' | 'eternl' | null = auto-detect
 * @param {boolean}     silent  - suppress alerts (used for auto-reconnect on reload)
 */
async function connectWallet(name = null, silent = false) {
    // Wait for Lucid ES module to finish loading (it's async)
    if (!window._lucidReady) {
        await new Promise(resolve => window.addEventListener('lucid-ready', resolve, { once: true }));
    }

    if (!window.cardano) {
        if (!silent) notify("No Cardano wallet extension detected.\nPlease install Nami, Lace, or Eternl.", 'error');
        return;
    }

    // Auto-detect first available wallet
    if (!name) {
        if      (window.cardano.lace)   name = 'lace';
        else if (window.cardano.nami)   name = 'nami';
        else if (window.cardano.eternl) name = 'eternl';
        else {
            if (!silent) notify("No supported wallet found.\nPlease install Nami, Lace, or Eternl.", 'error');
            return;
        }
    }

    if (!window.cardano[name]) {
        if (!silent) notify(`Wallet "${name}" not found.`, 'error');
        sessionStorage.removeItem(WALLET_KEY);
        return;
    }

    try {
        const api = await window.cardano[name].enable();

        lucidInstance = await Lucid.new(
            new Blockfrost(
                "https://cardano-preprod.blockfrost.io/api/v0",
                "preprodYjRkHfcazNkL0xxG9C2RdUbUoTrG7wip"
            ),
            "Preprod"
        );
        lucidInstance.selectWallet(api);
        walletAddress = await lucidInstance.wallet.address();

        // Persist wallet name across reloads (sessionStorage: cleared on tab close)
        sessionStorage.setItem(WALLET_KEY, name);

        _updateWalletUI(walletAddress);

        // If CBOR already compiled, recompute validator address now
        const cbor = document.getElementById('cbor').textContent.trim();
        if (cbor) _setValidatorAddr(_computeValidatorAddr(cbor));

    } catch (e) {
        if (!silent) notify("Wallet connection failed:\n" + e.message, 'error');
        sessionStorage.removeItem(WALLET_KEY);
    }
}

function disconnectWallet() {
    lucidInstance = null;
    walletAddress = null;
    sessionStorage.removeItem(WALLET_KEY);

    const btn = document.getElementById('connectWalletBtn');
    btn.textContent = '⬡ Connect Wallet';
    btn.title = '';
    btn.classList.remove('connected');

    const el = document.getElementById('walletAddr');
    el.textContent = '— wallet not connected —';
    el.classList.add('empty');
    el.title = 'Connect wallet first';

    // Validator address also depends on network; clear it
    _setValidatorAddr(null);
}

function handleWalletBtn() {
    if (walletAddress) disconnectWallet();
    else connectWallet();
}

function _updateWalletUI(addr) {
    const short = addr.slice(0, 14) + '…' + addr.slice(-6);
    const btn   = document.getElementById('connectWalletBtn');
    btn.textContent = '✓ ' + short;
    btn.title = addr + '\n(click to disconnect)';
    btn.classList.add('connected');

    const el = document.getElementById('walletAddr');
    el.textContent = addr;
    el.classList.remove('empty');
    el.title = 'Click to copy';
}

function _computeValidatorAddr(cborHex) {
    if (!lucidInstance || !cborHex) return null;
    try {
        return lucidInstance.utils.validatorToAddress({ type: "PlutusV2", script: cborHex });
    } catch (e) {
        console.warn("Could not derive validator address:", e);
        return null;
    }
}

function _setValidatorAddr(addr) {
    const el = document.getElementById('validatorAddr');
    if (addr) {
        el.textContent = addr;
        el.classList.remove('empty');
        el.title = 'Click to copy';
    } else {
        el.textContent = lucidInstance
            ? '— compile to generate —'
            : '— connect wallet to compute —';
        el.classList.add('empty');
    }
}

function copyAddr(id) {
    const el   = document.getElementById(id);
    if (el.classList.contains('empty')) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
        const fb = document.getElementById('copyOk');
        fb.textContent = 'Copied ✓';
        setTimeout(() => { fb.textContent = ''; }, 1500);
    });
}

// ═══════════════════════════════════════════════════
//  AUTH LOGOUT
// ═══════════════════════════════════════════════════
async function logout() {
    sessionStorage.removeItem(WALLET_KEY);
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}

// ═══════════════════════════════════════════════════