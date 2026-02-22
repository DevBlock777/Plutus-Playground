//  SIDEBAR
// ═══════════════════════════════════════════════════
async function refreshFiles() {
    try {
        const r = await fetch(`/workspace/files?path=${encodeURIComponent(currentSidebarPath)}`);
        if (r.redirected || r.status === 401) return window.location.href = '/login';
        const items = await r.json();

        document.getElementById('sidebarPath').textContent =
            `~/${currentUsername}${currentSidebarPath ? '/' + currentSidebarPath : ''}`;

        items.filter(i => i.isDirectory).forEach(i => {
            if (!allDirs.includes(i.fullPath)) allDirs.push(i.fullPath);
        });

        const sorted = [...items].sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        let html = '';
        if (currentSidebarPath !== '')
            html += `<div class="file-item back" onclick="sidebarGoBack()">📁 ..</div>`;
        if (sorted.length === 0)
            html += `<div style="padding:14px 12px;font-size:11px;color:#444;font-style:italic;">No files — click ＋ to create one</div>`;

        sorted.forEach(item => {
            const icon = item.isDirectory ? '📁' : (item.name.endsWith('.hs') ? 'λ' : '📄');
            const sp   = item.fullPath.replace(/'/g, "\\'");
            const sn   = item.name.replace(/'/g, "\\'");
            const act  = item.isDirectory ? `sidebarNavigate('${sp}')` : `selectFile('${sp}','${sn}')`;
            const cBtn = (!item.isDirectory && item.name.endsWith('.hs'))
                ? `<span class="compile-ico" onclick="event.stopPropagation();runWorkspaceFile('${sp}','${sn}')" title="Compile">▶</span>`
                : '';
            const delBtn = `<div class="file-actions">
                <button class="file-act-btn" onclick="event.stopPropagation();openDeleteModal('${sp}','${sn}',${item.isDirectory})" title="Delete">🗑</button>
            </div>`;
            html += `<div class="file-item ${item.isDirectory?'is-dir':''} ${item.fullPath===selectedFilePath?'active':''}" onclick="${act}">
                <div class="file-item-label">${icon} ${item.name}</div>${cBtn}${delBtn}
            </div>`;
        });
        document.getElementById('fileList').innerHTML = html;
    } catch (e) {
        document.getElementById('fileList').innerHTML =
            `<div style="padding:10px;color:#f44;font-size:11px;">Connection error</div>`;
    }
}

function sidebarNavigate(fp) {
    currentSidebarPath = fp;
    sessionStorage.setItem(NAV_PATH_KEY, fp);
    refreshFiles();
}
function sidebarGoBack() {
    const parts = currentSidebarPath.split('/').filter(Boolean);
    parts.pop();
    currentSidebarPath = parts.join('/');
    sessionStorage.setItem(NAV_PATH_KEY, currentSidebarPath);
    refreshFiles();
}

async function selectFile(fullPath, fileName) {
    try {
        const r = await fetch(`/workspace/file?name=${encodeURIComponent(fullPath)}`);
        if (!r.ok) throw new Error(await r.text());
        window.editor.setValue(await r.text());
        const ext = fileName.split('.').pop().toLowerCase();
        monaco.editor.setModelLanguage(window.editor.getModel(),
            { hs:'haskell', json:'json', md:'markdown' }[ext] || 'plaintext');
        monaco.editor.setModelMarkers(window.editor.getModel(), 'ghc', []);
        selectedFilePath = fullPath;
        selectedFileName = fileName;
        sessionStorage.setItem(SEL_FILE_KEY, fullPath);
        sessionStorage.setItem(SEL_NAME_KEY, fileName);

        // Exit template mode — file takes over
        if (templateMode) {
            templateMode = false;
            _preTemplateSnapshot = null;
            document.getElementById('activeFile').style.color = '#a78bfa';
            document.getElementById('templateSelect').value = '';
        }

        document.getElementById('activeFile').textContent = '> ' + fileName;
        document.getElementById('runFileBtn').disabled = !fileName.endsWith('.hs');
        refreshFiles();
    } catch (e) { notify('Error opening file: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════
//  SAVE
// ═══════════════════════════════════════════════════
document.getElementById('saveBtn').onclick = async () => {
    if (!selectedFilePath) return notify("No file selected. Click a file in the sidebar first.", 'warn');
    const r = await fetch('/workspace/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: selectedFilePath, content: window.editor.getValue() })
    });
    if (r.ok) { setStatus('Saved ✓', '#34d399'); setTimeout(() => setStatus('', '#888'), 2000); }
    else setStatus('Save error', '#f87171');
};

// ═══════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════
document.getElementById('newFileBtn').onclick = () => openModal('file');

// ── Modal type state ──
let _modalType = 'file';

function setModalType(type) {
    _modalType = type;
    document.getElementById('toggleFile').classList.toggle('active',   type === 'file');
    document.getElementById('toggleFolder').classList.toggle('active', type === 'folder');
    document.getElementById('modalTitle').textContent     = type === 'file' ? '+ New file' : '+ New folder';
    document.getElementById('modalNameLabel').textContent = type === 'file' ? 'File name'  : 'Folder name';
    document.getElementById('modalConfirmBtn').textContent = type === 'file' ? 'Create file' : 'Create folder';
    document.getElementById('modalHint').textContent = type === 'file'
        ? 'Must start with uppercase, end with .hs'
        : 'Lowercase letters, numbers and hyphens only';
    document.getElementById('modalName').placeholder = type === 'file' ? 'ex: MyValidator.hs' : 'ex: contracts';
    document.getElementById('modalName').value = '';
}

function openModal(type = 'file') {
    const sel = document.getElementById('modalDir');
    sel.innerHTML = `<option value="">/ (root)</option>`;
    allDirs.forEach(d => { sel.innerHTML += `<option value="${d}" ${d === currentSidebarPath ? 'selected' : ''}>${d}/</option>`; });
    sel.value = currentSidebarPath || '';
    setModalType(type);
    document.getElementById('modalOverlay').classList.add('open');
    setTimeout(() => document.getElementById('modalName').focus(), 100);
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
document.getElementById('modalOverlay').onclick = e => { if (e.target.id === 'modalOverlay') closeModal(); };

async function confirmCreate() {
    const dir  = document.getElementById('modalDir').value;
    const name = document.getElementById('modalName').value.trim();

    if (_modalType === 'folder') {
        if (!name) return notify("Enter a folder name", 'warn');
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) return notify("Folder: letters, numbers, - and _ only", 'warn');
        const fp = dir ? `${dir}/${name}` : name;
        const r = await fetch('/workspace/mkdir', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dirPath: fp })
        });
        if (!r.ok) return notify('Error creating folder: ' + await r.text(), 'error');
        allDirs.push(fp);
        closeModal();
        currentSidebarPath = fp;
        sessionStorage.setItem(NAV_PATH_KEY, fp);
        await refreshFiles();
        notify(`Folder "${name}" created`, 'ok', 3000);
    } else {
        if (!name) return notify("Enter a file name", 'warn');
        if (!name.endsWith('.hs')) return notify("The file must end with .hs", 'warn');
        if (!/^[A-Z]/.test(name)) return notify("The name must start with an uppercase letter (Haskell convention)", 'warn');
        const mod  = name.replace('.hs', '');
        const fp   = dir ? `${dir}/${name}` : name;
        const content = `{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module ${mod} where

import qualified PlutusTx
import PlutusTx.Prelude
import Plutus.V2.Ledger.Api

{-# INLINABLE mkValidator #-}
mkValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
mkValidator _ _ _ = ()
`;
        const r = await fetch('/workspace/create', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: fp, content })
        });
        if (!r.ok) return notify('Error creating file: ' + await r.text(), 'error');
        closeModal();
        currentSidebarPath = dir;
        sessionStorage.setItem(NAV_PATH_KEY, dir);
        await refreshFiles();
        await selectFile(fp, name);
    }
}

document.getElementById('modalName').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmCreate();
    if (e.key === 'Escape') closeModal();
});

// ── Delete modal ──
let _deleteTarget = null;

function openDeleteModal(fullPath, name, isDir) {
    _deleteTarget = { fullPath, name, isDir };
    document.getElementById('deleteMsg').textContent =
        `Are you sure you want to delete ${isDir ? 'folder' : 'file'} "${name}"?` +
        (isDir ? '\n\nThis will delete all files inside.' : '');
    document.getElementById('deleteOverlay').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('deleteOverlay').classList.remove('open');
    _deleteTarget = null;
}
document.getElementById('deleteOverlay').onclick = e => { if (e.target.id === 'deleteOverlay') closeDeleteModal(); };

async function confirmDelete() {
    if (!_deleteTarget) return;
    const { fullPath, name, isDir } = _deleteTarget;
    closeDeleteModal();

    const r = await fetch('/workspace/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemPath: fullPath, isDirectory: isDir })
    });

    if (!r.ok) return notify('Delete failed: ' + await r.text(), 'error');

    // If the deleted file was open, clear editor
    if (!isDir && selectedFilePath === fullPath) {
        selectedFilePath = null;
        selectedFileName = null;
        sessionStorage.removeItem(SEL_FILE_KEY);
        sessionStorage.removeItem(SEL_NAME_KEY);
        if (window.editor) window.editor.setValue('-- Select or create a file in the sidebar\n');
        document.getElementById('activeFile').textContent = '';
        document.getElementById('runFileBtn').disabled = true;
    }
    // If deleted folder was the current nav path, go back to root
    if (isDir && currentSidebarPath.startsWith(fullPath)) {
        currentSidebarPath = '';
        sessionStorage.setItem(NAV_PATH_KEY, '');
    }
    allDirs = allDirs.filter(d => !d.startsWith(fullPath));
    await refreshFiles();
    notify(`"${name}" deleted`, 'ok', 3000);
}
