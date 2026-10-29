(function(){
    'use strict';
    if (window.__trkDashboardsV2) return;
    window.__trkDashboardsV2 = true;

    var stateDash = { task:null, mode:'medium', dir:'all', draft:null, lanes:[{task:null,draft:null}], activeLane:0, todayOffset:0 };
    var MODE_MONTHS = { small:12, medium:6, large:3 };
    function syncLane(){ var l=stateDash.lanes[stateDash.activeLane]; if(l){ l.task=stateDash.task; l.draft=stateDash.draft; } }
    function switchLane(i){ stateDash.activeLane=i; var l=stateDash.lanes[i]; stateDash.task=l?l.task:null; stateDash.draft=l?l.draft:null; }
    function addLane(){ if(stateDash.lanes.length>=5) return false; stateDash.lanes.push({task:null,draft:null}); switchLane(stateDash.lanes.length-1); return true; }
    function removeLane(i){ if(stateDash.lanes.length<=1) return false; stateDash.lanes.splice(i,1); if(stateDash.activeLane>=stateDash.lanes.length) stateDash.activeLane=stateDash.lanes.length-1; switchLane(stateDash.activeLane); return true; }
    var DASH_DIR_LABEL = { retail:'Розничное', corp:'Корпоративное' };
    var DASH_STAGE_KEY_DEFAULT = 'проверка_нжя';

    var STAGE_ORDER = [
        'подготовка','проверка_нжя','проверка_соглЦА','ос_проф',
        'реализация_возражения','реализация_согласования','запас','оценка_тб'
    ];
    var STAGE_LABELS = {
        'подготовка':'Подготовка',
        'проверка_нжя':'Проверка НЖЯ',
        'проверка_соглЦА':'Проверка согл. ЦА',
        'ос_проф':'ОС проф.',
        'реализация_возражения':'Реализация возражения',
        'реализация_согласования':'Реализация согласования',
        'запас':'Запас',
        'оценка_тб':'Оценка ТБ'
    };
    var STAGE_WEIGHTS = {
        'подготовка': 0.7,
        'проверка_нжя': 1.0,
        'проверка_соглЦА': 1.0,
        'ос_проф': 0.0,
        'реализация_возражения': 1.0,
        'реализация_согласования': 0.5,
        'запас': 0.5,
        'оценка_тб': 0.0
    };
    var STAGE_COLORS = {
        'подготовка':'#5dade2',
        'проверка_нжя':'#48c9b0',
        'проверка_соглЦА':'#58d68d',
        'ос_проф':'#f4d03f',
        'реализация_возражения':'#eb984e',
        'реализация_согласования':'#e59866',
        'запас':'#af7ac5',
        'оценка_тб':'#ec7063'
    };
    var PLAN_TYPE_MAP = { retail:'розничная', corp:'корпоративная' };

    function st(){ return window.__trkState || { tasks:[], departments:[], employees:[] }; }
    function byId(id){ return document.getElementById(id); }
    function escapeHtml(s){
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function notify(msg, kind){
        if (typeof window.__trackerNotify === 'function') { window.__trackerNotify(msg, kind); return; }
        var t = document.getElementById('toast');
        if (t) {
            t.textContent = msg;
            t.className = 'toast show ' + (kind || 'info');
            setTimeout(function(){ t.classList.remove('show'); }, 2800);
            return;
        }
        try { console.log('[dashboards]', kind || 'info', msg); } catch(e){}
    }
    function apiJson(url, options){
        options = options || {};
        options.headers = Object.assign({}, options.headers || {});
        var csrf = window.REESTR_CSRF || '';
        if (!csrf) {
            var meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) csrf = meta.getAttribute('content') || '';
        }
        if (csrf && options.method && options.method !== 'GET') {
            options.headers['X-CSRF-Token'] = csrf;
        }
        if (!options.credentials) options.credentials = 'same-origin';
        return fetch(url, options).then(function(r){ return r.json(); });
    }
    function fmtNum(v){
        return (v === null || v === undefined || isNaN(v)) ? '—' : String(Math.round(Number(v)*100)/100).replace('.', ',');
    }
    function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }
    function ymd(d){
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function todayISO(){
        var s = st().today;
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return ymd(new Date());
    }
    function parse(s){
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
    }
    function addDays(d, n){
        var x = new Date(d.getTime());
        x.setDate(x.getDate() + n);
        return x;
    }
    function addDaysISO(iso, delta){
        var d = parse(iso) || new Date();
        d.setDate(d.getDate() + delta);
        return ymd(d);
    }
    function ovl(a, b, ps, pe){
        return a && b && a <= pe && b >= ps;
    }
    function clone(x){ return JSON.parse(JSON.stringify(x || {})); }
    function deptById(id){
        return (st().departments || []).find(function(d){ return d.id === id; }) || null;
    }
    function stageLabel(key){ return STAGE_LABELS[key] || key; }
    function stageWeight(key){ return (STAGE_WEIGHTS[key] !== undefined) ? STAGE_WEIGHTS[key] : 1.0; }
    function dirTaskType(dir){ return PLAN_TYPE_MAP[dir] || (dir === 'corp' ? 'корпоративная' : 'розничная'); }
    function dashTaskDir(t){
        var tt = (t && t.task_type ? String(t.task_type) : '').toLowerCase();
        if (tt.indexOf('корп') !== -1) return 'corp';
        if (tt.indexOf('розн') !== -1) return 'retail';
        return '';
    }
    function dashDirMatch(t){
        if (stateDash.dir === 'all') return true;
        var d = dashTaskDir(t);
        return d === '' || d === stateDash.dir;
    }

    function normByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.headcount_retail : dep.headcount_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function coefByDir(dep, dir){
        if (!dep) return null;
        var v = (dir === 'retail') ? dep.expert_coef_retail : dep.expert_coef_corp;
        return (v === null || v === undefined || v === '') ? null : num(v);
    }
    function calcPossible(dep, dir){
        var obj = (typeof dep === 'object' && dep) ? dep : deptById(dep);
        if (!obj) return null;
        var n = normByDir(obj, dir), c = coefByDir(obj, dir);
        if (n === null || c === null) return null;
        return Math.round(n * c * 100) / 100;
    }
    function calcAuditWeight(t, ps, pe){
        var stages = (t && Array.isArray(t.stages)) ? t.stages.filter(function(s){ return s && s.start; }) : [];
        if (!stages.length) {
            var a0 = parse(t && t.start_date), b0 = parse((t && t.deadline) || (t && t.start_date));
            return ovl(a0, b0, ps, pe) ? 1.0 : 0;
        }
        var w = 0;
        stages.forEach(function(s){
            var a = parse(s.start), b = parse(s.end || (t && t.deadline) || s.start);
            if (ovl(a, b, ps, pe)) {
                var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                if (sw > w) w = sw;
            }
        });
        return w;
    }
    function calcTaskLeadCoef(t, bankId){
        if (!t || (t.lead_department || '') !== bankId) return 1.0;
        var tp = t.task_type || '';
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function calcTaskShareMult(t, bankId){
        if (!t || !t.department_shares) return 1.0;
        var v = t.department_shares[bankId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }

    function ensureDashboardsTab(){
        var tabs = document.querySelector('.tracker-tabs');
        if (!tabs) return;
        if (!tabs.querySelector('[data-tab="dashboards"]')) {
            var anchor = tabs.querySelector('.tracker-tab[data-tab="stats"]');
            var btn = document.createElement('button');
            btn.className = 'tracker-tab';
            btn.setAttribute('data-tab', 'dashboards');
            btn.id = 'tabDashboardsBtn';
            btn.innerHTML = '<span>📊</span><span>Дашборды</span>';
            if (anchor && anchor.parentNode === tabs) tabs.insertBefore(btn, anchor);
            else tabs.appendChild(btn);
        }
    }
    function activateDashboardsTab(){
        ensureDashboardsTab();
        document.querySelectorAll('.tracker-tab').forEach(function(t){
            t.classList.toggle('active', t.getAttribute('data-tab') === 'dashboards');
        });
        document.querySelectorAll('.tracker-panel').forEach(function(p){
            p.classList.toggle('active', p.id === 'panel-dashboards');
        });
        try { localStorage.setItem('tracker_activeTab', 'dashboards'); } catch(e){}
        renderSelector();
        syncControls();
        renderGantt();
        renderLoad();
    }

    function dashNormalizeStages(task){
        var raw = (task && Array.isArray(task.stages)) ? clone(task.stages) : [];
        var stages = raw.filter(function(s){ return s && s.start; });
        stages.sort(function(a,b){ return String(a.start || '').localeCompare(String(b.start || '')); });
        if (!stages.length) {
            var ds = (task && task.start_date) || todayISO();
            var de = (task && task.deadline) || addDaysISO(ds, 90);
            if (de < ds) de = ds;
            stages = [{ key: DASH_STAGE_KEY_DEFAULT, start: ds, end: de, weight: 1.0 }];
        }
        for (var i = 0; i < stages.length; i++) {
            var s = stages[i], next = stages[i+1];
            if (!s.end || s.end < s.start) {
                var cand = (next && next.start) ? addDaysISO(next.start, -1) : ((task && task.deadline) || s.start);
                if (!cand || cand < s.start) cand = s.start;
                s.end = cand;
            }
            if (s.weight === undefined || s.weight === null) s.weight = stageWeight(s.key);
        }
        return stages;
    }

    function dashBuildDraft(task){
        var draft = clone(task || {});
        draft.id = task && task.id ? task.id : '';
        draft.name = draft.name || 'Проверка';
        draft.task_kind = draft.task_kind || 'audit';
        draft.task_type = draft.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная');
        // Не переключаем фильтр, если выбрано «Все» — просто показываем проверку как есть
        if (stateDash.dir !== 'all') {
            if (draft.task_type === 'корпоративная') stateDash.dir = 'corp';
            else if (draft.task_type === 'розничная') stateDash.dir = 'retail';
        }
        draft.start_date = draft.start_date || todayISO();
        draft.deadline = draft.deadline || addDaysISO(draft.start_date, 90);
        if (draft.deadline < draft.start_date) draft.deadline = draft.start_date;
        draft.department_ids = Array.isArray(draft.department_ids) ? draft.department_ids.slice() : [];
        draft.department_shares = clone(draft.department_shares || {});
        draft.department_ids.forEach(function(depId){
            if (draft.department_shares[depId] == null) draft.department_shares[depId] = 100;
        });
        draft.stages = dashNormalizeStages(draft);
        draft.lead_department = draft.lead_department || (draft.department_ids[0] || '');
        return draft;
    }

    function dashCreateDraft(opts){
        opts = opts || {};
        var start = todayISO();
        var end = addDaysISO(start, 90);
        var allDeps = (st().departments || []);
        var firstDepIds = allDeps.length ? [allDeps[0].id] : [];
        var shares = {};
        firstDepIds.forEach(function(id){ shares[id] = 100; });
        var dir = opts.dir === 'corp' ? 'corp' : 'retail';
        var draft = {
            id: '',
            name: opts.name,
            task_kind: 'audit',
            task_type: dirTaskType(dir),
            pocket: opts.pocket || '',
            start_date: start,
            deadline: end,
            department_ids: firstDepIds,
            department_shares: shares,
            lead_department: firstDepIds[0] || '',
            stages: [{ key: DASH_STAGE_KEY_DEFAULT, start: start, end: end, weight: 1.0 }]
        };
        // Чтобы созданная колбаска не отфильтровалась — выставляем направление фильтра под неё
        if (stateDash.dir !== 'all' && stateDash.dir !== dir) stateDash.dir = 'all';
        stateDash.task = null;
        stateDash.draft = draft;
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
        notify('Создана проверка «' + draft.name + '» (' + DASH_DIR_LABEL[dir] + ', 3 мес: ' + start + ' → ' + end + ')', 'info');
    }

    function dashCloseCreateModal(){
        var ov = byId('dashCreateModal');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.removeEventListener('keydown', dashCreateModalEsc);
    }
    function dashCreateModalEsc(e){ if (e.key === 'Escape') dashCloseCreateModal(); }

    function dashOpenCreateModal(){
        dashCloseCreateModal();
        var existingCount = (st().tasks || []).filter(function(t){ return (t.task_kind || 'audit') === 'audit'; }).length;
        var defName = 'Новая проверка ' + (existingCount + 1);
        var defDir = stateDash.dir === 'corp' ? 'corp' : 'retail';
        // Список существующих карманов
        var seen = {}, pockets = [];
        (st().tasks || []).forEach(function(t){ var pk=(t.pocket||'').trim(); if(pk && !seen[pk]){ seen[pk]=1; pockets.push(pk);} });
        pockets.sort();
        var pocketOpts = ['<option value="">— Без кармана —</option>'];
        pockets.forEach(function(pk){ pocketOpts.push('<option value="'+escapeHtml(pk)+'">'+escapeHtml(pk)+'</option>'); });

        var ov = document.createElement('div');
        ov.id = 'dashCreateModal';
        ov.className = 'dash-modal-overlay';
        ov.innerHTML = ''
            + '<div class="dash-modal" role="dialog" aria-modal="true">'
            +   '<div class="dash-modal-head">Новая проверка</div>'
            +   '<div class="dash-modal-body">'
            +     '<label class="dash-modal-label">Название проверки <span class="dash-req">*</span></label>'
            +     '<input type="text" id="dashCmName" class="form-control" value="'+escapeHtml(defName)+'" placeholder="Например: Проверка Байкальского банка">'
            +     '<div class="dash-modal-err" id="dashCmNameErr"></div>'
            +     '<label class="dash-modal-label">Направление <span class="dash-req">*</span></label>'
            +     '<div class="btn-seg dash-modal-seg" id="dashCmDir">'
            +       '<button class="btn-seg-btn'+(defDir==='corp'?' active':'')+'" type="button" data-dir="corp">Корп</button>'
            +       '<button class="btn-seg-btn'+(defDir==='retail'?' active':'')+'" type="button" data-dir="retail">Розн</button>'
            +     '</div>'
            +     '<label class="dash-modal-label">Карман</label>'
            +     '<select id="dashCmPocket" class="form-control">'+pocketOpts.join('')+'</select>'
            +   '</div>'
            +   '<div class="dash-modal-foot">'
            +     '<button class="btn btn-secondary" type="button" id="dashCmCancel">Отмена</button>'
            +     '<button class="btn" type="button" id="dashCmOk">Создать</button>'
            +   '</div>'
            + '</div>';
        document.body.appendChild(ov);

        var dirSel = defDir;
        var seg = byId('dashCmDir');
        seg.addEventListener('click', function(e){
            var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
            if (!b) return;
            dirSel = b.getAttribute('data-dir');
            seg.querySelectorAll('[data-dir]').forEach(function(x){ x.classList.toggle('active', x===b); });
        });
        ov.addEventListener('mousedown', function(e){ if (e.target === ov) dashCloseCreateModal(); });
        byId('dashCmCancel').addEventListener('click', dashCloseCreateModal);
        document.addEventListener('keydown', dashCreateModalEsc);
        byId('dashCmOk').addEventListener('click', function(){
            var nm = (byId('dashCmName').value || '').trim();
            if (!nm) { byId('dashCmNameErr').textContent = 'Укажите название проверки'; byId('dashCmName').focus(); return; }
            var pk = byId('dashCmPocket').value || '';
            dashCloseCreateModal();
            dashCreateDraft({ name: nm, dir: dirSel, pocket: pk });
        });
        setTimeout(function(){ var el=byId('dashCmName'); if(el){ el.focus(); el.select(); } }, 30);
    }

    function loadDraft(t){
        stateDash.task = t || null;
        stateDash.draft = t ? dashBuildDraft(t) : null;
        syncControls();
        renderSelector();
        renderGantt();
        renderLoad();
    }

    function syncControls(){
        var sel = byId('dashTaskSelector');
        if (sel) {
            if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
            else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
            else sel.value = '';
        }
        var dirBox = byId('dashDirSwitch');
        if (dirBox) {
            dirBox.querySelectorAll('[data-dir]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-dir') === stateDash.dir);
            });
        }
        var modeBox = byId('dashModeSwitch');
        if (modeBox) {
            modeBox.querySelectorAll('[data-mode]').forEach(function(btn){
                btn.classList.toggle('active', btn.getAttribute('data-mode') === stateDash.mode);
            });
        }
        var slider = byId('dashTodaySlider');
        if (slider) {
            slider.value = stateDash.todayOffset || 0;
        }
        var lbl = byId('dashTodayLabel');
        if (lbl) {
            var off = stateDash.todayOffset || 0;
            lbl.textContent = off === 0 ? 'по центру' : (off > 0 ? '+' + off + ' дн' : off + ' дн');
        }
    }

    function renderSelector(){
        var sel = byId('dashTaskSelector');
        if (!sel) return;
        var allTasks = (st().tasks || []);
        var auditTasks = allTasks.filter(function(t){ return (t.task_kind || 'audit') === 'audit'; });
        var base = auditTasks.length ? auditTasks : allTasks;
        var list = base.filter(function(t){ return dashDirMatch(t); });
        var opts = ['<option value="">-- Выберите проверку (' + list.length + ') --</option>'];
        if (stateDash.draft && !stateDash.draft.id) {
            opts.push('<option value="__new__">✨ ' + escapeHtml(stateDash.draft.name || 'Новая проверка') + ' (черновик)</option>');
        }
        list.forEach(function(t){
            var meta = [];
            if (t.task_type) meta.push(t.task_type);
            if (t.start_date || t.deadline) meta.push((t.start_date || '…') + '→' + (t.deadline || '…'));
            if (Array.isArray(t.department_ids) && t.department_ids.length) meta.push('банков: ' + t.department_ids.length);
            opts.push('<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + (meta.length ? ' · ' + escapeHtml(meta.join(' · ')) : '') + '</option>');
        });
        sel.innerHTML = opts.join('');
        if (stateDash.task && stateDash.task.id) sel.value = stateDash.task.id;
        else if (stateDash.draft && !stateDash.draft.id) sel.value = '__new__';
        else sel.value = '';
    }

    function dashTimeBounds(){
        var months = MODE_MONTHS[stateDash.mode] || 6;
        var totalDays = Math.round(months * 30.44);
        var center = addDaysISO(todayISO(), stateDash.todayOffset || 0);
        var half = Math.floor(totalDays / 2);
        var startISO = addDaysISO(center, -half);
        var endISO = addDaysISO(center, totalDays - half);
        return { startISO: startISO, endISO: endISO, days: totalDays };
    }

    function dashSlots(){
        var b = dashTimeBounds();
        var start = parse(b.startISO) || new Date(); start.setHours(0,0,0,0);
        var end = parse(b.endISO) || addDays(start, 180); end.setHours(0,0,0,0);
        if (end < start) { var tmp = start; start = end; end = tmp; }
        var slots = [];
        var useDays = (stateDash.mode === 'large');
        if (useDays) {
            var maxDays = 120, cnt = 0;
            for (var d = new Date(start.getTime()); d <= end && cnt < maxDays; d = addDays(d, 1), cnt++) {
                slots.push({ key: ymd(d), start: new Date(d.getTime()), end: new Date(d.getTime()),
                    label: String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') });
            }
        } else {
            var mon = new Date(start.getTime());
            var wd = (mon.getDay() + 6) % 7;
            mon.setDate(mon.getDate() - wd);
            var maxWeeks = 80, wcnt = 0;
            while (mon <= end && wcnt < maxWeeks) {
                var we = addDays(mon, 6);
                slots.push({ key: ymd(mon), start: new Date(mon.getTime()), end: we,
                    label: String(mon.getDate()).padStart(2,'0') + '.' + String(mon.getMonth()+1).padStart(2,'0') });
                mon = addDays(mon, 7);
                wcnt++;
            }
        }
        return slots;
    }

    function dashLeadCoef(depId){
        if (!stateDash.draft) return 1.0;
        if ((stateDash.draft.lead_department || '') !== depId) return 1.0;
        var tp = stateDash.draft.task_type || dirTaskType(stateDash.dir);
        if (tp === 'розничная') return 2.0;
        if (tp === 'корпоративная') return 1.5;
        return 1.0;
    }
    function dashShareMult(depId){
        if (!stateDash.draft || !stateDash.draft.department_shares) return 1.0;
        var v = stateDash.draft.department_shares[depId];
        if (v === undefined || v === null || v === '') return 1.0;
        var n = Number(v);
        return isFinite(n) && n > 0 ? (n / 100.0) : 1.0;
    }
    function dashDraftStageLoad(slotStart, slotEnd, depId){
        if (!stateDash.draft) return 0;
        if ((stateDash.draft.department_ids || []).indexOf(depId) < 0) return 0;
        var draftType = stateDash.draft.task_type || dirTaskType(stateDash.dir);
        if (draftType !== dirTaskType(stateDash.dir)) return 0;
        var stages = dashNormalizeStages(stateDash.draft);
        var maxW = 0;
        stages.forEach(function(s){
            if (!s.start) return;
            var a = parse(s.start), b = parse(s.end || stateDash.draft.deadline || s.start);
            if (ovl(a, b, slotStart, slotEnd)) {
                var sw = (s.weight !== undefined && s.weight !== null) ? Number(s.weight) : stageWeight(s.key);
                if (sw > maxW) maxW = sw;
            }
        });
        if (maxW <= 0) return 0;
        return Math.round(maxW * dashLeadCoef(depId) * dashShareMult(depId) * 100) / 100;
    }
    function dashBaseLoad(depId, slot){
        var all = st().tasks || [];
        var editId = (stateDash.draft && stateDash.draft.id) || (stateDash.task && stateDash.task.id) || '';
        var dirType = dirTaskType(stateDash.dir);
        var ps = new Date(slot.start.getTime()); ps.setHours(0,0,0,0);
        var pe = new Date(slot.end.getTime()); pe.setHours(23,59,59,999);
        var base = 0;
        all.forEach(function(t){
            if (editId && t.id === editId) return;
            if ((t.department_ids || []).indexOf(depId) < 0) return;
            if ((t.task_kind || 'audit') !== 'audit') return;
            if ((t.task_type || '') !== dirType) return;
            var w = calcAuditWeight(t, ps, pe);
            if (w > 0) base += w * calcTaskLeadCoef(t, depId) * calcTaskShareMult(t, depId);
        });
        return Math.max(0, Math.round(base * 100) / 100);
    }

    function dashShiftAll(deltaDays){
        if (!stateDash.draft) return;
        var d = stateDash.draft, stg = dashNormalizeStages(d);
        stg.forEach(function(s){
            s.start = addDaysISO(s.start, deltaDays);
            s.end = addDaysISO(s.end || s.start, deltaDays);
        });
        d.stages = stg;
        d.start_date = addDaysISO(d.start_date, deltaDays);
        d.deadline = addDaysISO(d.deadline, deltaDays);
    }

    function dashAttachDrag(c){
        var track = byId('dashTlTrack');
        if (!track || !stateDash.draft) return;
        var rng = stateDash._range || {};
        var days = rng.days || 180;
        /* Cache track width at drag start — NOT re-read during move (it can be 0 after innerHTML swap) */
        var trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
        function pxToDays(px){
            return Math.round((px / trackW) * days);
        }
        var drag = null;
        function onDown(e){
            if (e.button !== undefined && e.button !== 0) return;
            var t = e.target;
            if (t.closest && t.closest('.dash-seg-del')) return;
            if (t.closest && t.closest('[data-lane]')) return;
            if (t.closest && t.closest('.dash-lane-close')) return;
            if (t.closest && t.closest('#dashAddLaneBtn')) return;
            var handle = t.closest ? t.closest('.dash-seg-h') : null;
            var seg = t.closest ? t.closest('.dash-seg') : null;
            if (handle) {
                drag = { type:'edge', idx:+handle.getAttribute('data-idx'), edge:handle.getAttribute('data-edge') };
            } else if (seg) {
                drag = { type:'seg', idx:+seg.getAttribute('data-idx') };
            } else {
                drag = { type:'all' };
            }
            drag.x0 = e.clientX;
            /* Snapshot the current stages ONCE at drag start */
            drag.snap = dashNormalizeStages(stateDash.draft).map(function(s){
                return { key:s.key, start:s.start, end:s.end, weight:s.weight };
            });
            drag.baseStart = stateDash.draft.start_date;
            drag.baseDeadline = stateDash.draft.deadline;
            /* Re-read track width in case layout changed */
            trackW = track.getBoundingClientRect().width || track.offsetWidth || 800;
            e.preventDefault();
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
        }
        function onMove(e){
            if (!drag || !stateDash.draft) return;
            var dd = pxToDays(e.clientX - drag.x0);
            if (dd === 0) return;
            var snap = drag.snap;
            if (drag.type === 'all') {
                /* Apply delta from snapshot, not from current state */
                stateDash.draft.stages = snap.map(function(s){ return { key:s.key, start:addDaysISO(s.start, dd), end:addDaysISO(s.end||s.start, dd), weight:s.weight }; });
                stateDash.draft.start_date = addDaysISO(drag.baseStart, dd);
                stateDash.draft.deadline = addDaysISO(drag.baseDeadline, dd);
            } else {
                var i = drag.idx, s = snap[i];
                if (!s) return;
                var stg = snap.map(function(x){ return { key:x.key, start:x.start, end:x.end, weight:x.weight }; });
                if (drag.type === 'edge') {
                    if (drag.edge === 'start') {
                        var ns = addDaysISO(s.start, dd);
                        if (ns > stg[i].end) ns = stg[i].end;
                        stg[i].start = ns;
                    } else {
                        var ne = addDaysISO(s.end, dd);
                        if (ne < stg[i].start) ne = stg[i].start;
                        stg[i].end = ne;
                    }
                } else {
                    stg[i].start = addDaysISO(s.start, dd);
                    stg[i].end = addDaysISO(s.end, dd);
                }
                stateDash.draft.stages = stg;
                var mn = stg[0].start, mx = stg[0].end || stg[0].start;
                stg.forEach(function(x){
                    if (x.start < mn) mn = x.start;
                    var xe = x.end || x.start;
                    if (xe > mx) mx = xe;
                });
                stateDash.draft.start_date = mn;
                stateDash.draft.deadline = mx;
            }
            syncLane();
            renderGantt();
            renderLoad();
        }
        function onUp(){
            drag = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        }
        track.addEventListener('pointerdown', onDown);
        c.querySelectorAll('.dash-seg-del').forEach(function(b){
            b.addEventListener('click', function(ev){
                ev.stopPropagation();
                var idx = +this.getAttribute('data-del');
                var stg = dashNormalizeStages(stateDash.draft);
                if (stg[idx] && stg[idx].key !== DASH_STAGE_KEY_DEFAULT) {
                    stg.splice(idx, 1);
                    stateDash.draft.stages = stg;
                    syncLane();
                    renderGantt(); renderLoad();
                }
            });
        });
    }

    function openAddStageDialog(){
        if (!stateDash.draft) { dashOpenCreateModal(); return; }
        var existing = {};
        dashNormalizeStages(stateDash.draft).forEach(function(s){ existing[s.key] = true; });
        var options = STAGE_ORDER.filter(function(k){ return k !== DASH_STAGE_KEY_DEFAULT && !existing[k]; });
        if (!options.length) { notify('Все 7 дополнительных этапов уже добавлены', 'info'); return; }
        var labels = options.map(function(k, i){ return (i+1) + '. ' + stageLabel(k) + ' (вес ' + stageWeight(k) + ')'; }).join('\n');
        var ans = window.prompt('Добавить этап в колбаску:\n' + labels + '\n\nВведите номер этапа (1–' + options.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= options.length) { notify('Некорректный номер этапа', 'error'); return; }
        var key = options[idx];
        var stg = dashNormalizeStages(stateDash.draft);
        var lastEnd = stateDash.draft.deadline || stateDash.draft.start_date || todayISO();
        stg.forEach(function(s){ if ((s.end || s.start) > lastEnd) lastEnd = s.end || s.start; });
        var newStart = addDaysISO(lastEnd, 1);
        var newEnd = addDaysISO(newStart, 13);
        stg.push({ key: key, start: newStart, end: newEnd, weight: stageWeight(key) });
        stateDash.draft.stages = stg;
        if (newEnd > stateDash.draft.deadline) stateDash.draft.deadline = newEnd;
        renderGantt();
        renderLoad();
    }

    function openAddBankDialog(){
        if (!stateDash.draft) { dashOpenCreateModal(); return; }
        var cur = stateDash.draft.department_ids || [];
        var avail = (st().departments || []).filter(function(dep){ return cur.indexOf(dep.id) < 0; });
        if (!avail.length) { notify('Все банки уже участвуют в проверке', 'info'); return; }
        var labels = avail.map(function(dep, i){ return (i+1) + '. ' + dep.name; }).join('\n');
        var ans = window.prompt('Добавить банк в проверку:\n' + labels + '\n\nВведите номер банка (1–' + avail.length + '):', '1');
        if (ans === null) return;
        var idx = parseInt(ans, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= avail.length) { notify('Некорректный номер банка', 'error'); return; }
        var dep = avail[idx];
        stateDash.draft.department_ids = cur.concat([dep.id]);
        stateDash.draft.department_shares = stateDash.draft.department_shares || {};
        if (stateDash.draft.department_shares[dep.id] == null) stateDash.draft.department_shares[dep.id] = 100;
        if (!stateDash.draft.lead_department) stateDash.draft.lead_department = dep.id;
        renderGantt();
        renderLoad();
    }

    function renderLaneBlock(lane, laneIdx, isActive, b){
        var hasDraft = !!lane.draft;
        var d = lane.draft || {
            name: 'Проверка не выбрана (линия жизни)',
            task_type: dirTaskType(stateDash.dir),
            start_date: todayISO(),
            deadline: addDaysISO(todayISO(), 90),
            department_ids: [],
            stages: []
        };
        var stages = hasDraft ? dashNormalizeStages(d) : [];
        var rangeStart = b.startISO, rangeEnd = b.endISO, totalDays = b.days || 180;

        function pctX(iso){
            var dd = Math.round((parse(iso) - parse(rangeStart)) / 86400000);
            return Math.max(-5, Math.min(105, (dd / totalDays) * 100));
        }

        /* Ticks */
        var ticks = [];
        var useDays = (stateDash.mode === 'large');
        var step = useDays ? (totalDays > 60 ? 3 : 1) : 7;
        for (var ti = 0; ti <= totalDays; ti += step) {
            var iso = addDaysISO(rangeStart, ti);
            var dt = parse(iso);
            var lbl = String(dt.getDate()).padStart(2,'0') + '.' + String(dt.getMonth()+1).padStart(2,'0');
            ticks.push('<div class="dash-tl-tick" style="left:' + ((ti / totalDays) * 100) + '%"><span>' + escapeHtml(lbl) + '</span></div>');
        }
        var todayMarker = '<div class="dash-tl-today" style="left:' + pctX(todayISO()) + '%" title="Сегодня"></div>';

        /* Segments */
        var segs = '';
        if (hasDraft) {
            segs = stages.map(function(s, idx){
                var x0 = pctX(s.start);
                var x1 = pctX(s.end || addDaysISO(s.start, 1));
                var w = Math.max(1.5, x1 - x0);
                var col = STAGE_COLORS[s.key] || '#48c9b0';
                var isDefault = (s.key === DASH_STAGE_KEY_DEFAULT);
                var tip = stageLabel(s.key) + ': ' + s.start + ' \u2192 ' + (s.end || s.start) + ' (\u0432\u0435\u0441 ' + fmtNum(s.weight) + ')';
                return '<div class="dash-seg' + (isDefault ? ' dash-seg-lead' : '') + '" data-idx="' + idx + '" title="' + escapeHtml(tip) + '" style="left:' + x0 + '%;width:' + w + '%;background:' + escapeHtml(col) + '">'
                    + '<span class="dash-seg-h dash-seg-h-l" data-idx="' + idx + '" data-edge="start" title="\u0422\u044f\u043d\u0443\u0442\u044c \u043d\u0430\u0447\u0430\u043b\u043e"></span>'
                    + '<span class="dash-seg-lab">' + escapeHtml(stageLabel(s.key)) + ' (' + escapeHtml(s.start.slice(8)+'.'+s.start.slice(5,7)) + '\u2013' + escapeHtml((s.end||s.start).slice(8)+'.'+(s.end||s.start).slice(5,7)) + ')</span>'
                    + '<span class="dash-seg-h dash-seg-h-r" data-idx="' + idx + '" data-edge="end" title="\u0422\u044f\u043d\u0443\u0442\u044c \u043a\u043e\u043d\u0435\u0446"></span>'
                    + (isDefault ? '' : '<button class="dash-seg-del" type="button" data-del="' + idx + '" data-lane="' + laneIdx + '" title="\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u044d\u0442\u0430\u043f">\u00d7</button>')
                    + '</div>';
            }).join('');
        } else {
            segs = '<div class="dash-tl-empty-bar">\u041f\u0443\u0441\u0442\u0430\u044f \u043b\u0438\u043d\u0438\u044f \u0436\u0438\u0437\u043d\u0438 (' + escapeHtml(rangeStart) + ' \u2192 ' + escapeHtml(rangeEnd) + '). \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u00ab+ \u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443\u00bb.</div>';
        }
        var trackId = isActive ? ' id="dashTlTrack"' : '';
        return '<div class="dash-timeline">'
            + '<div class="dash-tl-axis">' + ticks.join('') + '</div>'
            + '<div class="dash-tl-track"' + trackId + ' data-lane-track="' + laneIdx + '">' + todayMarker + segs + '</div>'
            + '</div>';
    }

    function renderLaneControls(lane, laneIdx){
        var hasDraft = !!lane.draft;
        if (!hasDraft) return '';
        var d = lane.draft;
        var allDeps = st().departments || [];
        var curIds = d.department_ids || [];

        /* Bank chips: white -> blue (on), lead -> yellow */
        var bankChips = '<div class="dash-bank-chips"><span class="dash-bank-chips-lbl">\u0411\u0430\u043d\u043a\u0438 \u0432 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435 (\u043a\u043b\u0438\u043a \u2014 \u0432\u043a\u043b/\u0432\u044b\u043a\u043b, \u043f\u0440\u0430\u0432\u0430\u044f \u043a\u043d\u043e\u043f\u043a\u0430 \u2014 \u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c):</span>'
            + allDeps.map(function(dep){
                var on = curIds.indexOf(dep.id) >= 0;
                var isLead = (d.lead_department === dep.id);
                var sh = (d.department_shares && d.department_shares[dep.id] != null) ? d.department_shares[dep.id] : 100;
                return '<button class="dash-bank-chip' + (on ? ' on' : '') + (isLead ? ' lead' : '') + '" type="button" data-toggle-bank="' + escapeHtml(dep.id) + '" data-lane="' + laneIdx + '" title="' + escapeHtml(dep.name + (isLead ? ' (\u0440\u0443\u043a\u043e\u0432\u043e\u0434\u0438\u0442\u0435\u043b\u044c)' : '') + (on ? ' \u00b7 \u0434\u043e\u043b\u044f ' + sh + '%' : '')) + '">' + escapeHtml(dep.name) + (isLead ? ' \u2605' : '') + '</button>';
            }).join('')
            + '</div>';

        /* Stage chips: white -> stage color (on) */
        var existing = {};
        dashNormalizeStages(d).forEach(function(s){ existing[s.key] = true; });
        var stageChips = '<div class="dash-stage-chips"><span class="dash-bank-chips-lbl">\u042d\u0442\u0430\u043f\u044b \u0432 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0435 (\u043a\u043b\u0438\u043a \u2014 \u0432\u043a\u043b/\u0432\u044b\u043a\u043b):</span>'
            + STAGE_ORDER.map(function(k){
                var on = !!existing[k];
                var col = STAGE_COLORS[k] || '#48c9b0';
                var isDefault = (k === DASH_STAGE_KEY_DEFAULT);
                var style = on ? ('style="background:' + col + ';border-color:' + col + ';color:#fff"') : '';
                return '<button class="dash-stage-chip' + (on ? ' on' : '') + (isDefault ? ' is-default' : '') + '" type="button" data-toggle-stage="' + escapeHtml(k) + '" data-lane="' + laneIdx + '" ' + style + ' title="' + escapeHtml(stageLabel(k) + (isDefault ? ' (\u0431\u0430\u0437\u043e\u0432\u044b\u0439, \u043d\u0435\u043b\u044c\u0437\u044f \u0432\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c)' : '') + ' \u00b7 \u0432\u0435\u0441 ' + stageWeight(k)) + '">' + escapeHtml(stageLabel(k)) + '</button>';
            }).join('')
            + '</div>';

        return bankChips + stageChips;
    }

    function renderGantt(){
        var c = byId('dashGanttContainer');
        if (!c) return;
        var b = dashTimeBounds();
        stateDash._range = { start: b.startISO, end: b.endISO, days: b.days || 180 };

        /* Lane tabs */
        var laneTabs = '<div class="dash-lanes">';
        stateDash.lanes.forEach(function(l, i){
            var label = l.draft ? escapeHtml(l.draft.name || '\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a') : (l.task ? escapeHtml(l.task.name || '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430') : '\u041e\u0441\u044c ' + (i+1));
            var active = (i === stateDash.activeLane);
            laneTabs += '<div class="dash-lane-tab' + (active ? ' active' : '') + '" data-lane="' + i + '">'
                + '<span class="dash-lane-label">' + label + '</span>'
                + '</div>';
        });
        if (stateDash.lanes.length < 5) {
            laneTabs += '<button class="dash-lane-add" type="button" id="dashAddLaneBtn" title="\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043e\u0441\u044c">+ \u041e\u0441\u044c</button>';
        }
        laneTabs += '</div>';

        /* Stacked lane blocks */
        var lanesHtml = stateDash.lanes.map(function(l, i){
            var isActive = (i === stateDash.activeLane);
            var d = l.draft;
            var canClose = stateDash.lanes.length > 1;
            var metaHtml = '';
            if (d) {
                metaHtml = '<div class="dash-draft-meta">'
                    + '<input type="text" class="form-control dash-draft-name" data-lane-name="' + i + '" value="' + escapeHtml(d.name || '') + '" placeholder="\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438">'
                    + '<label class="dash-mini-lbl">\u041d\u0430\u0447\u0430\u043b\u043e</label><input type="date" class="form-control dash-draft-date" data-lane-start="' + i + '" value="' + escapeHtml(d.start_date || '') + '">'
                    + '<label class="dash-mini-lbl">\u041a\u043e\u043d\u0435\u0446</label><input type="date" class="form-control dash-draft-date" data-lane-end="' + i + '" value="' + escapeHtml(d.deadline || '') + '">'
                    + '</div>';
            }
            return '<div class="dash-lane-block' + (isActive ? ' active' : '') + '" data-lane-block="' + i + '">'
                + '<div class="dash-lane-bar">'
                + '<span class="dash-lane-badge">\u041e\u0441\u044c ' + (i+1) + '</span>'
                + '<span class="dash-lane-title">' + (d ? escapeHtml(d.name || '\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a') : (l.task ? escapeHtml(l.task.name||'') : '\u043d\u0435\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438')) + '</span>'
                + (canClose ? '<button class="dash-lane-close" type="button" data-lane-close="' + i + '" title="\u0423\u0434\u0430\u043b\u0438\u0442\u044c \u043e\u0441\u044c">\u00d7</button>' : '')
                + '</div>'
                + metaHtml
                + renderLaneBlock(l, i, isActive, b)
                + renderLaneControls(l, i)
                + '</div>';
        }).join('');

        c.innerHTML = laneTabs + lanesHtml;

        /* Drag only on active lane track */
        dashAttachDrag(c);

        /* Lane tab switching */
        c.querySelectorAll('[data-lane]').forEach(function(tab){
            if (!tab.classList.contains('dash-lane-tab')) return;
            tab.addEventListener('click', function(){
                switchLane(+this.getAttribute('data-lane'));
                renderSelector(); syncControls(); renderGantt(); renderLoad();
            });
        });
        c.querySelectorAll('[data-lane-close]').forEach(function(btn){
            btn.addEventListener('click', function(e){
                e.stopPropagation();
                if (removeLane(+this.getAttribute('data-lane-close'))) { renderSelector(); syncControls(); renderGantt(); renderLoad(); }
            });
        });
        var addLaneBtn = byId('dashAddLaneBtn');
        if (addLaneBtn) addLaneBtn.addEventListener('click', function(){
            if (addLane()) { dashOpenCreateModal(); renderSelector(); syncControls(); renderGantt(); renderLoad(); }
        });

        /* Activate a lane block by clicking it (so its controls apply) */
        c.querySelectorAll('[data-lane-block]').forEach(function(bl){
            bl.addEventListener('pointerdown', function(e){
                if (e.target.closest('[data-lane-close]')) return;
                var li = +this.getAttribute('data-lane-block');
                if (li !== stateDash.activeLane) { switchLane(li); renderSelector(); syncControls(); renderGantt(); renderLoad(); }
            }, true);
        });

        /* Meta inputs per lane */
        c.querySelectorAll('[data-lane-name]').forEach(function(inp){
            inp.addEventListener('change', function(){
                var li = +this.getAttribute('data-lane-name'); var L = stateDash.lanes[li];
                if (L && L.draft) { L.draft.name = this.value; if (li===stateDash.activeLane){stateDash.draft.name=this.value;} renderSelector(); }
            });
        });
        c.querySelectorAll('[data-lane-start]').forEach(function(inp){
            inp.addEventListener('change', function(){
                var li=+this.getAttribute('data-lane-start'); var L=stateDash.lanes[li];
                if (!L||!L.draft||!this.value) return;
                L.draft.start_date=this.value; var stg=dashNormalizeStages(L.draft); if(stg.length)stg[0].start=this.value; L.draft.stages=stg;
                switchLane(li); renderGantt(); renderLoad();
            });
        });
        c.querySelectorAll('[data-lane-end]').forEach(function(inp){
            inp.addEventListener('change', function(){
                var li=+this.getAttribute('data-lane-end'); var L=stateDash.lanes[li];
                if (!L||!L.draft||!this.value) return;
                L.draft.deadline=this.value; var stg=dashNormalizeStages(L.draft); if(stg.length)stg[stg.length-1].end=this.value; L.draft.stages=stg;
                switchLane(li); renderGantt(); renderLoad();
            });
        });

        /* Bank chip: left click toggle on/off; right click set/unset lead */
        c.querySelectorAll('[data-toggle-bank]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var depId=this.getAttribute('data-toggle-bank');
                var cur=(stateDash.draft.department_ids||[]).slice();
                var k=cur.indexOf(depId);
                if (k>=0){ cur.splice(k,1); if(stateDash.draft.lead_department===depId) stateDash.draft.lead_department=cur[0]||''; }
                else { cur.push(depId); stateDash.draft.department_shares=stateDash.draft.department_shares||{}; if(stateDash.draft.department_shares[depId]==null)stateDash.draft.department_shares[depId]=100; if(!stateDash.draft.lead_department)stateDash.draft.lead_department=depId; }
                stateDash.draft.department_ids=cur; syncLane(); renderGantt(); renderLoad();
            });
            btn.addEventListener('contextmenu', function(e){
                e.preventDefault();
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var depId=this.getAttribute('data-toggle-bank');
                var cur=(stateDash.draft.department_ids||[]);
                if (cur.indexOf(depId)<0){ notify('\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u043a\u043b\u044e\u0447\u0438\u0442\u0435 \u0431\u0430\u043d\u043a \u0432 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443', 'info'); return; }
                stateDash.draft.lead_department = (stateDash.draft.lead_department===depId)?'':depId;
                syncLane(); renderGantt(); renderLoad();
            });
        });

        /* Stage chip: toggle add/remove (default stage can't be removed) */
        c.querySelectorAll('[data-toggle-stage]').forEach(function(btn){
            btn.addEventListener('click', function(){
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var key=this.getAttribute('data-toggle-stage');
                if (key===DASH_STAGE_KEY_DEFAULT){ notify('\u042d\u0442\u0430\u043f \u00ab\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u041d\u0416\u042f\u00bb \u0431\u0430\u0437\u043e\u0432\u044b\u0439 \u0438 \u0432\u0441\u0435\u0433\u0434\u0430 \u0430\u043a\u0442\u0438\u0432\u0435\u043d', 'info'); return; }
                var stg=dashNormalizeStages(stateDash.draft);
                var pos=stg.map(function(x){return x.key;}).indexOf(key);
                if (pos>=0){ stg.splice(pos,1); }
                else {
                    var ns, ne;
                    if (key === 'подготовка') {
                        var ngStg = stg.filter(function(x){ return x.key === DASH_STAGE_KEY_DEFAULT; })[0];
                        var ngStart = ngStg ? (ngStg.start || stateDash.draft.start_date) : (stateDash.draft.start_date || todayISO());
                        ne = addDaysISO(ngStart, -1);
                        ns = addDaysISO(ne, -6);
                    } else {
                        var lastEnd=stateDash.draft.deadline||stateDash.draft.start_date||todayISO();
                        stg.forEach(function(x){ if((x.end||x.start)>lastEnd) lastEnd=x.end||x.start; });
                        ns=addDaysISO(lastEnd,1); ne=addDaysISO(ns,13);
                    }
                    stg.push({key:key,start:ns,end:ne,weight:stageWeight(key)});
                    if (ne>stateDash.draft.deadline) stateDash.draft.deadline=ne;
                }
                stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad();
            });
        });

        /* Delete-stage button on segment */
        c.querySelectorAll('[data-del]').forEach(function(btn){
            btn.addEventListener('click', function(e){
                e.stopPropagation();
                var li=+this.getAttribute('data-lane'); switchLane(li);
                if (!stateDash.draft) return;
                var idx=+this.getAttribute('data-del');
                var stg=dashNormalizeStages(stateDash.draft);
                if (stg[idx] && stg[idx].key!==DASH_STAGE_KEY_DEFAULT){ stg.splice(idx,1); stateDash.draft.stages=stg; syncLane(); renderGantt(); renderLoad(); }
            });
        });
    }

    function renderLoad(){
        var box = byId('dashLoadContainer');
        if (!box) return;
        var allDeps = st().departments || [];
        if (!allDeps.length) {
            box.innerHTML = '<div class="dash-empty">Справочник банков пуст — данные загружаются…</div>';
            return;
        }
        var hasDraft = !!stateDash.draft;
        var draftDepIds = hasDraft ? (stateDash.draft.department_ids || []).slice() : [];
        var shownDeps = (hasDraft && draftDepIds.length)
            ? allDeps.filter(function(d){ return draftDepIds.indexOf(d.id) >= 0; })
            : allDeps;

        var slots = dashSlots();

        /* (Сводная таблица убрана — дублировала гистограммы) */

        var cards = shownDeps.map(function(dep){
            var depId = dep.id;
            var poss = calcPossible(dep, stateDash.dir);
            var inDraft = draftDepIds.indexOf(depId) >= 0;
            var share = (hasDraft && stateDash.draft.department_shares && stateDash.draft.department_shares[depId] != null)
                ? stateDash.draft.department_shares[depId] : 100;
            var lead = hasDraft && stateDash.draft.lead_department === depId;
            var vals = slots.map(function(slot){
                var base = dashBaseLoad(depId, slot);
                var draft = dashDraftStageLoad(slot.start, slot.end, depId);
                return { slot: slot, total: Math.round((base + draft)*100)/100, base: base, draft: draft };
            });
            var maxVal = vals.reduce(function(m, v){ return Math.max(m, v.total, (poss || 0) * 1.15, 1); }, 1);
            var peakVal = vals.reduce(function(m, v){ return Math.max(m, v.total); }, 0);
            var limPct = (poss !== null && poss > 0) ? Math.max(0, Math.min(100, 100 - (poss / maxVal) * 100)) : null;

            var bars = vals.map(function(v){
                var h = v.total > 0 ? Math.max(8, Math.round((v.total / maxVal) * 108)) : 3;
                var cls = '';
                if (poss !== null) {
                    if (v.total > poss) cls = ' over';
                    else if (v.total > poss * 0.85) cls = ' warn';
                }
                return '<div class="dash-mini-col' + cls + '">'
                    + (limPct === null ? '' : '<div class="dash-mini-redzone" style="height:' + limPct + '%"></div><div class="dash-mini-limit" style="top:' + limPct + '%"></div>')
                    + '<div class="dash-mini-bar" style="height:' + h + 'px" title="' + escapeHtml(v.slot.label + ': ' + fmtNum(v.total) + (poss !== null ? ' / возможно ' + fmtNum(poss) : '')) + '"></div>'
                    + '<div class="dash-mini-cap">' + escapeHtml(v.slot.label) + '</div>'
                    + '</div>';
            }).join('');

            var actionsHtml = '';
            if (hasDraft) {
                if (inDraft) {
                    actionsHtml = '<div class="dash-bank-actions">'
                        + '<button class="btn btn-secondary" type="button" data-act="share" data-dep="' + escapeHtml(depId) + '">Доля (' + escapeHtml(String(share)) + '%)</button>'
                        + '<button class="btn btn-secondary" type="button" data-act="lead" data-dep="' + escapeHtml(depId) + '">' + (lead ? '★ Руководитель (снять)' : 'Назначить руководителем') + '</button>'
                        + '<button class="btn btn-danger" type="button" data-act="remove" data-dep="' + escapeHtml(depId) + '">Удалить из проверки</button>'
                        + '</div>';
                } else {
                    actionsHtml = '<div class="dash-bank-actions">'
                        + '<button class="btn btn-secondary" type="button" data-act="add" data-dep="' + escapeHtml(depId) + '">+ Включить в проверку</button>'
                        + '</div>';
                }
            }

            return '<div class="dash-bank-card' + (inDraft ? ' is-active-bank' : '') + '">'
                + '<div class="dash-bank-head">'
                    + '<div>'
                        + '<div class="dash-bank-name">' + escapeHtml(dep.name) + (lead ? ' <span class="dash-badge-lead">★ Руководитель (' + (stateDash.dir === 'retail' ? '×2' : '×1,5') + ')</span>' : '') + '</div>'
                        + '<div class="dash-bank-meta">' + escapeHtml(DASH_DIR_LABEL[stateDash.dir]) + (inDraft ? (' · в проверке · доля участия ' + escapeHtml(String(share)) + '%') : ' · не входит в выбранную проверку (показана фоновая линия жизни)') + '</div>'
                    + '</div>'
                    + actionsHtml
                + '</div>'
                + '<div class="dash-bank-stats">'
                    + '<div class="dash-stat"><span>Пиковая / текущая нагрузка</span><b>' + fmtNum(peakVal) + '</b></div>'
                    + '<div class="dash-stat"><span>Возможное число проверок (красный лимит)</span><b class="dash-limit-val">' + fmtNum(poss) + '</b></div>'
                + '</div>'
                + '<div class="dash-mini-chart">' + bars + '</div>'
                + '</div>';
        }).join('');

        box.innerHTML = ''
            + '<div class="dash-load-head">'
                + '<div>'
                    + '<div class="dash-load-title">Нагрузка на ТБ (' + escapeHtml(DASH_DIR_LABEL[stateDash.dir]) + ' направление · ' + (stateDash.mode === 'day' ? 'по дням' : 'по неделям') + ')</div>'
                    + '<div class="dash-load-sub">Красная пунктирная линия и розовая зона сверху = предел возможного числа проверок (норматив × экспертный коэф.). Нагрузка банка-руководителя: розн ×2, корп ×1,5.</div>'
                + '</div>'
            + '</div>'
            + '<div class="dash-bank-grid">' + cards + '</div>';

        box.querySelectorAll('[data-act]').forEach(function(btn){
            btn.onclick = function(){
                var depId = this.getAttribute('data-dep');
                var act = this.getAttribute('data-act');
                if (!stateDash.draft) return;
                if (act === 'add') {
                    var cur = (stateDash.draft.department_ids || []).slice();
                    if (cur.indexOf(depId) < 0) cur.push(depId);
                    stateDash.draft.department_ids = cur;
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    if (stateDash.draft.department_shares[depId] == null) stateDash.draft.department_shares[depId] = 100;
                    if (!stateDash.draft.lead_department) stateDash.draft.lead_department = depId;
                } else if (act === 'remove') {
                    stateDash.draft.department_ids = (stateDash.draft.department_ids || []).filter(function(id){ return id !== depId; });
                    if (stateDash.draft.lead_department === depId) {
                        stateDash.draft.lead_department = stateDash.draft.department_ids[0] || '';
                    }
                } else if (act === 'lead') {
                    stateDash.draft.lead_department = (stateDash.draft.lead_department === depId) ? '' : depId;
                } else if (act === 'share') {
                    var curSh = (stateDash.draft.department_shares && stateDash.draft.department_shares[depId] != null)
                        ? stateDash.draft.department_shares[depId] : 100;
                    var val = window.prompt('Доля участия банка в проверке (%):', String(curSh));
                    if (val === null) return;
                    var n = Number(String(val).replace(',', '.'));
                    if (!isFinite(n) || n <= 0) { notify('Введите число больше 0', 'error'); return; }
                    stateDash.draft.department_shares = stateDash.draft.department_shares || {};
                    stateDash.draft.department_shares[depId] = Math.round(n * 100) / 100;
                }
                renderGantt();
                renderLoad();
            };
        });
    }

    function saveDraft(){
        if (!stateDash.draft) { notify('Сначала выберите проверку или нажмите «+ Создать проверку»', 'error'); return; }
        var d = stateDash.draft;
        var nameVal = (d.name || '').trim();
        if (!nameVal) {
            var asked = window.prompt('Введите название проверки:', 'Новая проверка');
            if (!asked || !asked.trim()) { notify('Название проверки обязательно', 'error'); return; }
            nameVal = asked.trim();
            d.name = nameVal;
        }
        if (!(d.department_ids || []).length) {
            notify('Добавьте хотя бы один банк-участник (кликните по банку в плашке «Банки в проверке»)', 'error');
            return;
        }
        if (!d.lead_department || d.department_ids.indexOf(d.lead_department) < 0) {
            d.lead_department = d.department_ids[0];
        }
        var normStages = dashNormalizeStages(d);
        var stageStarts = {};
        var prevDate = '';
        normStages.forEach(function(s){
            if (!s.key || !s.start) return;
            var dt = s.start;
            if (prevDate && dt <= prevDate) dt = addDaysISO(prevDate, 1);
            stageStarts[s.key] = dt;
            prevDate = dt;
        });

        var orig = stateDash.task ? (st().tasks || []).find(function(t){ return t.id === stateDash.task.id; }) : null;
        var base = orig ? clone(orig) : {};
        var payload = {
            id: d.id || (base.id || ''),
            name: nameVal,
            icon: base.icon || '📋',
            description: base.description || '',
            status: base.status || 'active',
            start_date: d.start_date || todayISO(),
            deadline: d.deadline || addDaysISO(d.start_date || todayISO(), 90),
            completed_at: base.completed_at || '',
            folder: base.folder || '',
            order_ref: base.order_ref || '',
            tags: (base.tags || []).slice(),
            assignees: (base.assignees || base.assignee_ids || []).slice(),
            department_ids: (d.department_ids || []).slice(),
            task_kind: 'audit',
            load_coef: base.load_coef || 0,
            lead_department: d.lead_department || '',
            lead_employee: base.lead_employee || '',
            is_urgent: !!base.is_urgent,
            links: (base.links || []).slice(),
            orders: (base.orders || []).slice(),
            task_type: d.task_type || base.task_type || (stateDash.dir !== 'all' ? dirTaskType(stateDash.dir) : 'розничная'),
            pocket: (d.pocket !== undefined && d.pocket !== null && d.pocket !== '') ? d.pocket : (base.pocket || ''),
            department_shares: clone(d.department_shares || {}),
            stages: stageStarts,
            force_duplicate: true
        };
        var btn = byId('dashSaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
        apiJson('/api/tracker/task/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(r){
            if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'Ошибка сохранения');
            var savedId = r.id || payload.id;
            notify('✅ Проверка сохранена в БД', 'success');
            var refreshFn = window.__trkRefreshAll || window.__trkLoadState;
            return (typeof refreshFn === 'function' ? Promise.resolve(refreshFn()) : Promise.resolve()).then(function(){
                var nt = (st().tasks || []).find(function(t){ return t.id === savedId; });
                if (nt) loadDraft(nt);
                else { renderSelector(); renderGantt(); renderLoad(); }
            });
        })
        .catch(function(err){
            notify('❌ ' + ((err && err.message) || 'Ошибка сохранения'), 'error');
        })
        .then(function(){
            var b2 = byId('dashSaveBtn');
            if (b2) { b2.disabled = false; b2.textContent = 'Сохранить изменения'; }
        });
    }

    function bindControls(){
        var btn = byId('tabDashboardsBtn');
        if (btn && !btn.__dashBound) {
            btn.__dashBound = true;
            btn.addEventListener('click', function(e){
                e.preventDefault();
                activateDashboardsTab();
            });
        }
        var sel = byId('dashTaskSelector');
        if (sel && !sel.__dashBound) {
            sel.__dashBound = true;
            sel.addEventListener('focus', function(){ renderSelector(); });
            sel.addEventListener('change', function(){
                var tid = this.value;
                if (!tid) { loadDraft(null); return; }
                if (tid === '__new__') return;
                var task = (st().tasks || []).find(function(x){ return x.id === tid; });
                loadDraft(task || null);
            });
        }
        var createBtn = byId('dashCreateTaskBtn');
        if (createBtn && !createBtn.__dashBound) {
            createBtn.__dashBound = true;
            createBtn.addEventListener('click', function(e){
                e.preventDefault();
                dashOpenCreateModal();
            });
        }
        var dirBox = byId('dashDirSwitch');
        if (dirBox && !dirBox.__dashBound) {
            dirBox.__dashBound = true;
            dirBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-dir]') : null;
                if (!b) return;
                stateDash.dir = b.getAttribute('data-dir') || 'all';
                // Сброс выбранной проверки, если её направление не совпадает с фильтром
                if (stateDash.task && !dashDirMatch(stateDash.task)) {
                    stateDash.task = null; stateDash.draft = null;
                    var l = stateDash.lanes[stateDash.activeLane]; if (l) { l.task = null; l.draft = null; }
                }
                // task_type драфта подстраиваем только для конкретного направления
                if (stateDash.draft && stateDash.dir !== 'all') stateDash.draft.task_type = dirTaskType(stateDash.dir);
                syncControls();
                renderSelector();
                renderGantt();
                renderLoad();
            });
        }
        var modeBox = byId('dashModeSwitch');
        if (modeBox && !modeBox.__dashBound) {
            modeBox.__dashBound = true;
            modeBox.addEventListener('click', function(e){
                var b = e.target && e.target.closest ? e.target.closest('[data-mode]') : null;
                if (!b) return;
                stateDash.mode = b.getAttribute('data-mode') || 'medium';
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var slider = byId('dashTodaySlider');
        if (slider && !slider.__dashBound) {
            slider.__dashBound = true;
            slider.addEventListener('input', function(){
                stateDash.todayOffset = +this.value || 0;
                syncControls();
                renderGantt();
                renderLoad();
            });
        }
        var saveBtn = byId('dashSaveBtn');
        if (saveBtn && !saveBtn.__dashBound) {
            saveBtn.__dashBound = true;
            saveBtn.addEventListener('click', function(e){
                e.preventDefault();
                saveDraft();
            });
        }
    }

    var _waitCount = 0;
    function waitStateAndRefresh(){
        var hasData = (st().tasks && st().tasks.length) || (st().departments && st().departments.length);
        if (hasData) {
            renderSelector();
            syncControls();
            renderGantt();
            renderLoad();
            return;
        }
        if (_waitCount++ < 35) {
            setTimeout(waitStateAndRefresh, 300);
        }
    }

    function boot(){
        ensureDashboardsTab();
        bindControls();
        renderSelector();
        syncControls();
        renderGantt();
        renderLoad();
        waitStateAndRefresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    document.addEventListener('click', function(e){
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="dashboards"]')) {
            setTimeout(function(){
                bindControls();
                renderSelector();
                syncControls();
                renderGantt();
                renderLoad();
            }, 40);
        }
    });
})()