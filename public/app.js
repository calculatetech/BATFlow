'use strict';

const DB_NAME = 'batflow-v1';
const STORE = 'projects';
const state = { project: { name: 'Untitled', files: {}, metadata: {} }, currentFile: null, parsed: null, selectedId: null, view: 'diagram', trace: [], traceStop: '', traceEnabled: true, simValues: { variables: {}, paths: {}, outcomes: {} } };
const $ = (id) => document.getElementById(id);

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'b-' + Math.random().toString(36).slice(2); }
function stableBlockId(path, line) { return `block:${encodeURIComponent(path)}:${line}`; }
function stableSectionId(path, line) { return `section:${encodeURIComponent(path)}:${line}`; }
function norm(s) { return s.trim().toLowerCase(); }
const DOS_BUILTINS = new Set(['echo','cls','pause','choice','copy','del','erase','deltree','ren','rename','format','label','sys','subst','restart','cd','chdir','md','mkdir','rd','rmdir','dir','type','ver','verify','vol','path','prompt','date','time','break','ctty','lh','loadhigh','lock','unlock','truename','exit','set','goto','call','if','rem']);
function commandToken(trimmed) {
  const commandText = trimmed.replace(/^@/, '');
  const rawToken = (commandText.match(/^\S+/) || [''])[0].toLowerCase();
  return /^echo(?:[.:;,=\/\[]|$)/i.test(rawToken) ? 'echo' : rawToken;
}
function isDirectBatchInvocation(trimmed, path) {
  const commandText = trimmed.replace(/^@/, '');
  const token = (commandText.match(/^\S+/) || [''])[0];
  if (!token || DOS_BUILTINS.has(commandToken(trimmed))) return false;
  return /\.bat$/i.test(token) || !!resolveBatchTarget(token, path);
}
function parseDosArgs(text) {
  const args = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) args.push(m[1] ?? m[2]);
  return args;
}
function resolveRenameDestination(source, destination) {
  if (!source || !destination) return '';
  if (/^[a-z]:\\|^[\\/]|[\\/]/i.test(destination)) return '';
  const idx = Math.max(source.lastIndexOf('\\'), source.lastIndexOf('/'));
  return idx >= 0 ? source.slice(0, idx + 1) + destination : destination;
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveProject() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(state.project, 'current');
  return new Promise(r => tx.oncomplete = r);
}
async function loadSavedProject() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get('current');
  return new Promise(resolve => { req.onsuccess = () => resolve(req.result || null); req.onerror = () => resolve(null); });
}

function parseBatch(text, path) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks = [];
  const labels = new Map();
  const sections = [];
  let section = { id: stableSectionId(path, 0), labels: [], labelBlocks: [], blocks: [] };
  sections.push(section);

  lines.forEach((raw, index) => {
    const blockId = stableBlockId(path, index);
    const trimmed = raw.trim();
    let kind = 'external', data = {}, title = 'Command';
    if (!trimmed) { kind = 'blank'; title = 'Blank line'; }
    else if (/^rem(?:\s|$)/i.test(trimmed) || /^::/.test(trimmed)) { kind = 'comment'; title = /^::/.test(trimmed) ? 'Pseudo-comment' : 'Comment'; }
    else if (/^:[^:]/.test(trimmed)) {
      kind = 'label'; title = 'Label'; data.label = trimmed.slice(1).trim();
      if (section.blocks.length || section.labels.length) { section = { id: stableSectionId(path, index), labels: [], labelBlocks: [], blocks: [] }; sections.push(section); }
      section.labels.push(data.label);
      section.labelBlocks.push(blockId);
      labels.set(norm(data.label), { line: index, sectionId: section.id, blockId });
    } else if (/^set\s+/i.test(trimmed)) {
      kind = 'set'; title = 'Set variable';
      const m = trimmed.match(/^set\s+([^=\s]+)=(.*)$/i); if (m) data = { name: m[1], value: m[2] };
    } else if (/^goto\s+/i.test(trimmed)) {
      kind = 'goto'; title = 'Jump'; data.target = trimmed.replace(/^goto\s+/i, '').trim();
    } else if (/^call\s+/i.test(trimmed)) {
      kind = 'call'; title = 'Call batch'; data.target = trimmed.replace(/^call\s+/i, '').trim(); data.returns = true;
    } else if (isDirectBatchInvocation(trimmed, path)) {
      kind = 'batch-transfer'; title = 'Run batch (no return)';
      const commandText = trimmed.replace(/^@/, '');
      data.target = (commandText.match(/^\S+/) || [''])[0];
      data.args = commandText.slice(data.target.length).trim(); data.returns = false;
    } else if (/^if\s+/i.test(trimmed)) {
      kind = 'if'; title = 'Condition'; data = parseIf(trimmed);
    } else if (trimmed.includes('|')) {
      kind = 'pipeline'; title = 'Pipeline'; data.stages = splitPipeline(trimmed);
    } else {
      const commandText = trimmed.replace(/^@/, '');
      const rawToken = (commandText.match(/^\S+/) || [''])[0].toLowerCase();
      // COMMAND.COM accepts ECHO., ECHO:, ECHO; and similar forms as ECHO.
      const first = commandToken(trimmed);
      const known = {
        echo: 'Echo', cls: 'Clear screen', pause: 'Pause', choice: 'Choice', copy: 'Copy', del: 'Delete', erase: 'Delete', deltree: 'Delete tree', ren: 'Rename', rename: 'Rename', format: 'Format', label: 'Set volume label', sys: 'Make bootable', subst: 'Substitute drive', restart: 'Restart',
        cd: 'Change directory', chdir: 'Change directory', md: 'Make directory', mkdir: 'Make directory', rd: 'Remove directory', rmdir: 'Remove directory', dir: 'Directory listing', type: 'Display file', ver: 'DOS version', verify: 'Verify writes', vol: 'Volume label', path: 'Set path', prompt: 'Set prompt', date: 'Set date', time: 'Set time', break: 'Break handling', ctty: 'Change terminal', lh: 'Load high', loadhigh: 'Load high', lock: 'Lock drive', unlock: 'Unlock drive', truename: 'Resolve path', exit: 'Exit interpreter'
      };
      if (known[first]) {
        kind = 'command';
        title = known[first];
      } else {
        kind = 'external';
        title = `External: ${rawToken || 'command'}`;
      }
      data.command = first;
      data.rawCommandToken = rawToken;
      if (first === 'echo') data.echoMode = /^echo[.:;,=\/\[]/i.test(rawToken) ? 'blank-line-form' : 'normal';
      if (first === 'ren' || first === 'rename') {
        const args = parseDosArgs(commandText.slice(rawToken.length).trim());
        data.source = args[0] || '';
        data.destination = args[1] || '';
        data.resolvedDestination = resolveRenameDestination(data.source, data.destination);
        data.destinationHasPath = !!data.destination && !data.resolvedDestination;
      }
    }
    const block = { id: blockId, line: index, raw, kind, title, data };
    blocks.push(block);
    if (kind !== 'label') section.blocks.push(block);
  });

  const configInfo = getProjectConfigInfo();
  const variables = findVariables(text);
  if (configInfo && variables.some(v => norm(v.name) === 'config')) {
    const configVar = variables.find(v => norm(v.name) === 'config');
    for (const value of configInfo.menuItems) if (!configVar.values.includes(value)) configVar.values.push(value);
  }
  return { path, text, lines, blocks, labels, sections, variables, paths: findExistPaths(text), validations: validate(blocks, labels, configInfo), configInfo };
}

function splitPipeline(s) { return s.split('|').map(x => x.trim()); }
function parseIf(s) {
  let rest = s.replace(/^if\s+/i, '');
  let negated = false;
  if (/^not\s+/i.test(rest)) { negated = true; rest = rest.replace(/^not\s+/i, ''); }
  let m = rest.match(/^exist\s+(\S+)\s+(.+)$/i);
  if (m) return { type: 'exist', negated, operand: m[1], action: m[2] };
  m = rest.match(/^errorlevel\s+(\d+)\s+(.+)$/i);
  if (m) return { type: 'errorlevel', negated, level: Number(m[1]), action: m[2] };
  m = rest.match(/^(.+?)==(.+?)\s+(.+)$/i);
  if (m) return { type: 'compare', negated, left: m[1], right: m[2], action: m[3] };
  return { type: 'raw', negated, expression: rest };
}
function findVariables(text) {
  const found = new Map();
  for (const m of text.matchAll(/%([^%]+)%/g)) if (!/^\d$/.test(m[1])) found.set(norm(m[1]), { name: m[1], values: new Set() });
  for (const m of text.matchAll(/if\s+%([^%]+)%==([^\s]+)|if\s+([^\s=]+)==%([^%]+)%/ig)) {
    const name = m[1] || m[4], value = m[2] || m[3]; if (name && found.has(norm(name))) found.get(norm(name)).values.add(value);
  }
  return [...found.values()].map(v => ({ name: v.name, values: [...v.values] }));
}
function findExistPaths(text) {
  const set = new Set(); for (const m of text.matchAll(/if\s+(?:not\s+)?exist\s+([^\s]+)/ig)) set.add(m[1]); return [...set];
}

function parseConfigSys(text, path) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const sections = new Map();
  let current = '';
  const menuItems = [];
  let menuDefault = '';
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const sm = trimmed.match(/^\[([^\]]+)\]$/);
    if (sm) { current = norm(sm[1]); if (!sections.has(current)) sections.set(current, { name: sm[1], line: index, lines: [] }); return; }
    if (!sections.has(current)) sections.set(current, { name: current || 'GLOBAL', line: 0, lines: [] });
    sections.get(current).lines.push({ raw, line: index });
    if (current === 'menu') {
      const mi = trimmed.match(/^menuitem\s*=\s*([^,\s]+)(?:\s*,.*)?$/i);
      if (mi && !menuItems.some(x => norm(x) === norm(mi[1]))) menuItems.push(mi[1]);
      const md = trimmed.match(/^menudefault\s*=\s*([^,\s]+)/i);
      if (md) menuDefault = md[1];
    }
  });
  return { path, sections, menuItems, menuDefault };
}
function getProjectConfigInfo() {
  const path = Object.keys(state.project.files).find(p => /(^|\/)config\.sys$/i.test(p));
  return path ? parseConfigSys(state.project.files[path].content, path) : null;
}
function nextMeaningfulBlock(blocks, startIndex) {
  for (let i = startIndex; i < blocks.length; i++) {
    if (!['blank', 'comment', 'label'].includes(blocks[i].kind)) return blocks[i];
  }
  return null;
}
function outcomeAffectsFlow(blocks, index) {
  const next = nextMeaningfulBlock(blocks, index + 1);
  return Boolean(next && next.kind === 'if' && next.data.type === 'errorlevel');
}
function externalOutcomeBlocks(blocks) {
  return blocks.filter((b, i) => (b.kind === 'external' || b.kind === 'pipeline') && outcomeAffectsFlow(blocks, i));
}

function cleanBatchReference(target) {
  return String(target || '').trim().replace(/^"|"$/g, '').split(/\s+/)[0];
}
function normalizeProjectPath(path) {
  const parts=[];
  for (const part of String(path||'').replace(/\\/g,'/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/').toLowerCase();
}
function resolveBatchTarget(target, callerPath = state.currentFile) {
  let ref=cleanBatchReference(target);
  if (!ref || /%[^%]+%/.test(ref)) return null;
  const files=Object.keys(state.project.files || {});
  const callerDir=String(callerPath||'').replace(/\\/g,'/').split('/').slice(0,-1).join('/');
  const candidates=[];
  const hasExt=/\.[^/\\]+$/.test(ref);
  const refs=hasExt?[ref]:[ref,`${ref}.BAT`];
  for (const r of refs) {
    const rr=r.replace(/\\/g,'/');
    if (/^[a-z]:\//i.test(rr) || rr.startsWith('/')) candidates.push(rr.replace(/^[a-z]:\//i,''));
    else { if(callerDir) candidates.push(`${callerDir}/${rr}`); candidates.push(rr); }
  }
  for (const c of candidates) {
    const n=normalizeProjectPath(c);
    const hit=files.find(f=>normalizeProjectPath(f)===n);
    if(hit && /\.bat$/i.test(hit)) return hit;
  }
  const base=normalizeProjectPath(ref).split('/').pop().toLowerCase();
  const baseWithExt=/\.bat$/i.test(base)?base:`${base}.bat`;
  const matches=files.filter(f=>normalizeProjectPath(f).split('/').pop().toLowerCase()===baseWithExt);
  return matches.length===1?matches[0]:null;
}
function openProjectFile(path, line = 0) {
  if (!path || !state.project.files[path]) return;
  state.currentFile=path; state.selectedId=null; render();
  requestAnimationFrame(()=>{ const b=state.parsed?.blocks.find(x=>x.line>=line && x.kind!=='blank'); if(b) selectBlock(b.id,{instant:true}); });
}
function validate(blocks, labels, configInfo = null) {
  const out = [];
  const declared = new Map();
  for (const b of blocks) if (b.kind === 'label') {
    const k = norm(b.data.label); if (declared.has(k)) out.push({ severity: 'error', message: `Duplicate label :${b.data.label}`, blockId: b.id }); else declared.set(k, b);
  }
  for (const b of blocks) {
    if (b.kind === 'goto' && !b.data.target.includes('%') && !labels.has(norm(b.data.target.replace(/^:/,'')))) out.push({ severity: 'error', message: `Unresolved GOTO ${b.data.target}`, blockId: b.id });
    if ((b.kind === 'call' || b.kind === 'batch-transfer') && !/%[^%]+%/.test(b.data.target || '') && !resolveBatchTarget(b.data.target, state.currentFile)) out.push({ severity: 'warn', message: `Unresolved batch file ${b.data.target}`, blockId: b.id });
    if (b.kind === 'if' && b.data.type === 'compare' && /%[^%]+%/.test(b.raw) && !/["']%[^%]+%["']/.test(b.raw)) out.push({ severity: 'warn', message: 'Unquoted variable comparison may become malformed when empty.', blockId: b.id });
    if (/goto\s+:?eof/i.test(b.raw)) out.push({ severity: 'error', message: 'GOTO :EOF is not supported by Win98 COMMAND.COM.', blockId: b.id });
    if (/\b(?:set\s+\/a|if\s+\/i|for\s+\/f|%~[a-z0-9])/i.test(b.raw)) out.push({ severity: 'error', message: 'NT CMD.EXE syntax detected.', blockId: b.id });
    if (/^::/.test(b.raw.trim())) out.push({ severity: 'warn', message: ':: is a pseudo-comment, not the documented REM command.', blockId: b.id });
    if (b.kind === 'goto' && /%config%/i.test(b.data.target || '')) {
      if (!configInfo) out.push({ severity: 'warn', message: 'Dynamic GOTO %config% cannot be validated until CONFIG.SYS is loaded.', blockId: b.id });
      else {
        for (const item of configInfo.menuItems) if (!labels.has(norm(item))) out.push({ severity: 'error', message: `CONFIG.SYS menu item ${item} has no matching :${item} label.`, blockId: b.id });
        if (!configInfo.menuItems.length) out.push({ severity: 'warn', message: 'CONFIG.SYS contains no [MENU] MENUITEM values for %config%.', blockId: b.id });
      }
    }
  }
  return out;
}

function render() {
  renderFiles();
  if (!state.currentFile || !state.project.files[state.currentFile]) { $('diagramView').innerHTML = '<p>No file loaded.</p>'; return; }
  state.parsed = parseBatch(state.project.files[state.currentFile].content, state.currentFile);
  $('sourceView').value = state.project.files[state.currentFile].content;
  renderDiagram(); renderSimulationInputs(); renderLabels(); renderValidation(); renderTraceView(); updateStatus(); applyView();
}
function renderFiles() {
  $('fileList').innerHTML = Object.keys(state.project.files).map(path => `<div class="file-item ${path===state.currentFile?'active':''}" data-file="${escapeHtml(path)}">${escapeHtml(path)}</div>`).join('') || '<div class="trace-summary">No files imported.</div>';
  document.querySelectorAll('.file-item').forEach(el => el.onclick = () => { state.currentFile = el.dataset.file; state.selectedId = null; render(); });
}
function renderDiagram() {
  const traced = new Set(state.trace.map(t => t.blockId));
  $('diagramView').innerHTML = state.parsed.sections.map(sec => {
    const labels = sec.labels.length ? sec.labels.map((l, i) => `<button class="label-badge ${state.selectedId===sec.labelBlocks[i]?'selected':''}" data-label="${escapeAttr(l)}" data-block="${escapeAttr(sec.labelBlocks[i])}">:${escapeHtml(l)}</button>`).join('') : `<button class="label-badge" data-label="__entry">ENTRY</button>`;
    const blocks = sec.blocks.filter(b => b.kind !== 'blank').map(b => blockHtml(b, traced.has(b.id))).join('');
    return `<section class="section-group" data-section-id="${escapeAttr(sec.id)}"><div class="section-title">${labels}</div><div class="flow-column">${blocks || '<div class="trace-summary">Empty section / fall-through</div>'}</div></section>`;
  }).join('');
  document.querySelectorAll('.block').forEach(el => el.onclick = () => selectBlock(el.dataset.id));
  document.querySelectorAll('.label-badge').forEach(el => el.onclick = (e) => { e.stopPropagation(); jumpToLabel(el.dataset.label); });
  document.querySelectorAll('[data-jump-label]').forEach(el => el.onclick = (e) => { e.stopPropagation(); jumpToLabel(el.dataset.jumpLabel); });
  document.querySelectorAll('[data-jump-line]').forEach(el => el.onclick = (e) => { e.stopPropagation(); jumpToLine(Number(el.dataset.jumpLine)); });
  document.querySelectorAll('[data-open-file]').forEach(el => el.onclick = (e) => { e.stopPropagation(); openProjectFile(el.dataset.openFile); });
}
function blockHtml(b, traced) {
  const d = b.data;
  let meta = `Line ${b.line + 1}`;
  let branches = '';
  if (b.kind === 'if') {
    const desc = d.type === 'exist' ? `${d.negated?'does not exist':'exists'}: ${d.operand}` : d.type === 'errorlevel' ? `${d.negated?'not ':''}ERRORLEVEL ≥ ${d.level}` : d.type === 'compare' ? `${d.left} ${d.negated?'!=':'=='} ${d.right}` : d.expression;
    meta += ` · ${escapeHtml(desc)}`;
    const gm = (d.action || '').match(/^goto\s+(.+)$/i);
    const trueJump = gm ? `data-jump-label="${escapeAttr(gm[1].replace(/^:/,''))}"` : `data-jump-line="${b.line + 2}"`;
    branches = `<div class="branch-row"><button class="branch-yes" ${trueJump}>TRUE → ${escapeHtml(d.action || 'branch')}</button><button class="branch-no" data-jump-line="${b.line + 2}">FALSE → line ${b.line + 2}</button></div>`;
  }
  if (b.kind === 'goto') {
    const resolvedTarget = expand(d.target || '', state.simValues.variables || {}).replace(/^:/,'');
    const unresolved = /%[^%]+%/.test(resolvedTarget);
    const hasTarget = !unresolved && state.parsed.labels.has(norm(resolvedTarget));
    meta += ` · target ${escapeHtml(d.target)}${d.target !== resolvedTarget ? ` → :${escapeHtml(resolvedTarget)}` : ''}`;
    branches = `<div class="branch-row single"><button class="branch-jump" ${hasTarget ? `data-jump-label="${escapeAttr(resolvedTarget)}"` : 'disabled title="Set simulation inputs or add the destination label to resolve this jump"'}>JUMP → ${escapeHtml(unresolved ? d.target : ':' + resolvedTarget)}</button></div>`;
  }
  if (b.kind === 'call' || b.kind === 'batch-transfer') {
    const targetPath = resolveBatchTarget(d.target, state.currentFile);
    meta += ` · ${b.kind === 'call' ? 'returns to next line' : 'replaces current batch'}${targetPath ? ` · ${escapeHtml(targetPath)}` : ' · unresolved file'}`;
    branches = `<div class="branch-row single"><button class="branch-jump" ${targetPath ? `data-open-file="${escapeAttr(targetPath)}"` : 'disabled'}>${b.kind === 'call' ? 'OPEN CALLED FILE' : 'OPEN TRANSFER TARGET'} → ${escapeHtml(d.target)}</button></div>`;
  }
  const blockIndex = state.parsed.blocks.findIndex(x => x.id === b.id);
  const needsOutcome = outcomeAffectsFlow(state.parsed.blocks, blockIndex);
  if (b.kind === 'pipeline') meta += ` · ${d.stages.length} stages${needsOutcome ? ' · ERRORLEVEL affects flow' : ''}`;
  if (b.kind === 'external' && needsOutcome) meta += ` · ERRORLEVEL affects flow`;
  if (b.kind === 'command' && (d.command === 'ren' || d.command === 'rename')) {
    meta += ` · source ${escapeHtml(d.source || '(missing)')} · new name ${escapeHtml(d.destination || '(missing)')}`;
    if (d.resolvedDestination) meta += ` · result ${escapeHtml(d.resolvedDestination)}`;
    else if (d.destinationHasPath) meta += ` · invalid: REN destination cannot contain a path`;
  }
  return `<article class="block kind-${b.kind} ${state.selectedId===b.id?'selected':''} ${traced?'traced':''}" data-id="${b.id}"><div class="block-title"><span>${escapeHtml(b.title)}</span><span>${b.kind}</span></div><div class="block-code">${escapeHtml(b.raw)}</div><div class="block-meta">${meta}</div>${branches}</article>`;
}
function scrollDiagramTarget(target, options = {}) {
  if (!target) return;
  const scroller = $('diagramView');
  const targetRect = target.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const desiredTop = scroller.scrollTop + targetRect.top - scrollerRect.top - 18;
  scroller.scrollTo({ top: Math.max(0, desiredTop), behavior: options.instant ? 'auto' : 'smooth' });
}
function selectBlock(id, options = {}) {
  state.selectedId = id;
  const b = state.parsed.blocks.find(x => x.id === id);
  if (!b) return;
  renderDiagram();
  $('inspector').classList.remove('empty');
  const isRen = b.kind === 'command' && (b.data.command === 'ren' || b.data.command === 'rename');
  const renFields = isRen ? `<label>Source</label><input id="renSource" value="${escapeAttr(b.data.source || '')}"><label>New name</label><input id="renDestination" value="${escapeAttr(b.data.destination || '')}"><label>Resolved output</label><input value="${escapeAttr(b.data.resolvedDestination || (b.data.destinationHasPath ? 'Invalid: destination must be a filename or wildcard, not a path' : ''))}" disabled>` : '';
  $('inspector').innerHTML = `<label>Block type</label><input value="${escapeAttr(b.kind)}" disabled>${renFields}<label>Source line</label><textarea id="editRaw">${escapeHtml(b.raw)}</textarea><label>Manual note</label><textarea id="editNote">${escapeHtml(getNote(id))}</textarea><div class="button-row"><button id="applyEdit">Apply</button><button id="duplicateBlock">Duplicate</button><button id="deleteBlock">Delete</button></div>`;
  if (isRen) {
    const syncRenRaw = () => { $('editRaw').value = `${b.data.command || 'ren'} ${quoteDosArg($('renSource').value)} ${quoteDosArg($('renDestination').value)}`.trim(); };
    $('renSource').oninput = syncRenRaw; $('renDestination').oninput = syncRenRaw;
  }
  $('applyEdit').onclick = () => editBlock(b, $('editRaw').value, $('editNote').value);
  $('duplicateBlock').onclick = () => duplicateBlock(b);
  $('deleteBlock').onclick = () => deleteBlock(b);
  requestAnimationFrame(() => {
    const el = document.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
    const sec = document.querySelector(`.label-badge[data-block="${CSS.escape(id)}"]`)?.closest('.section-group');
    scrollDiagramTarget(el || sec, options);
    if (state.view === 'split' || state.view === 'source') jumpSourceToLine(b.line);
  });
}
function quoteDosArg(value) { return /\s/.test(value) && !/^".*"$/.test(value) ? `"${value}"` : value; }
function getNote(id) { return state.project.metadata.notes?.[state.currentFile]?.[id] || ''; }
function editBlock(b, raw, note) {
  const lines = state.project.files[state.currentFile].content.replace(/\r\n/g,'\n').split('\n'); lines[b.line] = raw;
  state.project.files[state.currentFile].content = lines.join('\r\n');
  state.project.metadata.notes ||= {}; state.project.metadata.notes[state.currentFile] ||= {}; state.project.metadata.notes[state.currentFile][b.id] = note;
  saveProject(); render();
}
function duplicateBlock(b) { const lines = state.project.files[state.currentFile].content.replace(/\r\n/g,'\n').split('\n'); lines.splice(b.line+1,0,b.raw); state.project.files[state.currentFile].content=lines.join('\r\n'); saveProject(); render(); }
function deleteBlock(b) { const lines = state.project.files[state.currentFile].content.replace(/\r\n/g,'\n').split('\n'); lines.splice(b.line,1); state.project.files[state.currentFile].content=lines.join('\r\n'); saveProject(); render(); }
function renderValidation() {
  $('validation').innerHTML = state.parsed.validations.map(v => `<button class="validation-item ${v.severity==='error'?'error':''}" data-block="${escapeAttr(v.blockId)}">${escapeHtml(v.message)}</button>`).join('') || '<div class="trace-summary">No detected issues.</div>';
  document.querySelectorAll('.validation-item[data-block]').forEach(el => el.onclick = () => {
    if (state.view === 'trace') { state.view = 'diagram'; applyView(); }
    selectBlock(el.dataset.block);
  });
}
function renderSimulationInputs() {
  const configInfo = state.parsed.configInfo;
  const configBanner = configInfo ? `<div class="sim-group-note">CONFIG.SYS: ${escapeHtml(configInfo.path)}${configInfo.menuDefault ? ` · default ${escapeHtml(configInfo.menuDefault)}` : ''}</div>` : '';
  const vars = state.parsed.variables.map(v => {
    const key = norm(v.name), saved = state.simValues.variables[key] ?? (key === 'config' && configInfo?.menuDefault ? configInfo.menuDefault : '');
    if (v.values.length) {
      const known = v.values.includes(saved), custom = saved && !known;
      return `<div class="sim-input"><label>%${escapeHtml(v.name)}%</label><select data-var="${escapeAttr(v.name)}"><option value="">— choose —</option>${v.values.map(x=>`<option value="${escapeAttr(x)}" ${saved===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}<option value="__custom" ${custom?'selected':''}>Custom…</option></select><input ${custom?'':'class="hidden"'} data-custom="${escapeAttr(v.name)}" value="${custom?escapeAttr(saved):''}" placeholder="custom value"></div>`;
    }
    return `<div class="sim-input"><label>%${escapeHtml(v.name)}%</label><input data-var="${escapeAttr(v.name)}" value="${escapeAttr(saved)}" placeholder="value"></div>`;
  }).join('');
  const paths = state.parsed.paths.map(p => {
    const key=normalizePath(p), saved=state.simValues.paths[key]||'unknown';
    return `<div class="sim-input"><label>${escapeHtml(p)}</label><select data-path="${escapeAttr(p)}"><option value="unknown" ${saved==='unknown'?'selected':''}>Unknown</option><option value="yes" ${saved==='yes'?'selected':''}>Exists</option><option value="no" ${saved==='no'?'selected':''}>Missing</option></select></div>`;
  }).join('');
  const outcomes = externalOutcomeBlocks(state.parsed.blocks).map(b => {
    const saved = state.simValues.outcomes[b.id] ?? '';
    return `<div class="sim-input sim-outcome"><label>Line ${b.line+1}: ${escapeHtml(b.kind === 'pipeline' ? 'Pipeline' : b.data.command || 'External command')} ERRORLEVEL</label><input type="number" min="0" step="1" data-outcome="${escapeAttr(b.id)}" value="${escapeAttr(saved)}" placeholder="required when reached"><button type="button" class="mini-jump" data-outcome-jump="${escapeAttr(b.id)}">Locate</button></div>`;
  }).join('');
  $('simulationInputs').innerHTML = configBanner + vars + paths + (outcomes ? `<h3 class="sim-subhead">External outcomes</h3>${outcomes}` : '');
  document.querySelectorAll('select[data-var]').forEach(sel => sel.onchange = () => {
    const custom=document.querySelector(`input[data-custom="${CSS.escape(sel.dataset.var)}"]`);
    custom.classList.toggle('hidden',sel.value!=='__custom');
    saveSimulationValues(); if(state.traceEnabled) runSimulation();
  });
  document.querySelectorAll('#simulationInputs input, #simulationInputs select[data-path]').forEach(el => el.oninput = () => { saveSimulationValues(); if(state.traceEnabled) runSimulation(); });
  document.querySelectorAll('[data-outcome-jump]').forEach(el => el.onclick = () => selectBlock(el.dataset.outcomeJump));
}
function saveSimulationValues() {
  const variables={}, paths={}, outcomes={};
  document.querySelectorAll('[data-var]').forEach(el => {
    let value=el.value;
    if(el.tagName==='SELECT' && value==='__custom') value=document.querySelector(`input[data-custom="${CSS.escape(el.dataset.var)}"]`).value;
    if(value && value!=='__custom') variables[norm(el.dataset.var)]=value;
  });
  document.querySelectorAll('[data-path]').forEach(el => paths[normalizePath(el.dataset.path)]=el.value);
  document.querySelectorAll('[data-outcome]').forEach(el => { if (el.value !== '') outcomes[el.dataset.outcome] = Number(el.value); });
  state.simValues={variables,paths,outcomes};
}
function collectInputs() {
  saveSimulationValues();
  const variables={...state.simValues.variables}, paths={};
  document.querySelectorAll('[data-path]').forEach(el => paths[normalizePath(expand(el.dataset.path,variables))]=el.value);
  return { variables, paths, outcomes: {...state.simValues.outcomes}, errorlevel: null };
}
function runSimulation() {
  if(!state.parsed || !state.traceEnabled) return;
  const env = collectInputs(), blocks = state.parsed.blocks, labelIndex = {};
  blocks.forEach((b,i)=>{ if(b.kind==='label') labelIndex[norm(b.data.label)] = i; });
  const trace=[]; let pc=0, steps=0; const visits={}; let stop='Completed';
  const add=(b,event,result='')=>trace.push({blockId:b.id,line:b.line+1,text:b.raw,event,result});
  while(pc < blocks.length && steps++ < 1000) {
    const b=blocks[pc]; visits[b.id]=(visits[b.id]||0)+1; if(visits[b.id]>100){ stop='Probable loop detected'; break; }
    if(b.kind==='blank'||b.kind==='comment'){ pc++; continue; }
    if(b.kind==='label'){ add(b,'label',`Entered :${b.data.label}`); pc++; continue; }
    if(b.kind==='set'&&b.data.name) { const value=expand(b.data.value,env.variables); add(b,'command',`%${b.data.name}%=${value}`); env.variables[norm(b.data.name)] = value; pc++; continue; }
    if(b.kind==='goto') {
      const target=expand(b.data.target,env.variables).replace(/^:/,'');
      add(b,'jump',`Jump to :${target}`);
      if(target.includes('%')||labelIndex[norm(target)]===undefined){ stop=`Unresolved GOTO ${target}`; break; }
      pc=labelIndex[norm(target)]; continue;
    }
    if(b.kind==='if') {
      const result=evaluateIf(b.data,env);
      add(b,'condition',result===null?'Unresolved':result?'TRUE':'FALSE');
      if(result===null){ stop=`Input required at line ${b.line+1}`; break; }
      if(result && b.data.action) {
        const action=b.data.action.trim();
        const gm=action.match(/^goto\s+(.+)$/i); if(gm){ const t=expand(gm[1],env.variables).replace(/^:/,''); trace.push({blockId:b.id,line:b.line+1,text:`↳ ${action}`,event:'branch',result:`Jump to :${t}`}); if(labelIndex[norm(t)]===undefined){stop=`Unresolved GOTO ${t}`;break;} pc=labelIndex[norm(t)]; continue; }
        const sm=action.match(/^set\s+([^=\s]+)=(.*)$/i); if(sm) { const value=expand(sm[2],env.variables); env.variables[norm(sm[1])]=value; trace.push({blockId:b.id,line:b.line+1,text:`↳ ${action}`,event:'branch',result:`%${sm[1]}%=${value}`}); }
        else trace.push({blockId:b.id,line:b.line+1,text:`↳ ${action}`,event:'branch',result:'Would execute'});
      }
      pc++; continue;
    }
    if(b.kind==='call' || b.kind==='batch-transfer') {
      const targetPath=resolveBatchTarget(b.data.target,state.currentFile);
      add(b,b.kind==='call'?'call':'transfer',targetPath ? `${b.kind==='call'?'Call':'Transfer to'} ${targetPath}` : `Unresolved batch file ${b.data.target}`);
      if(!targetPath){ stop=`Unresolved batch file ${b.data.target}`; break; }
      // Cross-file execution is represented explicitly in V1 but not yet expanded into the current file's trace.
      if(b.kind==='batch-transfer'){ stop=`Transferred execution to ${targetPath}`; break; }
      pc++; continue;
    }
    if(b.kind==='pipeline' || b.kind==='external') {
      const needsOutcome = outcomeAffectsFlow(blocks, pc);
      if (needsOutcome) {
        const configured = env.outcomes[b.id];
        if (configured === undefined || Number.isNaN(configured)) { add(b,'external','ERRORLEVEL input required for following branch'); stop=`External outcome required at line ${b.line+1}`; break; }
        env.errorlevel = configured;
        add(b,'external',`Simulated ERRORLEVEL ${configured}`);
      } else {
        add(b,'external','Would execute; result does not affect modeled flow');
      }
      pc++; continue;
    }
    add(b,'command','Would execute'); pc++;
  }
  state.trace=trace; state.traceStop=stop;
  $('traceSummary').textContent=`${trace.filter(t=>t.event!=='label').length} executed steps · ${stop}`;
  renderDiagram(); renderTraceView();
}
function evaluateIf(d, env) {
  let r=null;
  if(d.type==='exist') { const p=normalizePath(expand(d.operand,env.variables)); r=env.paths[p]==='yes'?true:env.paths[p]==='no'?false:null; }
  else if(d.type==='errorlevel') r=env.errorlevel==null?null:env.errorlevel>=d.level;
  else if(d.type==='compare') { const l=expand(d.left,env.variables), rr=expand(d.right,env.variables); if(l.includes('%')||rr.includes('%')) r=null; else r=l===rr; }
  if(r!==null&&d.negated) r=!r; return r;
}
function expand(s, vars){ return String(s).replace(/%([^%]+)%/g,(m,n)=>Object.hasOwn(vars,norm(n))?vars[norm(n)]:m); }
function normalizePath(p){ return p.replace(/\//g,'\\').toLowerCase(); }
function renderLabels(){
  if(!state.parsed){ $('labelList').innerHTML=''; return; }
  $('labelList').innerHTML=[`<button class="label-link" data-label="__entry">ENTRY</button>`, ...[...state.parsed.labels.entries()].map(([k,v])=>`<button class="label-link" data-label="${escapeAttr(k)}" data-block="${escapeAttr(v.blockId)}">:${escapeHtml(state.parsed.blocks.find(b=>b.id===v.blockId)?.data.label || k)}</button>`)].join('');
  document.querySelectorAll('#labelList [data-label]').forEach(el=>el.onclick=()=>jumpToLabel(el.dataset.label));
}
function jumpToLabel(label){
  if(label==='__entry'){ jumpToLine(1); return; }
  const hit=state.parsed.labels.get(norm(label)); if(!hit) return;
  state.selectedId = hit.blockId;
  if (state.view === 'trace') { state.view = 'diagram'; applyView(); }
  selectBlock(hit.blockId);
}
function jumpToLine(lineNumber){
  const requested = state.parsed.blocks.find(x=>x.line===lineNumber-1);
  const b = requested && requested.kind !== 'blank' ? requested : state.parsed.blocks.find(x=>x.line>=lineNumber-1 && x.kind!=='blank');
  if(b) { state.selectedId=b.id; if(state.view==='source') jumpSourceToLine(b.line); else { renderDiagram(); const el=document.querySelector(`[data-id="${CSS.escape(b.id)}"]`); scrollDiagramTarget(el); el?.closest('.section-group')?.classList.add('flash'); setTimeout(()=>el?.closest('.section-group')?.classList.remove('flash'),1100); } }
}
function jumpSourceToLine(zeroLine){
  const text=$('sourceView').value, lines=text.split('\n'); let pos=0; for(let i=0;i<zeroLine;i++) pos+=lines[i].length+1;
  $('sourceView').focus(); $('sourceView').setSelectionRange(pos,pos+Math.max(0,lines[zeroLine]?.length||0));
  const lh=parseFloat(getComputedStyle($('sourceView')).lineHeight)||19.5; $('sourceView').scrollTop=Math.max(0,zeroLine*lh-$('sourceView').clientHeight/2);
}
function renderTraceView(){
  if(!$('traceView')) return;
  const rows=state.trace.map((t,i)=>`<tr class="trace-row" data-block="${escapeAttr(t.blockId)}"><td>${String(i+1).padStart(3,'0')}</td><td>L${String(t.line).padStart(3,'0')}</td><td class="trace-event">${escapeHtml(t.event)}</td><td>${escapeHtml(t.text)}</td><td class="trace-result">${escapeHtml(t.result||'')}</td></tr>`).join('');
  $('traceView').innerHTML=`<h2>Execution trace</h2><p class="trace-summary">${escapeHtml(state.traceStop||'Set simulation inputs to calculate flow.')}</p><table class="trace-table"><thead><tr><th>#</th><th>Line</th><th>Type</th><th>Source</th><th>Result</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No trace yet.</td></tr>'}</tbody></table>`;
  document.querySelectorAll('.trace-row').forEach(row=>row.onclick=()=>{ state.view='split'; applyView(); selectBlock(row.dataset.block); });
}
function applyView(){
  document.querySelectorAll('.tabs button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('diagramView').classList.toggle('hidden',!['diagram','split'].includes(state.view));
  $('sourceView').classList.toggle('hidden',!['source','split'].includes(state.view));
  $('traceView').classList.toggle('hidden',state.view!=='trace');
  if(state.view==='split'){ $('diagramView').style.height='55%'; $('sourceView').style.height='45%'; } else { $('diagramView').style.height=''; $('sourceView').style.height=''; }
}
function updateStatus(){ $('statusText').textContent=`${state.currentFile} · ${state.parsed.blocks.length} lines · ${state.parsed.sections.length} sections`; }

function download(name, content, type='text/plain') { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

$('fileInput').onchange = async e => { for(const f of e.target.files){ const path=f.webkitRelativePath||f.name; if (/\.batflow\.json$/i.test(f.name)) { try { state.project=JSON.parse(await f.text()); state.currentFile=Object.keys(state.project.files||{})[0]||null; } catch { alert('Invalid BATFlow project file.'); } } else { state.project.files[path]={content:await f.text(),encoding:'text',lineEnding:'CRLF'}; state.currentFile ||= path; } } await saveProject(); render(); if(state.traceEnabled&&state.parsed)runSimulation(); };
$('newProject').onclick = async () => { state.project={name:'Untitled',files:{},metadata:{}}; state.currentFile=null; state.trace=[]; await saveProject(); render(); };
$('exportProject').onclick = () => download(`${state.project.name||'project'}.batflow.json`,JSON.stringify(state.project,null,2),'application/json');
$('exportBat').onclick = () => { if(state.currentFile) download(state.currentFile.split('/').pop(),state.project.files[state.currentFile].content); };
function updateTraceToggle() {
  const button = $('traceToggle');
  button.setAttribute('aria-pressed', String(state.traceEnabled));
  button.textContent = state.traceEnabled ? 'Trace: On' : 'Trace: Off';
  button.classList.toggle('active', state.traceEnabled);
}
$('traceToggle').onclick = () => {
  state.traceEnabled = !state.traceEnabled;
  updateTraceToggle();
  if (state.traceEnabled) runSimulation();
  else { state.trace=[]; state.traceStop='Trace disabled'; $('traceSummary').textContent='Trace disabled'; renderDiagram(); renderTraceView(); }
};
$('sourceView').oninput = () => { if(!state.currentFile)return; state.project.files[state.currentFile].content=$('sourceView').value; saveProject(); render(); };
document.querySelectorAll('.tabs button[data-view]').forEach(btn=>btn.onclick=()=>{ state.view=btn.dataset.view; applyView(); });

loadSavedProject().then(p=>{ if(p){state.project=p; state.currentFile=Object.keys(p.files)[0]||null;} render(); updateTraceToggle(); if(state.traceEnabled && state.parsed) runSimulation(); });
