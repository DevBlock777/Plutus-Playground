//  COMPILATION
// ═══════════════════════════════════════════════════
document.getElementById('runFileBtn').onclick = () => {
    const code = window.editor.getValue()
    const vName = document.getElementById('validatorNameInput').value.trim();
    if (!code.includes("main ::")){
        alert("include")
     if (!vName) return notify("Please enter a validator name in the toolbar input field.", 'warn');
    }
   

    if (templateMode) {
        // Template mode: compile editor content directly (no file, no save)
        runCode({ code: window.editor.getValue(), validatorName: vName });
    } else if (selectedFileName) {
        runWorkspaceFile(selectedFilePath, selectedFileName);
    }
};

function runWorkspaceFile(fullPath, fileName) {
    const code = window.editor.getValue()
    const vName = document.getElementById('validatorNameInput').value.trim();
    if (!code.includes("main ::")){
        alert("include")
     if (!vName) return notify("Please enter a validator name in the toolbar input field.", 'warn');
    }
    // Always save current editor content before compiling
    // Pass fullPath (e.g. "contracts/Three.hs") so the backend finds the file
    fetch('/workspace/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: fullPath, content: window.editor.getValue() })
    }).then(() => runCode({ fileName: fullPath, validatorName: vName }));
}

async function runCode(body) {
    document.getElementById('runFileBtn').disabled = true;
    setStatus('Compiling...', '#f0a500');
    document.getElementById('logs').textContent = '';
    document.getElementById('std').textContent  = '';
    document.getElementById('cbor').textContent = '';
    _setValidatorAddr(null);

    if (window.editor && window.setGHCMarkers)
        monaco.editor.setModelMarkers(window.editor.getModel(), 'ghc', []);

    let hasError = false, fullLog = '', cborResult = null;

    try {
        const res = await fetch('/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        function processLines(b) {
            const lines = b.split('\n');
            const rem   = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const { type, output } = JSON.parse(line.slice(6));
                    if (type === 'compilation') {
                        switchTab('logs');
                        document.getElementById('logs').textContent += output;
                        document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
                        fullLog += output;
                        if (/^.*error:/.test(output) || output.includes('Build failed')) hasError = true;
                    } else if (type === 'cbor') {
                        cborResult = output;
                        document.getElementById('cbor').textContent = output;
                        switchTab('cbor');
                    } else if (type === 'download') {
                        const btn = document.getElementById('downloadBtn');
                        btn.dataset.url = output;
                        btn.disabled = false;
                    } else if (type === 'files') {
                        // Multi-file output (quand main() génère plusieurs .plutus)
                        try {
                            const { files } = JSON.parse(output);
                            if (files && files.length > 1) showMultiFilePanel(files);
                        } catch (_) {}
                    } else {
                        document.getElementById('std').textContent += output;
                        document.getElementById('std').scrollTop = document.getElementById('std').scrollHeight;
                    }
                } catch (_) {}
            }
            return rem;
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                if (buf.trim()) processLines(buf + '\n');
                if (window.setGHCMarkers) window.setGHCMarkers(fullLog);
                break;
            }
            buf += decoder.decode(value, { stream: true });
            buf  = processLines(buf);
        }

        // ── Derive validator address from CBOR once stream is done ──
        if (cborResult && !hasError) {
            const addr = _computeValidatorAddr(cborResult);
            _setValidatorAddr(addr);
        }

        setStatus(hasError ? 'Build failed' : 'Success ✓', hasError ? '#f87171' : '#34d399');

    } catch (e) {
        document.getElementById('logs').textContent += `\nNetwork error: ${e.message}`;
        setStatus('Network error', '#f87171');
    }
    document.getElementById('runFileBtn').disabled = !selectedFileName?.endsWith('.hs');
}

// ═══════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
//  PANEL TABS (right column)
// ═══════════════════════════════════════════════════
function switchTab(name) {
    document.querySelectorAll('.ptab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel-body').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    // Auto-switch to GHC tab when compilation starts
    if (name === 'logs') document.getElementById('logs').scrollTop = document.getElementById('logs').scrollHeight;
    // Enable AI input when switching to AI tab
    if (name === 'ai' && window.onAITabShown) window.onAITabShown();
}
function setStatus(msg, color) {
    document.getElementById('statusEl').textContent = msg;
    document.getElementById('statusEl').style.color = color;
}
function copyPanel(id) {
    const el   = document.getElementById(id);
    const text = el.textContent.trim();
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        // Inject flash overlay if not already present
        let flash = el.querySelector('.copy-flash');
        if (!flash) {
            flash = document.createElement('div');
            flash.className = 'copy-flash';
            flash.textContent = 'Copied ✓';
            // Panel must be position:relative — set it
            el.style.position = 'relative';
            el.appendChild(flash);
        }

        // Force reflow so transition fires cleanly
        flash.classList.remove('hide');
        flash.classList.add('show');

        clearTimeout(el._copyTimer);
        el._copyTimer = setTimeout(() => {
            flash.classList.remove('show');
            flash.classList.add('hide');
        }, 900);
    });
}

// Keep legacy name in case called from elsewhere
function copyCBOR() { copyPanel('cbor'); }

// ═══════════════════════════════════════════════════
//  TEMPLATES  (Outcome #69787)
// ═══════════════════════════════════════════════════

// Snapshot of the file that was open before loading a template
let _preTemplateSnapshot = null;

async function loadTemplates() {
    try {
        const res  = await fetch('/templates');
        if (!res.ok) return;
        const list = await res.json();
        const sel  = document.getElementById('templateSelect');
        list.forEach(t => {
            const opt = document.createElement('option');
            opt.value       = t.id;
            opt.textContent = t.name;
            opt.title       = t.description;
            sel.appendChild(opt);
        });

        sel.addEventListener('change', async () => {
            const id = sel.value;
            if (!id) {
                // User selected "Templates…" → restore previous file if any
                _restorePreTemplateFile();
                return;
            }

            const r = await fetch(`/templates/${id}`);
            if (!r.ok) return;
            const t = await r.json();

            // Save a snapshot of the current editor state BEFORE overwriting
            // Only save once (don't overwrite snapshot if already in template mode)
            if (!templateMode) {
                _preTemplateSnapshot = {
                    content:       window.editor ? window.editor.getValue() : '',
                    filePath:      selectedFilePath,
                    fileName:      selectedFileName,
                    validatorName: document.getElementById('validatorNameInput').value,
                    activeLabel:   document.getElementById('activeFile').textContent,
                };
            }

            // Enter template mode
            templateMode = true;
            if (window.editor) window.editor.setValue(t.source);
            document.getElementById('validatorNameInput').value = t.validatorFn || '';
            document.getElementById('runFileBtn').disabled = false;
            document.getElementById('activeFile').textContent = `[template: ${t.name}]`;
            document.getElementById('activeFile').style.color = '#fbbf24';
            setStatus('Template loaded — compile without saving', '#fbbf24');
            notify(`Template "${t.name}" loaded.\nCompile directly or open a file to go back.`, 'info', 4000);
        });
    } catch (_) {}
}

function _restorePreTemplateFile() {
    if (!_preTemplateSnapshot) {
        // No snapshot — just exit template mode
        templateMode = false;
        document.getElementById('activeFile').textContent = '';
        document.getElementById('activeFile').style.color = '#a78bfa';
        document.getElementById('runFileBtn').disabled = !selectedFileName?.endsWith('.hs');
        return;
    }

    const snap = _preTemplateSnapshot;
    _preTemplateSnapshot = null;
    templateMode = false;

    if (window.editor) window.editor.setValue(snap.content);
    document.getElementById('validatorNameInput').value = snap.validatorName || '';
    document.getElementById('activeFile').textContent   = snap.activeLabel || '';
    document.getElementById('activeFile').style.color   = '#a78bfa';
    document.getElementById('runFileBtn').disabled      = !snap.fileName?.endsWith('.hs');
    setStatus('', '');
}

// ═══════════════════════════════════════════════════
//  ARTIFACT DOWNLOAD  (Outcome #69788 / #69789)
// ═══════════════════════════════════════════════════
document.getElementById('downloadBtn').addEventListener('click', () => {
    const url = document.getElementById('downloadBtn').dataset.url;
    if (!url) return;
    const a = document.createElement('a');
    a.href     = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// ═══════════════════════════════════════════════════
//  MULTI-FILE DOWNLOAD PANEL
//  Affiché quand main() génère plusieurs .plutus
// ═══════════════════════════════════════════════════
function showMultiFilePanel(files) {
    const old = document.getElementById('multiFilesPanel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id        = 'multiFilesPanel';
    panel.className = 'multi-files-panel';
    panel.innerHTML =
        `<div class="multi-files-title">📦 Fichiers générés (${files.length})</div>` +
        files.map(f =>
            `<a class="multi-file-link"
                href="/job/${f.jobId}/file/${encodeURIComponent(f.name)}"
                download="${f.name}">⬇ ${f.name}</a>`
        ).join('');

    const cborPanel = document.getElementById('tab-cbor');
    if (cborPanel) cborPanel.appendChild(panel);
    switchTab('cbor');
}

// ═══════════════════════════════════════════════════
//  VERSION BADGE  (Outcome #69789)
// ═══════════════════════════════════════════════════
async function fetchAndShowVersion() {
    try {
        const r    = await fetch('/version');
        const data = await r.json();
        const badge = document.getElementById('versionBadge');
        const ghcShort = (data.ghc || 'GHC').replace('The Glorious Glasgow Haskell Compilation System, version ', 'GHC ');
        badge.textContent = ghcShort;
        badge.title       = [data.ghc, data.cabal, data.nix].filter(Boolean).join('\n');
    } catch (_) {}
}

function showVersions() {
    const badge = document.getElementById('versionBadge');
    notify(badge.title || 'Version info not available', 'info', 6000);
}

// ═══════════════════════════════════════════════════
//  INIT: load templates + version on page load
// ═══════════════════════════════════════════════════
window.addEventListener('load', () => {
    loadTemplates();
    fetchAndShowVersion();
    // Reset download btn + multi-file panel on every new compile start
    const origRunFileBtn = document.getElementById('runFileBtn');
    origRunFileBtn.addEventListener('click', () => {
        const btn = document.getElementById('downloadBtn');
        btn.disabled    = true;
        btn.dataset.url = '';
        const old = document.getElementById('multiFilesPanel');
        if (old) old.remove();
    }, true);
});