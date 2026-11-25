/* tracker/yearplan.js — вкладка «Годовой план» (эксперимент, параллельно Песочнице).
   Все карманы года на одной шкале: группировка направление → карман (общие карманы отдельно),
   у кармана столько осей, сколько в плане; черновики бледные; нагрузка и тепловая карта ТБ.
   Сохранение как в Песочнице: список правок → подтверждение → POST /api/tracker/task/save
   (новые проверки получают статус «Планирование»). Грузится после tabs.js. */
(function(){
'use strict';
var DAY = 864e5;
var STAGE_ORDER = ['подготовка','проверка_нжя','проверка_соглЦА','ос_проф','реализация_возражения','реализация_согласования','запас','оценка_тб'];
var STAGE_LABELS = {'подготовка':'Подготовка','проверка_нжя':'Проверка НЖЯ','проверка_соглЦА':'Проверка соглЦА','ос_проф':'ОС проф','реализация_возражения':'Реализация возражения','реализация_согласования':'Реализация согласования','запас':'Запас','оценка_тб':'Оценка ТБ'};
var STAGE_SHORT = {'подготовка':'Подг','проверка_нжя':'НЖЯ','проверка_соглЦА':'СоглЦА','ос_проф':'ОС','реализация_возражения':'Возр','реализация_согласования':'Согл','запас':'Запас','оценка_тб':'Оценка'};
var STAGE_COLORS = {'подготовка':'#5dade2','проверка_нжя':'#48c9b0','проверка_соглЦА':'#58d68d','ос_проф':'#f4d03f','реализация_возражения':'#eb984e','реализация_согласования':'#e59866','запас':'#af7ac5','оценка_тб':'#ec7063'};
var STAGE_WEIGHTS = {'подготовка':0.7,'проверка_нжя':1.0,'проверка_соглЦА':1.0,'ос_проф':0.0,'реализация_возражения':1.0,'реализация_согласования':0.5,'запас':0.5,'оценка_тб':0.0};
var STL = { planning:'Планирование', approved:'Утверждена', active:'Активна', done:'Завершена', cancelled:'Отменена' };
var APPROVED = { approved:1, active:1, done:1 };
var DIRS = { corp:{ tt:'корпоративная', t:'Корпоративное направление', ic:'🔵', s:'корп' }, retail:{ tt:'розничная', t:'Розничное направление', ic:'🔴', s:'розн' } };
var TT2DIR = { 'корпоративная':'corp', 'розничная':'retail' };
/* Регламентированные сокращения ТБ (11 банков); порядок — порядок строк тепловой карты */
var BANK_RULES = [[/байкал/,'ББ'],[/волго/,'ВВБ'],[/дальн/,'ДВБ'],[/моск/,'МБ'],[/поволж/,'ПБ'],[/северо/,'СЗБ'],[/сибир/,'СибБ'],[/среднерус/,'СрБ'],[/урал/,'УБ'],[/черноз/,'ЦЧБ'],[/юго/,'ЮЗБ']];
var MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
var MONTHS_G = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var HOT = 3;            // столько одновременных проверок у банка в месяце — подсветка «узкого места»
var NEW_PREP_DAYS = 14, NEW_NZH_DAYS = 42;   // новая проверка: подготовка 14 дн + проверка НЖЯ 6 недель

function st(){ return window.__trkState || { tasks:[], departments:[] }; }
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function clone(x){ return JSON.parse(JSON.stringify(x == null ? null : x)); }
function notify(m, k){ if (window.trkNotify) window.trkNotify(m, k || 'info'); else if (window.__trackerNotify) window.__trackerNotify(m, k || 'info'); }
function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }
function fnum(v){ return String(Math.round(v * 10) / 10).replace('.', ','); }
function plw(n, f){ n = Math.abs(n); var a = n % 10, b = n % 100; if (a === 1 && b !== 11) return f[0]; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1]; return f[2]; }
function api(url, body){
    var o = { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: {} };
    if (body) {
        o.headers['Content-Type'] = 'application/json';
        var c = window.REESTR_CSRF || ((document.querySelector('meta[name="csrf-token"]') || {}).content) || '';
        if (c) o.headers['X-CSRF-Token'] = c;
        o.body = JSON.stringify(body);
    }
    return fetch(url, o).then(function(r){ return r.json().catch(function(){ return { success:false, error:'HTTP ' + r.status }; }); });
}

/* ---------- даты: номер дня от 1 января планового года ---------- */
var YEAR = 2027;                 // плановый год вкладки
var EDIT_UNTIL = '2026-12-31';   // после этой даты вкладка скрывается (далее — «Сравнить план и факт за 2027», ещё не реализовано)
function todayIso(){ var n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }
function editable(){ return todayIso() <= EDIT_UNTIL || /[?&]yp_force=1/.test(location.search); }
var Y0 = Date.UTC(YEAR, 0, 1), NDAYS = Math.round((Date.UTC(YEAR + 1, 0, 1) - Y0) / DAY);
function dn(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Y0) / DAY) : null; }
function iso(n){ return new Date(Y0 + n * DAY).toISOString().slice(0, 10); }
function fmt(s){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? m[3] + '.' + m[2] + (+m[1] !== YEAR ? '.' + m[1].slice(2) : '') : '—'; }
function pct(n){ return Math.max(0, Math.min(NDAYS, n)) / NDAYS * 100; }
function mStart(m){ return Math.round((Date.UTC(YEAR, m, 1) - Y0) / DAY); }
/* Сезоны строго по календарю: зима — декабрь–февраль, весна — март–май, лето — июнь–август, осень — сентябрь–ноябрь */
var SEASONS = [
    { a:0, b:mStart(2), t:'❄ Зима', q:1, v:'--yp-s-w' }, { a:mStart(2), b:mStart(5), t:'🌱 Весна', q:2, v:'--yp-s-sp' },
    { a:mStart(5), b:mStart(8), t:'☀ Лето', q:3, v:'--yp-s-su' }, { a:mStart(8), b:mStart(11), t:'🍂 Осень', q:4, v:'--yp-s-au' },
    { a:mStart(11), b:NDAYS, t:'❄ Зима', q:1, v:'--yp-s-w' }
];
function gridBg(){
    var lines = [];
    for (var m = 1; m < 12; m++) {
        var p = pct(mStart(m)).toFixed(3), c = (m % 3 === 2) ? 'var(--yp-sline)' : 'var(--yp-mline)';
        lines.push('transparent calc(' + p + '% - 1px)', c + ' calc(' + p + '% - 1px)', c + ' ' + p + '%', 'transparent ' + p + '%');
    }
    var seas = [];
    SEASONS.forEach(function(s){ seas.push('var(' + s.v + ') ' + pct(s.a).toFixed(3) + '%', 'var(' + s.v + ') ' + pct(s.b).toFixed(3) + '%'); });
    return 'linear-gradient(90deg,transparent 0%,' + lines.join(',') + ',transparent 100%),linear-gradient(90deg,' + seas.join(',') + ')';
}

/* ---------- банки ---------- */
function bankRule(dep){ var n = String((dep && dep.name) || '').toLowerCase(); for (var i = 0; i < BANK_RULES.length; i++) if (BANK_RULES[i][0].test(n)) return i; return -1; }
function abbr(dep){
    if (!dep) return '?';
    var i = bankRule(dep); if (i >= 0) return BANK_RULES[i][1];
    var s = String(dep.short_name || '').trim(); if (/^[A-Za-zА-Яа-яЁё]{1,5}$/.test(s)) return s;
    return String(dep.name || '').split(/[\s\-]+/).filter(Boolean).map(function(p){ return p[0].toUpperCase(); }).join('').slice(0, 4) || '?';
}
function deps(){
    return (st().departments || []).slice().sort(function(a, b){
        var x = bankRule(a), y = bankRule(b); x = x < 0 ? 99 : x; y = y < 0 ? 99 : y;
        return x - y || String(a.name).localeCompare(String(b.name), 'ru');
    });
}
function depById(id){ return (st().departments || []).filter(function(d){ return d.id === id; })[0] || null; }
function possible(dep, d){
    var n = d === 'retail' ? dep.headcount_retail : dep.headcount_corp, c = d === 'retail' ? dep.expert_coef_retail : dep.expert_coef_corp;
    if (n == null || n === '' || c == null || c === '') return 0;
    return num(n) * num(c);
}

/* ---------- модель: проверка = { key, id, orig, isNew, name, task_type, pocket, status, stages[], department_ids, lead_department } ---------- */
var S = {
    dir: 'all', collapsed: {}, pockets: [], pocketsLoaded: false, pocketsErr: '',
    drafts: {}, seq: 0, editKey: null, scope: 'all', withDrafts: true, heatPinned: false, drag: null
};
try { S.dir = localStorage.getItem('yp.dir') || 'all'; S.collapsed = JSON.parse(localStorage.getItem('yp.collapsed') || '{}') || {}; S.heatPinned = localStorage.getItem('yp.heat') === '1'; } catch (e) {}
function saveUi(){ try { localStorage.setItem('yp.dir', S.dir); localStorage.setItem('yp.collapsed', JSON.stringify(S.collapsed)); localStorage.setItem('yp.heat', S.heatPinned ? '1' : '0'); } catch (e) {} }

function normStages(t){
    var out = [];
    (Array.isArray(t.stages) ? t.stages : []).forEach(function(s){
        if (s && s.start && STAGE_ORDER.indexOf(s.key) >= 0) out.push({ key:s.key, start:s.start, end:(s.end && s.end >= s.start) ? s.end : s.start });
    });
    out.sort(function(a, b){ return STAGE_ORDER.indexOf(a.key) - STAGE_ORDER.indexOf(b.key); });
    if (!out.length) {
        var a = t.start_date || iso(31), b = t.deadline || a; if (b < a) b = a;
        out = [{ key:'проверка_нжя', start:a, end:b }];
    }
    return out;
}
function fromTask(t){
    return { key:String(t.id), id:String(t.id), orig:t, isNew:false, name:t.name || '', task_type:t.task_type || '',
             pocket:String(t.pocket || '').trim(), status:t.status || 'planning', stages:normStages(t),
             department_ids:(t.department_ids || []).slice(), department_shares:clone(t.department_shares || {}) || {},
             lead_department:t.lead_department || '' };
}
function leadOf(it){ var l = it.lead_department; return (l && it.department_ids.indexOf(l) >= 0) ? l : (it.department_ids[0] || ''); }
function sig(it){ return JSON.stringify([String(it.name).trim(), it.stages.map(function(s){ return [s.key, s.start, s.end]; }), it.department_ids.slice().sort(), leadOf(it)]); }
function isDirty(it){ return it.isNew || (!!S.drafts[it.key] && sig(it) !== sig(fromTask(it.orig))); }
function kindOf(it){ return it.isNew ? 'new' : (APPROVED[it.status] ? 'ok' : 'plan'); }
function tStart(it){ return it.stages[0].start; }
function tEnd(it){ return it.stages[it.stages.length - 1].end; }
function isAudit(t){ return (t.task_kind || 'audit') === 'audit'; }
function isLive(t){ return t.status !== 'cancelled' && t.status !== 'archived'; }
function findTask(id){ return (st().tasks || []).filter(function(t){ return String(t.id) === String(id); })[0] || null; }

/* проверки планового года (по дате начала, как факт в «Карманах») */
function rowItems(){
    var out = [];
    (st().tasks || []).forEach(function(t){
        if (!isAudit(t) || !isLive(t) || String(t.start_date || '').slice(0, 4) !== String(YEAR)) return;
        out.push(S.drafts[String(t.id)] || fromTask(t));
    });
    Object.keys(S.drafts).forEach(function(k){ if (S.drafts[k].isNew) out.push(S.drafts[k]); });
    return out;
}
/* всё, что даёт нагрузку в плановом году: проверки (в т.ч. переходящие с прошлого года) и прочие задачи */
function loadItems(){
    var out = [];
    (st().tasks || []).forEach(function(t){
        if (!isLive(t)) return;
        var it = S.drafts[String(t.id)] || fromTask(t);
        if (dn(tEnd(it)) < 0 || dn(tStart(it)) > NDAYS - 1) return;
        out.push({ it:it, t:t, audit:isAudit(t), kind:kindOf(it), coef:isAudit(t) ? 1 : (num(t.load_coef) > 0 ? num(t.load_coef) : 1) });
    });
    Object.keys(S.drafts).forEach(function(k){ var d = S.drafts[k]; if (d.isNew) out.push({ it:d, t:null, audit:true, kind:'new', coef:1 }); });
    return out;
}
function dirOk(it){ if (S.dir === 'all') return true; return TT2DIR[it.task_type] === S.dir; }
function getItem(key){
    if (S.drafts[key]) return S.drafts[key];
    var t = findTask(key); return t ? fromTask(t) : null;
}
function ensureDraft(key){
    if (!S.drafts[key]) { var t = findTask(key); if (!t) return null; S.drafts[key] = fromTask(t); }
    return S.drafts[key];
}

/* ---------- карманы ---------- */
function nkey(s){ return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function loadPockets(){
    return api('/api/plugins/pockets/data?year=' + YEAR).then(function(d){
        if (d && d.success) { S.pockets = d.pockets || []; S.pocketsErr = ''; }
        else { S.pockets = []; S.pocketsErr = (d && d.error) || 'нет данных'; }
        S.pocketsLoaded = true;
    }).catch(function(){ S.pockets = []; S.pocketsErr = 'плагин «Карманы» недоступен'; S.pocketsLoaded = true; });
}
function sharedMap(){
    var by = {}, out = {};
    S.pockets.forEach(function(p){ if (!p.is_active) return; var k = nkey(p.name); by[k] = by[k] || {}; by[k][p.direction] = 1; });
    Object.keys(by).forEach(function(k){ if (by[k]['корпоративная'] && by[k]['розничная']) out[k] = 1; });
    return out;
}
function buildGroups(){
    var its = rowItems(), map = {}, list = [], sh = sharedMap();
    S.pockets.slice().sort(function(a, b){ return (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), 'ru'); }).forEach(function(p){
        var d = TT2DIR[p.direction]; if (!d) return;
        var g = { gkey:d + '|' + nkey(p.name), dir:d, name:p.name, plan:(p.plan_count == null || p.plan_count === '') ? null : +p.plan_count,
                  pocket:p, items:[], shared:!!sh[nkey(p.name)], active:!!p.is_active };
        if (map[g.gkey]) return; map[g.gkey] = g; list.push(g);
    });
    its.forEach(function(it){
        var d = TT2DIR[it.task_type] || '', g = map[d + '|' + nkey(it.pocket)];
        if (!g || !it.pocket) {
            var k = d + '|' + (it.pocket ? '?' + nkey(it.pocket) : '-');
            g = map[k];
            if (!g) { g = { gkey:k, dir:d, name:it.pocket || 'Без кармана', plan:null, pocket:null, items:[], shared:false, unknown:!!it.pocket, nopocket:!it.pocket, active:true }; map[k] = g; list.push(g); }
        }
        g.items.push(it);
    });
    var rank = { ok:0, plan:1, 'new':2 };
    list.forEach(function(g){
        g.items.sort(function(a, b){ return rank[kindOf(a)] - rank[kindOf(b)] || (a.isNew && b.isNew ? (a.seq - b.seq) : (tStart(a) < tStart(b) ? -1 : tStart(a) > tStart(b) ? 1 : 0)); });
        g.cnt = { ok:0, plan:0, 'new':0 }; g.items.forEach(function(it){ g.cnt[kindOf(it)]++; });
        g.empty = g.plan == null ? 0 : Math.max(0, g.plan - g.items.length);
    });
    return list.filter(function(g){ return g.active || g.items.length; });
}
function sections(groups){
    var out = [];
    ['corp', 'retail'].forEach(function(d){
        if (S.dir !== 'all' && S.dir !== d) return;
        out.push({ skey:'s:' + d, title:DIRS[d].ic + ' ' + DIRS[d].t, dir:d, groups:groups.filter(function(g){ return g.dir === d && (S.dir !== 'all' || !g.shared) && !g.unknown && !g.nopocket; })
                   .concat(groups.filter(function(g){ return g.dir === d && (g.unknown || g.nopocket); })) });
    });
    if (S.dir === 'all') {
        var sh = groups.filter(function(g){ return g.shared; }).sort(function(a, b){ return nkey(a.name).localeCompare(nkey(b.name), 'ru') || (a.dir === 'corp' ? -1 : 1); });
        if (sh.length) out.push({ skey:'s:shared', title:'⇄ Общие карманы', shared:true, groups:sh });
        var nd = groups.filter(function(g){ return g.dir === ''; });
        if (nd.length) out.push({ skey:'s:nodir', title:'⚪ Без направления', groups:nd });
    }
    return out;
}

/* ---------- нагрузка ---------- */
function stageW(k){ return STAGE_WEIGHTS[k] == null ? 1 : STAGE_WEIGHTS[k]; }
function leadMult(it, bank){ if (leadOf(it) !== bank) return 1; return it.task_type === 'розничная' ? 2 : it.task_type === 'корпоративная' ? 1.5 : 1; }
function shareMult(it, bank){ var v = (it.department_shares || {})[bank]; if (v == null || v === '') return 1; v = Number(v); return isFinite(v) && v > 0 ? v / 100 : 1; }
/* множество проверок «в разрезе»: все или выбранный карман */
function inScope(it){
    if (S.scope === 'all') return dirOk(it);
    var p = S.scope.split('|'); return (TT2DIR[it.task_type] || '') === p[0] && nkey(it.pocket) === p[1];
}
function scopeTitle(){
    if (S.scope === 'all') return S.dir === 'all' ? 'все проверки' : 'все проверки · ' + DIRS[S.dir].s;
    var p = S.scope.split('|'), g = buildGroups().filter(function(x){ return x.gkey === S.scope; })[0];
    return 'карман «' + (g ? g.name : p[1]) + '» · ' + (DIRS[p[0]] ? DIRS[p[0]].s : '');
}
function monthLoad(){
    var L = loadItems(), res = [];
    var dirs = S.scope !== 'all' ? [S.scope.split('|')[0]] : (S.dir === 'all' ? ['corp', 'retail'] : [S.dir]);
    var cap = 0; deps().forEach(function(d){ dirs.forEach(function(x){ cap += possible(d, x); }); });
    for (var m = 0; m < 12; m++) res.push({ ok:0, plan:0, other:0, days:mStart(m + 1 > 11 ? 11 : m + 1) });
    L.forEach(function(x){
        var it = x.it;
        if (x.audit) { if (!inScope(it)) return; if (!S.withDrafts && x.kind !== 'ok') return; }
        else { if (S.scope !== 'all') return; if (S.dir !== 'all' && TT2DIR[it.task_type] && TT2DIR[it.task_type] !== S.dir) return; }
        var slot = !x.audit ? 'other' : (x.kind === 'ok' ? 'ok' : 'plan');
        var banks = it.department_ids.length ? it.department_ids : [];
        it.stages.forEach(function(s){
            var a = Math.max(0, dn(s.start)), b = Math.min(NDAYS - 1, dn(s.end)); if (b < a) return;
            var w = x.audit ? stageW(s.key) : x.coef; if (!w) return;
            for (var m = 0; m < 12; m++) {
                var ma = mStart(m), mb = (m === 11 ? NDAYS : mStart(m + 1)) - 1;
                var ov = Math.min(b, mb) - Math.max(a, ma) + 1; if (ov <= 0) continue;
                var f = ov / (mb - ma + 1), sum = 0;
                banks.forEach(function(bk){ sum += w * (x.audit ? leadMult(it, bk) * shareMult(it, bk) : 1); });
                res[m][slot] += sum * f;
            }
        });
    });
    return { months:res, cap:cap };
}
/* тепловая карта: сколько проверок одновременно идёт у банка в месяце */
function heatData(){
    var D = deps(), idx = {}, grid = [];
    D.forEach(function(d, i){ idx[d.id] = i; var r = []; for (var m = 0; m < 12; m++) r.push({ n:0, names:[], cur:false }); grid.push(r); });
    var cur = S.drag ? S.drag.key : S.editKey;
    loadItems().forEach(function(x){
        if (!x.audit || !inScope(x.it)) return;
        if (!S.withDrafts && x.kind !== 'ok') return;
        var it = x.it, a = Math.max(0, dn(tStart(it))), b = Math.min(NDAYS - 1, dn(tEnd(it)));
        if (b < a) return;
        for (var m = 0; m < 12; m++) {
            var ma = mStart(m), mb = (m === 11 ? NDAYS : mStart(m + 1)) - 1;
            if (b < ma || a > mb) continue;
            it.department_ids.forEach(function(bk){
                var i = idx[bk]; if (i == null) return;
                var c = grid[i][m]; c.n++; c.names.push(it.name || 'без названия'); if (it.key === cur) c.cur = true;
            });
        }
    });
    return { deps:D, grid:grid };
}

/* ---------- отрисовка ---------- */
function panel(){ return $('panel-yearplan'); }
function head(){
    var hd = '';
    hd += '<div class="yp-tb">'
        + '<button class="yp-btn yp-back" data-yp="back" title="Вернуться к планированию проверок">←</button>'
        + '<div class="yp-title">📆 Годовой план ' + YEAR + ' <span class="yp-exp">эксперимент</span></div>'
        + '<span class="yp-seg">' + [['all','Все'],['corp','Корпоративное'],['retail','Розничное']].map(function(d){
            return '<button data-yp="dir" data-v="' + d[0] + '" class="' + (S.dir === d[0] ? 'on' : '') + '">' + d[1] + '</button>'; }).join('') + '</span>'
        + '<button class="yp-btn" data-yp="pockets" title="Справочник карманов и планы на ' + YEAR + ' год (окно поверх вкладки)">✏️ Карманы ' + YEAR + '</button>'
        + '<button class="yp-btn" data-yp="expand" title="Развернуть все карманы">⊞</button>'
        + '<button class="yp-btn" data-yp="collapse" title="Свернуть все карманы">⊟</button>'
        + '<button class="yp-btn' + (S.heatPinned ? ' on' : '') + '" data-yp="heat" title="Тепловая карта ТБ: число одновременных проверок по месяцам">🔥 ТБ</button>'
        + '<span class="yp-sp"></span>'
        + '<span class="yp-dirty" id="ypDirty"></span>'
        + '<button class="yp-btn" data-yp="reset" id="ypReset" title="Отменить все несохранённые изменения">Отменить</button>'
        + '<button class="yp-btn yp-save" data-yp="save" id="ypSave">Сохранить изменения</button>'
        + '</div>';
    return hd;
}
function scaleHtml(){
    var s = '<div class="yp-row yp-scale"><div class="yp-lab yp-lab--scale"><span class="yp-legend"><i class="k-ok"></i>утверждена <i class="k-plan"></i>планирование <i class="k-new"></i>не сохранена</span></div><div class="yp-trk yp-trk--scale">';
    SEASONS.forEach(function(x){ s += '<div class="yp-season" style="left:' + pct(x.a) + '%;width:' + (pct(x.b) - pct(x.a)) + '%;background:var(' + x.v + '-h)" title="' + x.t.slice(2) + ' — ' + x.q + ' квартал"><span>' + x.t + (x.b - x.a > 40 ? ' · ' + x.q + ' кв' : '') + '</span></div>'; });
    s += '</div></div><div class="yp-row yp-scale yp-scale--m"><div class="yp-lab yp-lab--scale"></div><div class="yp-trk yp-trk--scale">';
    for (var m = 0; m < 12; m++) {
        var a = mStart(m), b = m === 11 ? NDAYS : mStart(m + 1);
        s += '<div class="yp-month' + (m % 2 ? ' odd' : '') + '" style="left:' + pct(a) + '%;width:' + (pct(b) - pct(a)) + '%">' + MONTHS[m] + '</div>';
    }
    s += '</div></div>';
    return s;
}
function seasonQuarter(m){ return [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 1][m]; }
function barsHtml(it, kind, mini){
    var h = '';
    it.stages.forEach(function(s, i){
        var a = dn(s.start), b = dn(s.end) + 1;
        if (b <= 0 || a >= NDAYS) return;
        var l = pct(a), w = Math.max(0.25, pct(b) - pct(a));
        var cutL = a < 0, cutR = b > NDAYS;
        h += '<div class="yp-bar k-' + kind + (cutL ? ' cutl' : '') + (cutR ? ' cutr' : '') + '" data-key="' + esc(it.key) + '" data-si="' + i + '" style="left:' + l + '%;width:' + w + '%;--c:' + (STAGE_COLORS[s.key] || '#94a3b8') + '"'
            + ' title="' + esc((it.name || 'Без названия') + '\n' + (STAGE_LABELS[s.key] || s.key) + ': ' + fmt(s.start) + ' – ' + fmt(s.end) + ' (' + (dn(s.end) - dn(s.start) + 1) + ' дн)' + '\nСтатус: ' + (it.isNew ? 'не сохранена' : (STL[it.status] || it.status))) + '">'
            + (mini ? '' : '<span>' + esc(STAGE_SHORT[s.key] || '') + '</span>') + (mini || cutR ? '' : '<b class="yp-rz" data-rz="1"></b>') + '</div>';
    });
    return h;
}
function rowHtml(it, g){
    var k = kindOf(it), ed = S.editKey === it.key, dirty = isDirty(it);
    var banks = it.department_ids.map(function(id){ var d = depById(id); return '<i class="' + (id === leadOf(it) ? 'lead' : '') + '">' + esc(abbr(d)) + '</i>'; }).join('');
    var h = '<div class="yp-row yp-item k-' + k + (ed ? ' edit' : '') + '" data-key="' + esc(it.key) + '">'
        + '<div class="yp-lab" data-yp="edit" title="' + esc((it.name || 'Без названия') + ' — ' + (it.isNew ? 'не сохранена' : (STL[it.status] || it.status)) + '\nНажмите, чтобы редактировать этапы и банки') + '">'
        + '<span class="yp-dot k-' + k + '"></span><span class="yp-nm">' + esc(it.name || 'Без названия') + '</span>'
        + (dirty ? '<span class="yp-mod" title="Есть несохранённые изменения">●</span>' : '')
        + '<span class="yp-bk">' + (banks || '<em>нет ТБ</em>') + '</span></div>'
        + '<div class="yp-trk" style="background-image:' + GRID + '">' + barsHtml(it, k) + '</div></div>';
    if (ed) h += editorHtml(it);
    return h;
}
function editorHtml(it){
    var have = {}; it.stages.forEach(function(s){ have[s.key] = 1; });
    var st0 = '<div class="yp-ed-g"><span class="yp-ed-l">Этапы</span>' + STAGE_ORDER.map(function(k){
        return '<button class="yp-chip' + (have[k] ? ' on' : '') + '" data-yp="stage" data-v="' + k + '" style="--c:' + STAGE_COLORS[k] + '" title="' + esc(STAGE_LABELS[k]) + (have[k] ? ' — убрать этап' : ' — добавить этап (2 недели)') + '">' + esc(STAGE_SHORT[k]) + '</button>'; }).join('') + '</div>';
    var bk = '<div class="yp-ed-g"><span class="yp-ed-l">ТБ</span>' + deps().map(function(d){
        var on = it.department_ids.indexOf(d.id) >= 0, ld = on && leadOf(it) === d.id;
        return '<button class="yp-chip yp-chip--b' + (on ? ' on' : '') + (ld ? ' lead' : '') + '" data-yp="bank" data-v="' + esc(d.id) + '" title="' + esc(d.name) + (on ? (ld ? ' — руководитель' : ' — участник') + ' (клик убирает банк)' : ' — добавить банк') + '">' + (ld ? '★' : '') + esc(abbr(d)) + '</button>'; }).join('')
        + (it.department_ids.length > 1 ? '<label class="yp-lead">★ <select data-yp="lead" title="Банк-руководитель">' + it.department_ids.map(function(id){ return '<option value="' + esc(id) + '"' + (id === leadOf(it) ? ' selected' : '') + '>' + esc(abbr(depById(id))) + '</option>'; }).join('') + '</select></label>' : '')
        + '</div>';
    var dates = it.stages.map(function(s){ return '<span class="yp-ed-st" style="--c:' + STAGE_COLORS[s.key] + '"><b>' + esc(STAGE_SHORT[s.key]) + '</b> ' + fmt(s.start) + '–' + fmt(s.end) + ' · ' + fnum((dn(s.end) - dn(s.start) + 1) / 7) + ' нед</span>'; }).join('');
    return '<div class="yp-ed" data-key="' + esc(it.key) + '">'
        + '<div class="yp-ed-g"><input class="yp-in" data-yp="name" value="' + esc(it.name) + '" placeholder="Название проверки" maxlength="200">'
        + '<span class="yp-ed-st0">' + (it.isNew ? 'новая · Планирование' : (STL[it.status] || it.status)) + '</span>'
        + (it.isNew ? '<button class="yp-btn yp-del" data-yp="drop" title="Удалить несохранённую проверку">🗑</button>'
                    : (S.drafts[it.key] ? '<button class="yp-btn" data-yp="revert" title="Вернуть сохранённые значения">↺</button>' : ''))
        + '<button class="yp-btn" data-yp="close" title="Свернуть редактор">✓</button></div>'
        + st0 + bk + '<div class="yp-ed-g yp-ed-dates">' + dates + '<span class="yp-hint">Тяните этап — сдвиг всей проверки по неделям, правый край — длительность. Shift — по дням.</span></div></div>';
}
function groupHtml(g, shared){
    var col = !!S.collapsed[g.gkey], need = g.empty;
    var nm = esc(g.name), pl = g.plan != null ? '<span class="yp-plan">(' + g.plan + ')</span>' : '';
    var badge = shared ? '<span class="yp-dirb d-' + g.dir + '">' + DIRS[g.dir].s + '</span>' : '';
    var cnt = '<span class="yp-cnt" title="Утверждено / планирование / не сохранено' + (g.plan != null ? ' / не хватает до плана' : '') + '">'
        + '<i class="k-ok">' + g.cnt.ok + '</i><i class="k-plan">' + g.cnt.plan + '</i><i class="k-new">' + g.cnt['new'] + '</i>'
        + (g.plan != null ? (need ? '<i class="k-need">+' + need + '</i>' : (g.items.length > g.plan ? '<i class="k-over">сверх ' + (g.items.length - g.plan) + '</i>' : '<i class="k-done">✓</i>')) : '<i class="k-noplan">без плана</i>')
        + '</span>';
    var canAdd = !g.nopocket && !g.unknown && g.dir;
    var h = '<div class="yp-grp' + (col ? ' col' : '') + (S.scope === g.gkey ? ' scope' : '') + '" data-g="' + esc(g.gkey) + '">'
        + '<div class="yp-row yp-gh"><div class="yp-lab" data-yp="toggle" title="' + (col ? 'Развернуть' : 'Свернуть') + ' карман">'
        + '<span class="yp-car">' + (col ? '▸' : '▾') + '</span>' + badge + '<span class="yp-gn' + (g.unknown ? ' warn' : '') + '" title="' + (g.unknown ? 'Кармана нет в справочнике ' + YEAR + ' года' : esc(g.name) + (g.plan != null ? ' — план ' + g.plan : ' — план не задан')) + '">' + (g.unknown ? '⚠ ' : '') + nm + '</span>' + pl + cnt
        + '<span class="yp-ga">'
        + '<button class="yp-ib' + (S.scope === g.gkey ? ' on' : '') + '" data-yp="scope" title="Нагрузка и тепловая карта только по этому карману">📊</button>'
        + (canAdd ? '<button class="yp-ib" data-yp="add" title="Добавить ось (новую проверку)">＋</button>' : '')
        + '</span></div>';
    if (col) {
        var mini = ''; g.items.forEach(function(it){ mini += barsHtml(it, kindOf(it), true); });
        h += '<div class="yp-trk yp-trk--mini" style="background-image:' + GRID + '">' + mini + '</div></div>';
    } else {
        h += '<div class="yp-trk yp-trk--gh" style="background-image:' + GRID + '"></div></div>';
        g.items.forEach(function(it){ h += rowHtml(it, g); });
        for (var i = 0; i < need; i++) {
            h += '<div class="yp-row yp-empty" data-yp="fill" title="По плану нужно начать ещё ' + need + ' ' + plw(need, ['проверку','проверки','проверок']) + '">'
                + '<div class="yp-lab"><span class="yp-dot k-empty"></span><span class="yp-nm">свободная ось</span></div>'
                + '<div class="yp-trk" style="background-image:' + GRID + '"><span class="yp-etxt">По плану нужно начать ещё ' + need + ' ' + plw(need, ['проверку','проверки','проверок']) + ' · нажмите, чтобы создать</span></div></div>';
        }
        if (!g.items.length && !need) h += '<div class="yp-row yp-none"><div class="yp-lab"></div><div class="yp-trk" style="background-image:' + GRID + '"><span class="yp-etxt">Проверок нет' + (g.plan == null ? ', план не задан' : '') + '</span></div></div>';
    }
    return h + '</div>';
}
var GRID = '';
function loadHtml(){
    var d = monthLoad(), max = 1, rows = d.months;
    rows.forEach(function(r){ var t = r.ok + r.plan + r.other; if (d.cap > 0) max = Math.max(max, t / d.cap * 100, 100); else max = Math.max(max, t); });
    var bars = rows.map(function(r, m){
        var f = function(v){ return d.cap > 0 ? v / d.cap * 100 : v; };
        var a = f(r.ok), b = f(r.plan), c = f(r.other), t = a + b + c;
        return '<div class="yp-lm" style="left:' + pct(mStart(m)) + '%;width:' + (pct(m === 11 ? NDAYS : mStart(m + 1)) - pct(mStart(m))) + '%" title="' + esc(MONTHS[m] + ': ' + (d.cap > 0 ? fnum(t) + '% от возможной нагрузки' : fnum(t)) + '\nутверждённые проверки ' + fnum(a) + (S.withDrafts ? '\nчерновики ' + fnum(b) : '') + (S.scope === 'all' ? '\nпрочие задачи ' + fnum(c) : '')) + '">'
            + '<div class="yp-lstack' + (d.cap > 0 && t > 100 ? ' over' : '') + '" style="height:' + Math.min(100, t / max * 100) + '%">'
            + (c ? '<i class="l-other" style="flex:' + c + '"></i>' : '') + (b ? '<i class="l-plan" style="flex:' + b + '"></i>' : '') + (a ? '<i class="l-ok" style="flex:' + a + '"></i>' : '')
            + '</div><span class="yp-lv">' + (t ? Math.round(t) + (d.cap > 0 ? '%' : '') : '') + '</span></div>';
    }).join('');
    var capLine = d.cap > 0 ? '<div class="yp-cap" style="bottom:' + (100 / max * 100) + '%" title="100% возможной нагрузки ТБ"><span>100%</span></div>' : '';
    return '<div class="yp-load">'
        + '<div class="yp-lh"><b>Нагрузка ТБ</b> · ' + esc(scopeTitle())
        + '<span class="yp-seg yp-seg--s"><button data-yp="scopeall" class="' + (S.scope === 'all' ? 'on' : '') + '">Все проверки</button>'
        + '<button data-yp="scopehint" class="' + (S.scope !== 'all' ? 'on' : '') + '" title="Выберите карман кнопкой 📊 в его заголовке">Текущий карман</button></span>'
        + '<label class="yp-chk"><input type="checkbox" data-yp="drafts"' + (S.withDrafts ? ' checked' : '') + '> учитывать черновики</label>'
        + '<span class="yp-lleg"><i class="l-ok"></i>проверки<i class="l-plan"></i>черновики' + (S.scope === 'all' ? '<i class="l-other"></i>прочие задачи' : '') + '</span></div>'
        + '<div class="yp-row"><div class="yp-lab yp-lab--load">' + (d.cap > 0 ? '% от возможной<br>(численность × коэф.)' : 'условные единицы<br>(численность не задана)') + '</div>'
        + '<div class="yp-trk yp-trk--load" style="background-image:' + GRID + '">' + capLine + bars + '</div></div></div>';
}
function heatHtml(){
    var H = heatData(), cur = S.drag ? S.drag.key : S.editKey, it = cur ? getItem(cur) : null;
    var h = '<div class="yp-hm-h"><b>🔥 Проверки по ТБ</b><span>' + esc(scopeTitle()) + '</span>' + (S.heatPinned ? '<button class="yp-ib" data-yp="heat" title="Скрыть">✕</button>' : '') + '</div>'
        + '<table class="yp-hm-t"><thead><tr><th></th>' + MONTHS.map(function(m, i){ return '<th class="q' + seasonQuarter(i) + '" title="' + m + '">' + (i + 1) + '</th>'; }).join('') + '</tr></thead><tbody>';
    H.deps.forEach(function(d, i){
        var mine = it && it.department_ids.indexOf(d.id) >= 0;
        h += '<tr' + (mine ? ' class="mine"' : '') + '><th title="' + esc(d.name) + '">' + esc(abbr(d)) + '</th>';
        H.grid[i].forEach(function(c, m){
            var lv = c.n >= HOT ? 'hot' : 'l' + c.n;
            h += '<td class="' + lv + (c.cur ? ' cur' : '') + '" title="' + esc(d.name + ', ' + MONTHS[m] + ': ' + c.n + ' ' + plw(c.n, ['проверка','проверки','проверок']) + (c.names.length ? '\n• ' + c.names.join('\n• ') : '')) + '">' + (c.n || '') + '</td>';
        });
        h += '</tr>';
    });
    var hot = 0; H.grid.forEach(function(r){ r.forEach(function(c){ if (c.n >= HOT) hot++; }); });
    h += '</tbody></table><div class="yp-hm-f">' + (hot ? '<span class="warn">⚠ ' + hot + ' ' + plw(hot, ['ячейка','ячейки','ячеек']) + ' с ' + HOT + '+ одновременными проверками</span>' : 'Одновременно ' + HOT + '+ проверок у одного ТБ — нет') + '</div>';
    return h;
}
function renderHeat(){
    var box = $('ypHeat'); if (!box) return;
    var show = S.heatPinned || !!S.drag || !!S.editKey;
    box.classList.toggle('show', show);
    if (show) box.innerHTML = heatHtml();
}
function renderDirty(){
    var n = Object.keys(S.drafts).filter(function(k){ return isDirty(S.drafts[k]); }).length;
    var d = $('ypDirty'), sv = $('ypSave'), rs = $('ypReset');
    if (d) d.textContent = n ? 'Несохранённых изменений: ' + n : '';
    if (sv) sv.disabled = !n; if (rs) rs.disabled = !n;
}
function render(){
    var p = panel(); if (!p || !p.classList.contains('active')) return;
    if (!GRID) GRID = gridBg();
    var body = $('ypBody'); if (!body) return;
    if (!S.pocketsLoaded) { body.innerHTML = '<div class="yp-msg">Загрузка карманов ' + YEAR + ' года…</div>'; return; }
    var gs = buildGroups(), secs = sections(gs), h = scaleHtml();
    var keep = body.querySelector('.yp-scroll'), sl = keep ? keep.scrollLeft : 0, sy = window.scrollY;
    if (!S.pockets.length) {
        h += '<div class="yp-msg">' + (S.pocketsErr ? 'Справочник карманов недоступен: ' + esc(S.pocketsErr) + '. ' : 'На ' + YEAR + ' год карманов пока нет. ')
            + '<button class="yp-btn yp-save" data-yp="pockets">✏️ Задать карманы ' + YEAR + '</button></div>';
    }
    secs.forEach(function(sx){
        if (!sx.groups.length) return;
        var col = !!S.collapsed[sx.skey];
        h += '<div class="yp-sec' + (sx.shared ? ' shared' : '') + '"><div class="yp-sh" data-yp="toggle" data-s="' + sx.skey + '"><span class="yp-car">' + (col ? '▸' : '▾') + '</span>' + esc(sx.title)
            + '<span class="yp-shc">' + sx.groups.length + ' ' + plw(sx.groups.length, ['карман','кармана','карманов']) + ' · план ' + sx.groups.reduce(function(a, g){ return a + (g.plan || 0); }, 0) + ' · проверок ' + sx.groups.reduce(function(a, g){ return a + g.items.length; }, 0) + '</span></div>';
        if (!col) sx.groups.forEach(function(g){ h += groupHtml(g, sx.shared); });
        h += '</div>';
    });
    h += loadHtml();
    body.innerHTML = '<div class="yp-scroll"><div class="yp-grid">' + h + '</div></div>';
    var sc = body.querySelector('.yp-scroll'); if (sc) sc.scrollLeft = sl;
    renderDirty(); renderHeat();
}
function rerenderTop(){ var t = $('ypTop'); if (t) t.innerHTML = head(); }

/* ---------- действия ---------- */
function addDays(isoS, n){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoS); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * DAY).toISOString().slice(0, 10); }
function newItem(g){
    S.seq++;
    var a = iso(mStart(1));                                   // 1 февраля планового года
    var b = addDays(a, NEW_PREP_DAYS), c = addDays(b, NEW_NZH_DAYS - 1);
    var n = g.items.filter(function(x){ return x.isNew; }).length + 1;
    var it = { key:'new' + S.seq, id:'', orig:null, isNew:true, seq:S.seq, name:g.name + ' · новая ' + n, task_type:DIRS[g.dir].tt,
               pocket:g.name, status:'planning', department_ids:[], department_shares:{}, lead_department:'',
               stages:[{ key:'подготовка', start:a, end:addDays(b, -1) }, { key:'проверка_нжя', start:b, end:c }] };
    S.drafts[it.key] = it; S.editKey = it.key; S.collapsed[g.gkey] = false;
    return it;
}
function findGroup(gk){ return buildGroups().filter(function(g){ return g.gkey === gk; })[0] || null; }
function ask(title, text, yes, onYes){
    var old = $('ypAsk'); if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'ypAsk'; ov.className = 'tsum-confirm-overlay active yp-ask';
    ov.innerHTML = '<div class="tsum-confirm" role="dialog" aria-modal="true"><div class="dash-sc-title">' + esc(title) + '</div>'
        + '<div class="yp-ask-body">' + text + '</div><div class="tsum-confirm-actions">'
        + '<button type="button" class="tsum-cbtn tsum-cbtn--no" data-a="no">Отмена</button>'
        + '<button type="button" class="tsum-cbtn tsum-cbtn--yes" data-a="yes">' + esc(yes) + '</button></div></div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); document.removeEventListener('keydown', key); }
    function key(e){ if (e.key === 'Escape') close(); }
    ov.addEventListener('mousedown', function(e){ if (e.target === ov) close(); });
    ov.addEventListener('click', function(e){ var b = e.target.closest('[data-a]'); if (!b) return; close(); if (b.getAttribute('data-a') === 'yes') onYes(); });
    document.addEventListener('keydown', key);
    setTimeout(function(){ var y = ov.querySelector('[data-a="yes"]'); if (y) y.focus(); }, 30);
}
function addAxis(gk){
    var g = findGroup(gk); if (!g) return;
    var go = function(){ newItem(g); render(); };
    if (g.plan == null || g.items.length >= g.plan) {
        var have = g.items.length;
        ask('Ось сверх плана',
            g.plan == null
                ? 'Для кармана <b>«' + esc(g.name) + '»</b> план на ' + YEAR + ' год не задан. Добавить проверку без плана?'
                : 'В кармане <b>«' + esc(g.name) + '»</b> по плану ' + g.plan + ' ' + plw(g.plan, ['проверка','проверки','проверок']) + ', осей уже ' + have + '.<br>Добавить ещё одну ось сверх плана?',
            'Добавить ось', go);
        return;
    }
    go();
}
function shiftStages(it, from, delta){ for (var i = from; i < it.stages.length; i++) { it.stages[i].start = addDays(it.stages[i].start, delta); it.stages[i].end = addDays(it.stages[i].end, delta); } }
function toggleStage(it, k){
    var i = -1; it.stages.forEach(function(s, j){ if (s.key === k) i = j; });
    if (i >= 0) {
        if (it.stages.length === 1) { notify('У проверки должен остаться хотя бы один этап', 'error'); return; }
        var len = dn(it.stages[i].end) - dn(it.stages[i].start) + 1;
        it.stages.splice(i, 1); shiftStages(it, i, -len); return;
    }
    var pos = 0; while (pos < it.stages.length && STAGE_ORDER.indexOf(it.stages[pos].key) < STAGE_ORDER.indexOf(k)) pos++;
    var a = pos < it.stages.length ? it.stages[pos].start : addDays(tEnd(it), 1);
    shiftStages(it, pos, 14);
    it.stages.splice(pos, 0, { key:k, start:a, end:addDays(a, 13) });
}
function toggleBank(it, id){
    var i = it.department_ids.indexOf(id);
    if (i >= 0) { it.department_ids.splice(i, 1); if (it.lead_department === id) it.lead_department = it.department_ids[0] || ''; }
    else { it.department_ids.push(id); if (!it.lead_department) it.lead_department = id; }
}

/* ---------- перетаскивание: вся проверка по неделям (Shift — по дням), правый край этапа — длительность ---------- */
function onDown(e){
    var bar = e.target.closest('.yp-bar'); if (!bar || e.button !== 0) return;
    var row = bar.closest('.yp-item'); if (!row) return;                 // мини-полосы свёрнутого кармана не тянутся
    var key = bar.getAttribute('data-key'), it = ensureDraft(key); if (!it) return;
    var trk = bar.parentNode, w = trk.getBoundingClientRect().width;
    S.drag = { key:key, x:e.clientX, dpx:w / NDAYS, si:+bar.getAttribute('data-si'), rz:!!e.target.closest('.yp-rz'),
               base:clone(it.stages), moved:false, trk:trk };
    e.preventDefault();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    renderHeat();
}
function onMove(e){
    var D = S.drag; if (!D) return;
    var raw = (e.clientX - D.x) / D.dpx, step = e.shiftKey ? 1 : 7, d = Math.round(raw / step) * step;
    var it = S.drafts[D.key]; it.stages = clone(D.base);
    if (D.rz) {
        var s = it.stages[D.si], len = dn(s.end) - dn(s.start) + 1;
        if (len + d < 1) d = 1 - len;
        s.end = addDays(s.end, d); shiftStages(it, D.si + 1, d);
    } else shiftStages(it, 0, d);
    if (d) D.moved = true;
    D.trk.innerHTML = barsHtml(it, kindOf(it));
    D.trk.classList.add('drag');
    var lab = D.trk.parentNode.querySelector('.yp-nm');
    if (lab) lab.setAttribute('data-tip', fmt(tStart(it)) + ' – ' + fmt(tEnd(it)));
    renderHeat();
}
function onUp(){
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    var D = S.drag; S.drag = null;
    if (D && !D.moved && !isDirty(S.drafts[D.key])) delete S.drafts[D.key];
    if (D && !D.moved) S.editKey = D.key;
    render();
}

/* ---------- сохранение (как в Песочнице) ---------- */
function payloadOf(it){
    var o = it.orig ? clone(it.orig) : {}, starts = {}, prev = '';
    it.stages.forEach(function(s){ var d = s.start; if (prev && d <= prev) d = addDays(prev, 1); starts[s.key] = d; prev = d; });
    return {
        id: it.id || '', name: String(it.name || '').trim(), icon: o.icon || '📋', description: o.description || '',
        status: it.isNew ? 'planning' : (o.status || 'planning'),
        start_date: tStart(it), deadline: tEnd(it), completed_at: o.completed_at || '', folder: o.folder || '', order_ref: o.order_ref || '',
        tags: (o.tags || []).slice(), assignees: (o.assignees || o.assignee_ids || []).slice(),
        department_ids: it.department_ids.slice(), task_kind: 'audit', load_coef: o.load_coef || 0,
        lead_department: leadOf(it), lead_employee: o.lead_employee || '', is_urgent: !!o.is_urgent,
        links: (o.links || []).slice(), orders: (o.orders || []).slice(),
        task_type: it.task_type || o.task_type || '', pocket: it.pocket || o.pocket || '',
        curator: it.isNew ? 'нет' : (o.curator || ''), department_shares: clone(it.department_shares || {}) || {},
        stages: starts, force_duplicate: true
    };
}
function diffLines(it){
    var p = payloadOf(it), L = [], o = it.orig, nm = function(id){ return abbr(depById(id)); };
    if (!o) {
        L.push('статус: Планирование', 'карман: ' + p.pocket + ' (' + p.task_type + ')', 'сроки: ' + fmt(p.start_date) + ' – ' + fmt(p.deadline));
        L.push('ТБ: ' + p.department_ids.map(nm).join(', ') + ' · руководитель ' + nm(p.lead_department));
        L.push('этапы: ' + it.stages.map(function(s){ return STAGE_LABELS[s.key] + ' ' + fmt(s.start) + '–' + fmt(s.end); }).join('; '));
        return L;
    }
    var b = fromTask(o);
    if (String(b.name).trim() !== p.name) L.push('название: «' + b.name + '» → «' + p.name + '»');
    if (tStart(b) !== tStart(it) || tEnd(b) !== tEnd(it)) L.push('сроки: ' + fmt(tStart(b)) + '–' + fmt(tEnd(b)) + ' → ' + fmt(tStart(it)) + '–' + fmt(tEnd(it)));
    var bs = {}; b.stages.forEach(function(s){ bs[s.key] = s; });
    it.stages.forEach(function(s){ var x = bs[s.key]; if (!x) L.push('добавлен этап «' + STAGE_LABELS[s.key] + '»'); else if (x.start !== s.start || x.end !== s.end) L.push('этап «' + STAGE_LABELS[s.key] + '»: ' + fmt(x.start) + '–' + fmt(x.end) + ' → ' + fmt(s.start) + '–' + fmt(s.end)); delete bs[s.key]; });
    Object.keys(bs).forEach(function(k){ L.push('убран этап «' + STAGE_LABELS[k] + '»'); });
    p.department_ids.filter(function(x){ return b.department_ids.indexOf(x) < 0; }).forEach(function(x){ L.push('добавлен ТБ ' + nm(x)); });
    b.department_ids.filter(function(x){ return p.department_ids.indexOf(x) < 0; }).forEach(function(x){ L.push('убран ТБ ' + nm(x)); });
    if (leadOf(b) !== p.lead_department) L.push('руководитель: ' + nm(leadOf(b)) + ' → ' + nm(p.lead_department));
    return L;
}
function save(){
    var list = Object.keys(S.drafts).map(function(k){ return S.drafts[k]; }).filter(isDirty), errs = [];
    if (!list.length) { notify('Изменений нет', 'info'); return; }
    list.forEach(function(it){
        if (!String(it.name || '').trim()) errs.push('не указано название проверки (карман «' + it.pocket + '»)');
        else if (!it.department_ids.length) errs.push('«' + it.name + '»: добавьте хотя бы один ТБ');
    });
    if (errs.length) { notify(errs.join('; '), 'error'); return; }
    var cu = st().currentUser; if (!(cu && cu.role === 'admin')) { notify('Сохранение доступно только администратору', 'error'); return; }
    var html = list.map(function(it){
        return '<div class="dash-sc-item' + (it.isNew ? ' dash-sc-item--new' : '') + '"><div class="dash-sc-head">' + (it.isNew ? '✨ Создаётся проверка «' : '✏️ В проверке «') + esc(String(it.name).trim()) + (it.isNew ? '»' : '» изменится:') + '</div>'
            + '<ul class="dash-sc-list">' + diffLines(it).map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    ask('Изменения в годовом плане ' + YEAR, '<div class="dash-sc-body">' + html + '</div><p class="tsum-confirm-text dash-sc-ask">Уверены, что хотите внести данные изменения?</p>', 'Сохранить', function(){ runSave(list); });
}
function runSave(list){
    var btn = $('ypSave'); if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
    var ok = 0, fail = null, chain = Promise.resolve();
    list.forEach(function(it){
        chain = chain.then(function(){
            if (fail) return;
            return api('/api/tracker/task/save', payloadOf(it)).then(function(r){
                if (!r || !r.success) throw new Error((r && (r.message || r.error)) || 'Ошибка сохранения');
                ok++; delete S.drafts[it.key]; if (S.editKey === it.key) S.editKey = r.id ? String(r.id) : null;
            }).catch(function(e){ fail = '«' + it.name + '»: ' + ((e && e.message) || 'Ошибка'); });
        });
    });
    return chain.then(function(){
        var rf = window.__trkRefreshAll || window.__trkLoadState;
        return ok && typeof rf === 'function' ? rf() : null;
    }).then(function(){
        if (btn) btn.textContent = 'Сохранить изменения';
        render();
        if (fail) notify('❌ ' + fail + (ok ? ' (сохранено до ошибки: ' + ok + ')' : ''), 'error');
        else if (window.trkShowCenterMsg) window.trkShowCenterMsg('✅ Изменения сохранены (' + ok + ')');
        else notify('✅ Изменения сохранены (' + ok + ')', 'success');
    });
}

/* ---------- события ---------- */
function onClick(e){
    var t = e.target.closest('[data-yp]'); if (!t || !panel().contains(t)) return;
    var a = t.getAttribute('data-yp'), g = t.closest('.yp-grp'), gk = g ? g.getAttribute('data-g') : '';
    var row = t.closest('[data-key]'), key = row ? row.getAttribute('data-key') : '';
    var it;
    switch (a) {
    case 'back': if (window.__trkSetActiveTab) window.__trkSetActiveTab('calendar'); return;
    case 'dir': S.dir = t.getAttribute('data-v'); if (S.scope !== 'all' && S.dir !== 'all' && S.scope.indexOf(S.dir + '|') !== 0) S.scope = 'all'; saveUi(); rerenderTop(); render(); return;
    case 'pockets':
        if (typeof window.trkOpenPockets !== 'function') { notify('Плагин «Карманы» не подключён', 'error'); return; }
        window.trkOpenPockets(YEAR, true); return;
    case 'expand': case 'collapse':
        buildGroups().forEach(function(x){ S.collapsed[x.gkey] = a === 'collapse'; }); ['s:corp','s:retail','s:shared','s:nodir'].forEach(function(k){ S.collapsed[k] = a === 'collapse'; });
        saveUi(); render(); return;
    case 'heat': S.heatPinned = !S.heatPinned; saveUi(); rerenderTop(); renderHeat(); return;
    case 'toggle': var k = t.getAttribute('data-s') || gk; S.collapsed[k] = !S.collapsed[k]; saveUi(); render(); return;
    case 'scope': S.scope = S.scope === gk ? 'all' : gk; render(); return;
    case 'scopeall': S.scope = 'all'; render(); return;
    case 'scopehint': if (S.scope === 'all') notify('Выберите карман кнопкой 📊 в его заголовке', 'info'); return;
    case 'add': addAxis(gk); return;
    case 'fill': var fg = findGroup(gk); if (fg) { newItem(fg); render(); } return;
    case 'edit': S.editKey = S.editKey === key ? null : key; render(); return;
    case 'close': S.editKey = null; render(); return;
    case 'stage': it = ensureDraft(key); if (it) { toggleStage(it, t.getAttribute('data-v')); render(); } return;
    case 'bank': it = ensureDraft(key); if (it) { toggleBank(it, t.getAttribute('data-v')); render(); } return;
    case 'drop': delete S.drafts[key]; S.editKey = null; render(); return;
    case 'revert': delete S.drafts[key]; render(); return;
    case 'reset': ask('Отменить изменения', 'Все несохранённые изменения годового плана будут потеряны.', 'Отменить изменения', function(){ S.drafts = {}; S.editKey = null; render(); }); return;
    case 'save': save(); return;
    }
}
function onInput(e){
    var t = e.target, a = t.getAttribute && t.getAttribute('data-yp'); if (!a) return;
    var row = t.closest('[data-key]'), it = row ? ensureDraft(row.getAttribute('data-key')) : null;
    if (a === 'name' && it) {
        it.name = t.value; renderDirty();
        var nm = panel().querySelector('.yp-item[data-key="' + it.key + '"] .yp-nm'); if (nm) nm.textContent = it.name || 'Без названия';
    }
    if (a === 'lead' && it) { it.lead_department = t.value; render(); }
    if (a === 'drafts') { S.withDrafts = t.checked; render(); }
}

/* ---------- монтирование ---------- */
var inited = false;
function activate(){
    var p = panel(); if (!p) return;
    if (!inited) {
        inited = true;
        p.innerHTML = '<div id="ypTop"></div><div id="ypBody"></div><div id="ypHeat" class="yp-heat"></div>';
        p.addEventListener('click', onClick);
        p.addEventListener('input', onInput);
        p.addEventListener('change', onInput);
        p.addEventListener('pointerdown', onDown);
        $('ypHeat').addEventListener('click', onClick);
        document.addEventListener('trk:pockets-closed', function(){ loadPockets().then(render); });
        window.addEventListener('beforeunload', function(e){
            if (Object.keys(S.drafts).some(function(k){ return isDirty(S.drafts[k]); })) { e.preventDefault(); e.returnValue = ''; }
        });
    }
    rerenderTop(); render();
    loadPockets().then(render);
}
function mountButton(){
    var b = $('openYearPlanBtn'); if (!b) return;
    if (!editable()) { b.remove(); return; }
    b.hidden = false;
}
window.__ypActivate = activate;
window.__ypState = S;   // для отладки и тестов
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton); else mountButton();
})();
