// ════════════════════════════════════════════════════════════════
//  PLUTUS TERMINAL
// ════════════════════════════════════════════════════════════════
(function () {
    const $out = () => document.getElementById('termOutput');
    const $inp = () => document.getElementById('termInput');
    let _hist = [], _histIdx = -1, _histDraft = '';

    function termPrint(text, cls = 'term-stdout') {
        const out = $out();
        String(text).split('\n').forEach(l => {
            const s = document.createElement('span');
            s.className = `term-line ${cls}`;
            s.textContent = l;
            out.appendChild(s);
        });
        out.scrollTop = out.scrollHeight;
    }
    const termInfo    = t => termPrint(t, 'term-info');
    const termSuccess = t => termPrint(t, 'term-success');
    const termError   = t => termPrint(t, 'term-error');
    const termWarn    = t => termPrint(t, 'term-warn');
    const termMuted   = t => termPrint(t, 'term-muted');
    const termCmd     = t => termPrint(t, 'term-cmd');

    window.termClear = () => { $out().innerHTML = ''; termMuted('Terminal cleared.'); };

    function termSpinner(label) {
        const out = $out(), wrap = document.createElement('span');
        wrap.className = 'term-line term-info';
        const sp = document.createElement('span'); sp.className = 'term-spinner';
        wrap.appendChild(sp); wrap.appendChild(document.createTextNode(label));
        out.appendChild(wrap); out.scrollTop = out.scrollHeight;
        return wrap;
    }

    function termBanner() {
        termInfo('┌────────────────────────────────────┐');
        termInfo('│  ⬡  PLUTUS IDE  —  Terminal         │');
        termInfo('└────────────────────────────────────┘');
        termInfo("  Type  help  for available commands.");
        termMuted('');
    }

    async function _termRun(body) {
        const runBtn = document.getElementById('runFileBtn');
        if (runBtn) runBtn.disabled = true;
        ['logs','std','cbor'].forEach(id => document.getElementById(id).textContent = '');
        const spinEl = termSpinner('GHC compiling…');
        let hasError = false, fullLog = '', cborResult = null;
        try {
            const res = await fetch('/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
            const reader = res.body.getReader(), decoder = new TextDecoder();
            let buf = '';
            function processLines(b) {
                const lines = b.split('\n'), rem = lines.pop();
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const { type, output } = JSON.parse(line.slice(6));
                        if (type === 'compilation') {
                            switchTab('logs');
                            document.getElementById('logs').textContent += output;
                            document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
                            fullLog += output;
                            const isErr = /^.*error:/.test(output) || output.includes('Build failed');
                            const isOk  = output.includes('written successfully') || output.includes('Cache hit');
                            if (isErr) { hasError = true; termError(output.trimEnd()); }
                            else if (isOk) termSuccess(output.trimEnd());
                            else if (output.trim()) termPrint(output.trimEnd(), 'term-stdout');
                        } else if (type === 'cbor') {
                            cborResult = output;
                            document.getElementById('cbor').textContent = output;
                            switchTab('cbor');
                            termMuted(''); termSuccess('✓ CBOR:');
                            termPrint(output.slice(0,80) + (output.length > 80 ? '…' : ''), 'term-cbor');
                        } else if (type === 'download') {
                            const btn = document.getElementById('downloadBtn');
                            if (btn) { btn.dataset.url = output; btn.disabled = false; }
                            termSuccess('✓ Artifact ready → ⬇ .plutus');
                        } else if (output.trim()) {
                            document.getElementById('std').textContent += output;
                            document.getElementById('std').scrollTop = document.getElementById('std').scrollHeight;
                            termPrint(output.trimEnd(), 'term-stdout');
                        }
                    } catch(_) {}
                }
                return rem;
            }
            while (true) {
                const { done, value } = await reader.read();
                if (done) { if (buf.trim()) processLines(buf+'\n'); if (window.setGHCMarkers) window.setGHCMarkers(fullLog); break; }
                buf += decoder.decode(value, {stream:true}); buf = processLines(buf);
            }
            if (cborResult && !hasError && window._computeValidatorAddr) {
                const addr = window._computeValidatorAddr(cborResult);
                if (window._setValidatorAddr) window._setValidatorAddr(addr);
            }
        } catch(e) { document.getElementById('logs').textContent += `\nNetwork error: ${e.message}`; termError(`Network error: ${e.message}`); hasError = true; }
        spinEl.remove(); termMuted('');
        if (hasError) termError('✗ Build failed — see GHC tab.');
        else if (cborResult) termSuccess('✓ Build succeeded!');
        termMuted('');
        if (runBtn) runBtn.disabled = !window.selectedFileName?.endsWith('.hs');
    }


    const COMMANDS = {
        help() {
            termInfo('Commands:');
            termPrint('  compile <validator> [file.hs]', 'term-info');
            termPrint('  run  (alias for compile)',      'term-info');
            termPrint('  set validator <name>',          'term-info');
            termPrint('  status · file · clear · help',  'term-info');
            termMuted('');
            termMuted('Examples:');
            termCmd('  compile myValidator');
            termCmd('  compile myValidator contracts/Main.hs');
            termCmd('  set validator alwaysSucceeds');
        },
        clear() { window.termClear(); },
        status() {
            const v = document.getElementById('validatorNameInput')?.value?.trim() || '(none)';
            termInfo('Status:');
            termPrint(`  File      : ${window.selectedFileName || '(none)'}`, 'term-stdout');
            termPrint(`  Path      : ${window.selectedFilePath || '(none)'}`, 'term-stdout');
            termPrint(`  Validator : ${v || '(not set)'}`, 'term-stdout');
        },
        file() { termPrint(`  ${window.selectedFilePath || '(no file selected)'}`, 'term-stdout'); },
        set(args) {
            if (args[0] !== 'validator') return termError(`Unknown: "${args[0]}". Try: set validator <n>`);
            const name = args.slice(1).join(' ').trim();
            if (!name) return termError('Usage: set validator <name>');
            const inp = document.getElementById('validatorNameInput');
            if (!inp) return termError('Input not found.');
            inp.value = name;
            termSuccess(`✓ Validator → "${name}"`);
        },
        run(args) { COMMANDS.compile(args); },
        compile(args) {
            // Syntaxes supportées :
            //   compile <path.hs>              → chemin seul, validator depuis toolbar ou défaut mkValidator
            //   compile <validator> <path.hs>  → forme classique
            //   compile <validator>            → fichier actif dans l'éditeur
            //   compile                        → fichier actif + validator toolbar
            let vName = null, filePath = null;

            if (args.length === 0) {
                filePath = window.selectedFilePath || null;
                vName    = document.getElementById('validatorNameInput')?.value?.trim() || '';
            } else if (args.length === 1) {
                const arg = args[0];
                if (arg.endsWith('.hs') || arg.includes('/')) {
                    filePath = arg;
                    vName    = document.getElementById('validatorNameInput')?.value?.trim() || '';
                    if (!vName) {
                        vName = 'mkValidator';
                        termWarn('Validator par défaut : "mkValidator"');
                        termWarn("  Utilisez 'set validator <nom>' pour le changer.");
                    }
                } else {
                    vName    = arg;
                    filePath = window.selectedFilePath || null;
                }
            } else {
                vName    = args[0];
                filePath = args.slice(1).join(' ');
            }

            if (!vName) {
                termError('Validator requis.');
                termWarn('  compile Second_workspace/AMM.hs');
                termWarn("  set validator monValidator  →  puis compile");
                return;
            }
            if (!filePath) {
                termError('Aucun fichier actif. Précisez le chemin :');
                termWarn('  compile Second_workspace/AMM.hs');
                return;
            }
            if (!filePath.endsWith('.hs')) {
                termError('"' + filePath.split('/').pop() + '" n\'est pas un fichier Haskell (.hs)');
                return;
            }

            const vInp = document.getElementById('validatorNameInput');
            if (vInp) vInp.value = vName;

            termCmd('$ compile ' + vName + '  →  ' + filePath); termMuted('');
            const code = window.editor?.getValue() ?? null;
            const isActive = filePath === window.selectedFilePath;
            if (isActive && code !== null) {
                const spinEl = termSpinner('Sauvegarde de ' + filePath.split('/').pop() + '…');
                fetch('/workspace/save', { method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({filePath, content:code}) })
                .then(() => { spinEl.remove(); _termRun({ fileName: filePath, validatorName: vName }); })
                .catch(err => { spinEl.remove(); termWarn('Save: ' + err.message); _termRun({ fileName: filePath, validatorName: vName }); });
            } else {
                _termRun({ fileName: filePath, validatorName: vName });
            }
        },
    };

    function handleInput(raw) {
        const line = raw.trim();
        termPrint(`plutus ❯ ${line}`, 'term-cmd');
        if (!line) return;
        _hist.unshift(line); if (_hist.length > 100) _hist.pop();
        _histIdx = -1; _histDraft = '';
        const parts = line.split(/\s+/), cmd = parts[0].toLowerCase(), args = parts.slice(1);
        if (COMMANDS[cmd]) { try { COMMANDS[cmd](args); } catch(e) { termError(`Error: ${e.message}`); } }
        else { termError(`Unknown: "${cmd}"`); termWarn('  Type help for commands.'); }
        termMuted('');
    }

    // ── Cache des fichiers pour autocomplétion ─────────────────
    let _fileCache = [];
    async function _refreshFileCache() {
        try {
            const r = await fetch('/workspace/files?path=');
            if (!r.ok) return;
            const items = await r.json();
            _fileCache = items.map(i => i.fullPath || i.name);
            // Récursion 1 niveau (sous-dossiers)
            const dirs = items.filter(i => i.isDirectory);
            for (const d of dirs) {
                const r2 = await fetch('/workspace/files?path=' + encodeURIComponent(d.fullPath || d.name));
                if (r2.ok) {
                    const sub = await r2.json();
                    sub.forEach(s => _fileCache.push(s.fullPath || (d.name + '/' + s.name)));
                }
            }
        } catch(_) {}
    }

    function _tabComplete(val) {
        const parts = val.split(/\s+/);
        const cmd   = parts[0].toLowerCase();
        const last  = parts[parts.length - 1];

        // Autocomplétion de la commande (premier mot)
        if (parts.length === 1) {
            const match = Object.keys(COMMANDS).find(c => c.startsWith(cmd));
            return match ? match + ' ' : val;
        }

        // Autocomplétion de chemin .hs (après compile/run)
        if ((cmd === 'compile' || cmd === 'run') && last.length > 0) {
            const candidates = _fileCache.filter(f => f.endsWith('.hs') && f.startsWith(last));
            if (candidates.length === 1) {
                parts[parts.length - 1] = candidates[0];
                return parts.join(' ');
            } else if (candidates.length > 1) {
                // Afficher les options
                termMuted('');
                termInfo('Fichiers correspondants :');
                candidates.forEach(c => termPrint('  ' + c, 'term-cmd'));
                termMuted('');
                // Trouver le préfixe commun
                let prefix = candidates[0];
                for (const c of candidates) {
                    let i = 0;
                    while (i < prefix.length && i < c.length && prefix[i] === c[i]) i++;
                    prefix = prefix.slice(0, i);
                }
                if (prefix.length > last.length) {
                    parts[parts.length - 1] = prefix;
                    return parts.join(' ');
                }
            }
        }
        return val;
    }

    window.addEventListener('load', () => {
        termBanner();
        _refreshFileCache();
        const inp = $inp();
        if (!inp) return;
        inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const v = inp.value; inp.value = ''; handleInput(v);
                // Refresh cache après chaque commande (création/suppression possible)
                setTimeout(_refreshFileCache, 800);
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (_histIdx === -1) _histDraft = inp.value;
                if (_histIdx < _hist.length-1) { _histIdx++; inp.value = _hist[_histIdx]; setTimeout(() => inp.setSelectionRange(inp.value.length, inp.value.length), 0); }
            }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (_histIdx > 0) { _histIdx--; inp.value = _hist[_histIdx]; }
                else if (_histIdx === 0) { _histIdx = -1; inp.value = _histDraft; }
            }
            else if (e.key === 'Tab') {
                e.preventDefault();
                inp.value = _tabComplete(inp.value);
            }
            else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); window.termClear(); }
        });
        $out().addEventListener('click', () => inp.focus());
        setTimeout(() => inp.focus(), 400);
    });
})();