# -*- coding: utf-8 -*-
"""plugins/pockets.py — окно «🗂 Карманы» во вкладке «Планирование».

Справочник карманов (строго по направлениям), годовые планы карманов
(период + план проверок, «запланировано N из M») и распределение проверок
по ТБ: таблица 1 — банк-руководитель × карман (с фамилиями руководителей),
таблица 2 — карман × банки-участники + «вне кармана», итоги, ПШЕ и «в год на ПШЕ».
Таблицы pockets / pocket_plans создаются миграцией в app.py (с резервной копией БД).
"""
__version__ = '1.2'
__description__ = 'Карманы: справочник по направлениям, годовые планы, распределение проверок по ТБ'

import re
from datetime import date, datetime
from flask import request, jsonify

DIRS = ('корпоративная', 'розничная')
_DIR_KEY = {'корпоративная': 'corp', 'розничная': 'retail'}


def short_bank(dep):
    s = (dep.get('short_name') or '').strip()
    if s:
        return s
    parts = [p for p in re.split(r'[\s\-]+', dep.get('name') or '') if p]
    return ''.join(p[0].upper() for p in parts)[:6] or '?'


_PALETTE = ['#2e7d32', '#6a3fb5', '#00838f', '#795548', '#b71c1c', '#546e7a', '#6d4c41',
            '#5e35b1', '#ad1457', '#558b2f', '#00695c', '#8e24aa']
# Цвета, занятые смыслом в окне: синий (корп.), розовый (розн.), оранжевый (⚠ нет в справочнике)
_RESERVED = [(59, 130, 246), (217, 70, 143), (240, 160, 75)]


def _rgb(c):
    c = (c or '').strip().lstrip('#')
    if len(c) == 3:
        c = ''.join(x * 2 for x in c)
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return None


def _dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _close(a, b):
    return bool(a and b) and _dist(a, b) < 120


def _readable(c):
    """Цвет метки с белым текстом: слишком светлые цвета затемняем."""
    r = _rgb(c)
    if not r:
        return c
    lum = (0.299 * r[0] + 0.587 * r[1] + 0.114 * r[2]) / 255
    if lum <= 0.5:
        return c
    k = 0.5 / lum
    return '#%02x%02x%02x' % tuple(int(x * k) for x in r)


def label_colors(deps):
    """Цвет метки банка: свой цвет банка, а если он совпадает или почти совпадает
    с цветом уже показанного банка — следующий различимый цвет из палитры."""
    out, used = {}, []
    for d in deps:
        c = d.get('color') or ''
        rc = _rgb(c)
        lum = (0.299 * rc[0] + 0.587 * rc[1] + 0.114 * rc[2]) / 255 if rc else 1
        if not rc or lum > 0.55 or any(_close(rc, u) for u in used + _RESERVED):
            # самый непохожий на уже занятые цвет из палитры
            pc = max(_PALETTE, key=lambda x: min([_dist(_rgb(x), u) for u in used + _RESERVED] or [999]))
            c, rc = pc, _rgb(pc)
        c = _readable(c)
        used.append(_rgb(c))
        out[d['id']] = c
    return out


def _surname(n):
    n = (n or '').strip()
    return n.split()[0] if n else ''


def _valid_date(s):
    try:
        datetime.strptime(s, '%Y-%m-%d')
        return True
    except Exception:
        return False


def _audits(data):
    return [t for t in data.get('tasks') or []
            if (t.get('task_kind') or 'audit') == 'audit' and t.get('status') != 'cancelled']


def plan_progress(data, pockets, plans):
    """Сколько проверок уже заведено в каждом плане кармана."""
    by_id = {p['id']: p for p in pockets}
    tasks = _audits(data)
    out = []
    for pl in plans:
        pk = by_id.get(pl['pocket_id'])
        if not pk:
            continue
        ids = [t['id'] for t in tasks
               if (t.get('pocket') or '').strip() == pk['name']
               and (t.get('task_type') or '') == pk['direction']
               and pl['date_from'] <= (t.get('start_date') or '') <= pl['date_to']]
        d = dict(pl)
        d['count'] = len(ids)
        d['task_ids'] = ids
        d['left'] = max(0, int(pl.get('plan_count') or 0) - len(ids))
        out.append(d)
    return out


def pockets_compute(data, pockets, year, direction=''):
    deps = data.get('departments') or []
    lcol = label_colors(deps)
    emp = {e['id']: e for e in data.get('employees') or []}
    dep_ids = [d['id'] for d in deps]
    known = {(p['name'], p['direction']) for p in pockets}

    def in_dir(t):
        return not direction or (t.get('task_type') or '') == direction

    ytasks = [t for t in _audits(data)
              if (t.get('start_date') or '')[:4] == str(year) and in_dir(t)]

    used = {}
    for t in ytasks:
        k = ((t.get('pocket') or '').strip(), t.get('task_type') or '')
        if k[0]:
            used[k] = used.get(k, 0) + 1

    cols = []
    for p in sorted(pockets, key=lambda x: (DIRS.index(x['direction']) if x['direction'] in DIRS else 9,
                                             x.get('sort') or 0, x['name'].lower())):
        if direction and p['direction'] != direction:
            continue
        k = (p['name'], p['direction'])
        if not p.get('is_active') and not used.get(k):
            continue
        cols.append({'key': p['name'] + '|' + p['direction'], 'name': p['name'],
                     'direction': p['direction'], 'id': p['id'], 'unknown': False,
                     'active': bool(p.get('is_active'))})
    for k in sorted(used):
        if k not in known:
            cols.append({'key': k[0] + '|' + k[1], 'name': k[0], 'direction': k[1],
                         'id': None, 'unknown': True, 'active': False})
    NONE = '__none'

    def col_of(t):
        nm = (t.get('pocket') or '').strip()
        return nm + '|' + (t.get('task_type') or '') if nm else NONE

    t1 = {b: {} for b in dep_ids}      # банк-руководитель → карман → [task]
    t2 = {}                             # карман → банк-участник → [task]
    tinfo = {}
    for t in ytasks:
        c = col_of(t)
        lead = t.get('lead_department') or ''
        le = emp.get(t.get('lead_employee') or '') or {}
        tinfo[t['id']] = {'id': t['id'], 'name': t.get('name') or '', 'status': t.get('status') or '',
                          'start': t.get('start_date') or '', 'deadline': t.get('deadline') or '',
                          'pocket': (t.get('pocket') or '').strip(), 'direction': t.get('task_type') or '',
                          'lead_bank': lead, 'lead': le.get('name') or '',
                          'lead_short': _surname(le.get('name'))}
        if lead in t1:
            t1[lead].setdefault(c, []).append(t['id'])
        parts = list(t.get('department_ids') or []) or ([lead] if lead else [])
        for b in parts:
            if b in dep_ids:
                t2.setdefault(c, {}).setdefault(b, []).append(t['id'])

    keys = [c['key'] for c in cols] + [NONE]
    t1_tot = {k: sum(len(t1[b].get(k, [])) for b in dep_ids) for k in keys}
    t2_tot = {b: sum(len(t2.get(k, {}).get(b, [])) for k in keys) for b in dep_ids}

    banks = []
    for d in deps:
        b = d['id']
        cnt = {'corp': 0, 'retail': 0}
        for k in keys:
            for tid in t2.get(k, {}).get(b, []):
                dk = _DIR_KEY.get(tinfo[tid]['direction'])
                if dk:
                    cnt[dk] += 1
        hc = {'corp': d.get('headcount_corp'), 'retail': d.get('headcount_retail')}
        per = {}
        for dk in ('corp', 'retail'):
            try:
                per[dk] = round(cnt[dk] / float(hc[dk]), 2) if hc[dk] else None
            except Exception:
                per[dk] = None
        banks.append({'id': b, 'name': d.get('name') or '', 'short': short_bank(d),
                      'color': lcol.get(b) or '#00897b', 'count': cnt, 'hc': hc, 'per_hc': per})
    return {'year': year, 'direction': direction, 'cols': cols, 'banks': banks,
            't1': t1, 't1_total': t1_tot, 't2': t2, 't2_total': t2_tot,
            'tasks': tinfo, 'total_tasks': len(ytasks)}


_JS = r"""
(function(){
'use strict';
if (window.__pocketsV1) return; window.__pocketsV1 = true;
var DIRS = [['', 'Все'], ['корпоративная', 'Корпоративное'], ['розничная', 'Розничное']];
var DL = { 'корпоративная': 'Корп.', 'розничная': 'Розн.' };
var DMETA = { 'корпоративная': { k: 'corp', ic: '🏢', t: 'Корпоративное', cl: 'pk-d-corp' }, 'розничная': { k: 'retail', ic: '👥', t: 'Розничное', cl: 'pk-d-retail' } };
function nkey(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function isShared(name) { return !!(ST.shared && ST.shared[nkey(name)]); }
function setList(L) { window.__trkPocketList = L || []; try { if (window.state) window.state.pockets = window.__trkPocketList; } catch (x) {} }
// Открытые карманы направления на год (год проверки — по дате начала; пусто — текущий год)
window.trkPocketsFor = function(dir, year) {
    var y = String(year || new Date().getFullYear());
    return (window.__trkPocketList || []).filter(function(p) { return p && (!dir || p.direction === dir) && p.is_active && (p.year == null || String(p.year) === y); });
};
function ptag(name, dir, unk) {
    var m = DMETA[dir], sh = !unk && m && isShared(name);
    return '<span class="pk-ptag ' + (m ? m.cl : '') + (unk ? ' pk-old' : '') + (sh ? ' pk-shared' : '') + '" title="' + e((m ? m.t + ' направление' : 'Без направления') + (sh ? ' · общий карман: есть в обоих направлениях' : '') + (unk ? ' · нет в справочнике' : '')) + '">'
        + (m ? '<i>' + m.ic + '</i>' : '') + e(name) + (sh ? '<b class="pk-sh" aria-hidden="true">⇄</b>' : '') + (unk ? '<em class="pk-warn">⚠</em>' : '') + '</span>';
}
function ptagT(name, dir, unk) {
    var sh = !unk && !!DMETA[dir] && isShared(name);
    return '<span class="pk-ptag pk-tt' + (unk ? ' pk-old' : '') + (sh ? ' pk-tsh' : '') + '" title="' + e((sh ? 'Общий карман: есть в обоих направлениях' : 'Карман') + (unk ? ' · нет в справочнике' : '')) + '">'
        + e(name) + (sh ? '<b class="pk-sh" aria-hidden="true">⇄</b>' : '') + (unk ? '<em class="pk-warn">⚠</em>' : '') + '</span>';
}
function shCol(c) { return c && c.key !== '__none' && !c.unknown && isShared(c.name); }
function popClose() {
    tipHide(); ST.cell = null; var p = document.getElementById('pkPop'); if (p) p.style.display = 'none';
    document.querySelectorAll('#pkOverlay td.pk-cell-on').forEach(function(x) { x.classList.remove('pk-cell-on'); });
}
function popPlace(pop, a) {
    if (!a) return; var r = a.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    // границы — окно «Карманы» (а не весь экран), чтобы окошко не вылезало на затемнённый фон
    var bx = document.querySelector('#pkOverlay .pk-box'), br = bx ? bx.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    var L = Math.max(8, br.left + 8), T = Math.max(8, br.top + 8), R = Math.min(window.innerWidth - 8, br.right - 8), B = Math.min(window.innerHeight - 8, br.bottom - 8);
    var x, y;
    if (r.right + 8 + pw <= R) { x = r.right + 8; y = r.top - 4; }
    else if (r.left - 8 - pw >= L) { x = r.left - 8 - pw; y = r.top - 4; }
    else { x = Math.max(L, Math.min(R - pw, r.left)); y = r.bottom + 6; if (y + ph > B) y = r.top - ph - 6; }
    if (y + ph > B) y = B - ph; if (y < T) y = T;
    pop.style.left = Math.round(x) + 'px'; pop.style.top = Math.round(y) + 'px';
}
function calcShared(list) {
    var by = {}, out = {};
    (list || []).forEach(function(p) { var k = nkey(p.name); if (!k) return; by[k] = by[k] || {}; by[k][p.direction] = 1; });
    Object.keys(by).forEach(function(k) { if (by[k]['корпоративная'] && by[k]['розничная']) out[k] = 1; });
    return out;
}
var STL = { planning: 'Планирование', approved: 'Утверждена', active: 'Активна', done: 'Завершена' };
var ST = { year: new Date().getFullYear(), dir: '', d: null, cell: null, edit: null, plan: null, ed: null, shared: {} };
try { ST.dir = localStorage.getItem('pk.dir') || ''; } catch (x) {}
function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function n2(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
function n(v) { return v == null ? '—' : String(Math.round(v * 100) / 100).replace('.', ','); }
function fd(s) { return s ? s.split('-').reverse().join('.') : ''; }
function api(url, body) {
    var o = { credentials: 'same-origin', cache: 'no-store' };
    if (body) { o.method = 'POST'; o.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': window.REESTR_CSRF || '' }; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function(r) { return r.json().catch(function() { return { success: false, error: 'HTTP ' + r.status }; }); });
}
function msg(m, err) { if (window.trkNotify) window.trkNotify(m, err ? 'error' : 'success'); else alert(m); }
function css() {
    if (document.getElementById('pkCss')) return;
    var s = document.createElement('style'); s.id = 'pkCss';
    s.textContent = [
    '.pk-ov{position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:none;align-items:flex-start;justify-content:center;padding:3vh 2vw}',
    '.pk-box{width:min(1188px,86vw);max-height:94vh;display:flex;flex-direction:column;background:#1d2026;color:#e6e6e6;border:1px solid rgba(38,162,105,.55);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.5)}',
    'body.trk-theme-light .pk-box{background:#fff;color:#1f2328}',
    '.pk-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(128,128,128,.25)}',
    '.pk-head h3{margin:0;font-size:1.05rem;margin-right:auto}',
    '.pk-body{overflow:auto;padding:12px 16px 18px}',
    '.pk-seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(128,128,128,.25)}',
    'body.trk-theme-light .pk-seg{background:#dfe3e8}',
    '.pk-seg button{border:none;background:transparent;cursor:pointer;padding:5px 12px;border-radius:999px;font:inherit;font-size:.8rem;font-weight:600;color:inherit;opacity:.8}',
    '.pk-seg button.active{background:#f4f4f4;color:#111;opacity:1}',
    'body.trk-theme-light .pk-seg button.active{background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.12)}',
    '.pk-btn{padding:4px 10px;border-radius:8px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:.78rem;font-weight:600}',
    '.pk-btn:hover{border-color:#26a269}.pk-btn.pri{background:#26a269;border-color:#26a269;color:#fff}.pk-btn.x{border:none;font-size:1.1rem}',
    '.pk-btn.mini{padding:2px 7px;font-size:.72rem}',
    '.pk-sec{margin-top:14px}.pk-sec h4{margin:0 0 8px;font-size:.9rem}',
    '.pk-dirs{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px}',
    '.pk-dir{border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:8px 10px}',
    '.pk-dir h5{margin:0 0 6px;font-size:.82rem;opacity:.85;text-transform:uppercase;letter-spacing:.03em}',
    '.pk-row{border-top:1px dashed rgba(128,128,128,.25);padding:6px 0}',
    '.pk-row:first-of-type{border-top:none}',
    '.pk-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.pk-name{font-weight:700}.pk-off .pk-name{opacity:.55;text-decoration:line-through}',
    '.pk-mute{font-size:.75rem;opacity:.85}',
    '.pk-chip{font-size:.7rem;padding:1px 7px;border-radius:999px;border:1px solid rgba(128,128,128,.4)}',
    '.pk-plan{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 0 14px;font-size:.78rem}',
    '.pk-bar{width:90px;height:7px;border-radius:4px;background:rgba(128,128,128,.25);overflow:hidden}',
    '.pk-bar i{display:block;height:100%;background:#26a269}',
    '.pk-left{color:#e67e22;font-weight:700}.pk-ok{color:#27ae60;font-weight:700}',
    '.pk-form{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 0 14px}',
    '.pk-form input,.pk-form select{padding:3px 6px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;font:inherit;font-size:.78rem}',
    '.pk-form input[type=number]{width:64px}',
    'body:not(.trk-theme-light) .pk-form input[type=date]{color-scheme:dark}',
    'body:not(.trk-theme-light) .pk-form select option{background:#1d2026}',
    '.pk-tw{overflow:auto;max-height:60vh;border:1px solid rgba(128,128,128,.28);border-radius:10px}',
    '.pk-t{border-collapse:separate;border-spacing:0;font-size:.78rem;min-width:100%}',
    '.pk-t th,.pk-t td{padding:5px 8px;border-bottom:1px solid rgba(128,128,128,.2);white-space:nowrap;text-align:center}',
    '.pk-t thead th{position:sticky;top:0;z-index:2;background:#262a31}',
    'body.trk-theme-light .pk-t thead th{background:#eef1f4}',
    '.pk-t th:first-child,.pk-t td:first-child{position:sticky;left:0;z-index:1;background:#1d2026;text-align:left}',
    'body.trk-theme-light .pk-t th:first-child,body.trk-theme-light .pk-t td:first-child{background:#fff}',
    '.pk-t thead th:first-child{z-index:3;background:#262a31}body.trk-theme-light .pk-t thead th:first-child{background:#eef1f4}',
    '.pk-t td[data-cell]{cursor:pointer}.pk-t td[data-cell]:hover{background:rgba(38,162,105,.16)}',
    '.pk-t tr.pk-tot td{font-weight:700;border-top:2px solid rgba(128,128,128,.4)}',
    '.pk-t tr.pk-calc td{font-weight:600}.pk-t tr.pk-calc td:first-child{font-weight:700}',
    '.pk-t td[data-cell]{text-align:center}.pk-t td[data-cell] .pk-ln{display:block;font-size:.7rem;opacity:.85;font-weight:500;line-height:1.1}',
    'body:not(.trk-theme-light) .pk-bank{box-shadow:0 0 0 1px rgba(255,255,255,.35)}',
    '.pk-t .pk-unk{color:#f0a04b}body.trk-theme-light .pk-t .pk-unk{color:#a85a00}',
    '.pk-t small{display:block;font-weight:500;opacity:.9;font-size:.7rem}',
    'body:not(.trk-theme-light) .pk-bank{box-shadow:0 0 0 1px rgba(255,255,255,.35)}',
    '.pk-bank{display:inline-block;min-width:34px;padding:1px 6px;border-radius:6px;color:#fff;font-weight:700;font-size:.72rem;text-align:center;text-shadow:0 1px 1px rgba(0,0,0,.35)}',
    '.pk-cell{margin:8px 0;padding:8px 10px;border:1px solid rgba(38,162,105,.5);border-radius:10px}',
    '.pk-cell a{cursor:pointer;color:inherit;text-decoration:underline dotted}',
    '.pk-empty{padding:10px;opacity:.75;font-size:.82rem}',
    '.pk-ptag{display:inline-flex;align-items:center;gap:4px;max-width:none;padding:1px 8px 1px 6px;border-radius:6px;border-left:4px solid #888;background:rgba(128,128,128,.12);font-weight:700;white-space:nowrap;line-height:1.35;text-align:left;vertical-align:middle}',
    '.pk-ptag i{font-style:normal;font-size:1.05em;line-height:1}',
    '.pk-ptag em.pk-warn{font-style:normal;color:#f0a04b;margin-left:2px}body.trk-theme-light .pk-ptag em.pk-warn{color:#b45f00}',
    '.pk-d-corp.pk-ptag{border-left-color:#3b82f6;background:rgba(59,130,246,.14)}',
    '.pk-d-retail.pk-ptag{border-left-color:#d9468f;background:rgba(217,70,143,.14)}',
    '.pk-ptag.pk-old{opacity:.85}',
    '.pk-dsec{margin-top:16px;padding:10px 12px 12px;border-radius:12px;border:1px solid rgba(128,128,128,.28);border-top-width:4px}',
    '.pk-dsec.pk-d-corp{border-top-color:#3b82f6}.pk-dsec.pk-d-retail{border-top-color:#d9468f}',
    '.pk-dsec h4.pk-dh{margin:0 0 8px;font-size:.95rem}',
    '.pk-dsec h5{margin:12px 0 6px;font-size:.82rem}',
    '.pk-dir.pk-d-corp{border-left:4px solid #3b82f6}.pk-dir.pk-d-retail{border-left:4px solid #d9468f}',
    '.pk-legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:.75rem;opacity:.9;margin:4px 0 0}',
    '.pk-t thead th{vertical-align:middle}',
    '.pk-ptag.pk-shared{border-left-width:0;padding-left:8px;background-image:linear-gradient(rgba(128,128,128,0),rgba(128,128,128,0)),linear-gradient(180deg,#3b82f6 0 50%,#d9468f 50% 100%);background-size:100% 100%,4px 100%;background-repeat:no-repeat;background-position:0 0,0 0;box-shadow:inset 0 0 0 1px rgba(168,85,247,.55)}',
    '.pk-d-corp.pk-ptag.pk-shared{background-color:rgba(59,130,246,.14)}.pk-d-retail.pk-ptag.pk-shared{background-color:rgba(217,70,143,.14)}',
    '.pk-ptag b.pk-sh{font-weight:800;color:#a855f7;margin-left:3px;font-size:.85em}body.trk-theme-light .pk-ptag b.pk-sh{color:#7e22ce}',
    '.pk-sec h4 .pk-btn{margin-left:10px;vertical-align:middle}',
    '.pk-ed{display:flex;flex-direction:column;gap:12px}',
    '.pk-edcol{border:1px solid rgba(128,128,128,.28);border-radius:10px;padding:8px 10px 10px;border-top-width:4px}',
    '.pk-edcol.pk-d-corp{border-top-color:#3b82f6}.pk-edcol.pk-d-retail{border-top-color:#d9468f}',
    '.pk-edcol h5{margin:0 0 8px;font-size:.85rem;display:flex;align-items:center;gap:8px}.pk-edcol h5 .pk-mute{font-weight:500;margin-left:auto}',
    '.pk-edrow{display:flex;align-items:center;gap:6px;padding:4px 6px;margin:3px 0;border-radius:8px;border:1px solid rgba(128,128,128,.22);background:rgba(128,128,128,.05)}',
    '.pk-edrow.pk-drag{opacity:.45}.pk-edrow.pk-over{box-shadow:0 -2px 0 #26a269}',
    '.pk-edrow.pk-shared{border-color:rgba(168,85,247,.6);background:rgba(168,85,247,.10)}',
    '.pk-edrow.pk-new{border-style:dashed;border-color:rgba(38,162,105,.7)}.pk-edrow.pk-chg input[type=text]{border-color:#d68910}',
    '.pk-edrow.pk-del{opacity:.5}.pk-edrow.pk-del input[type=text]{text-decoration:line-through}',
    '.pk-edrow.pk-dup input[type=text]{border-color:#e74c3c;background:rgba(231,76,60,.08)}',
    '.pk-hd{cursor:grab;opacity:.55;user-select:none;padding:0 2px;font-size:.9rem}.pk-hd:active{cursor:grabbing}',
    '.pk-edrow input[type=text]{flex:1;min-width:120px;padding:4px 7px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;font:inherit;font-size:.82rem;font-weight:600}',
    '.pk-edrow label{display:inline-flex;align-items:center;gap:3px;font-size:.72rem;opacity:.85;white-space:nowrap}',
    '.pk-edrow .pk-cnt{font-size:.7rem;opacity:.75;min-width:44px;text-align:right;white-space:nowrap}',
    '.pk-shb{font-size:.68rem;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(168,85,247,.18);color:#c084fc;white-space:nowrap}body.trk-theme-light .pk-shb{color:#7e22ce}',
    '.pk-edrow .pk-btn[disabled]{opacity:.35;cursor:not-allowed}',
    '.pk-edadd{display:flex;gap:6px;margin-top:8px}.pk-edadd input{flex:1;padding:4px 7px;border-radius:6px;border:1px dashed rgba(38,162,105,.7);background:transparent;color:inherit;font:inherit;font-size:.82rem}',
    '.pk-edbar{position:sticky;bottom:-18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:10px 0 4px;background:inherit}',
    '.pk-box .pk-edbar{background:#1d2026}body.trk-theme-light .pk-box .pk-edbar{background:#fff}',
    '.pk-edbar .pk-mute{margin-right:auto}',
    '.pk-edhint{font-size:.74rem;opacity:.85;margin:0 0 8px}',
    '.pk-box.pk-box--ed{width:min(820px,94vw)}',
    '.pk-pop{position:fixed;z-index:20050;display:none;min-width:300px;max-width:min(520px,92vw);max-height:46vh;overflow:auto;padding:8px 10px 10px;border-radius:10px;background:#262a32;color:#e6e6e6;border:1px solid rgba(38,162,105,.7);box-shadow:0 12px 34px rgba(0,0,0,.5);font-size:.82rem}',
    'body.trk-theme-light .pk-pop{background:#fff;color:#1f2328;box-shadow:0 12px 34px rgba(15,23,42,.22)}',
    '.pk-pop .pk-cell{margin:0;padding:0;border:0}.pk-pop .pk-plan{margin:5px 0 0}.pk-pop a{cursor:pointer;color:inherit;text-decoration:underline dotted}',
    '.pk-t td.pk-cell-on{outline:2px solid #26a269;outline-offset:-2px;background:rgba(38,162,105,.16)}',
    '.pk-ptag.pk-tt{border-left:0;padding:1px 7px;background:rgba(128,128,128,.12)}',
    '.pk-ptag.pk-tt.pk-tsh{background:rgba(168,85,247,.18);box-shadow:inset 0 0 0 1px rgba(168,85,247,.6);color:#d8b4fe}body.trk-theme-light .pk-ptag.pk-tt.pk-tsh{color:#6b21a8;background:rgba(168,85,247,.12)}',
    '.pk-edrow{flex-wrap:wrap}',
    '.pk-edrow .pk-pl{display:inline-flex;align-items:center;gap:3px;font-size:.72rem;white-space:nowrap;opacity:1}',
    '.pk-edrow input[data-edplan]{width:54px;padding:3px 5px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;font:inherit;font-size:.8rem;font-weight:700;text-align:right}',
    'body:not(.trk-theme-light) .pk-edrow input[data-edplan]{color-scheme:dark}',
    '.pk-pst{font-size:.7rem;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap}',
    '.pk-pst.need{background:rgba(230,126,34,.18);color:#f0a04b}.pk-pst.ok{background:rgba(39,174,96,.18);color:#4cd387}.pk-pst.over{background:rgba(231,76,60,.18);color:#ff8a7a}.pk-pst.none{opacity:.7;border:1px dashed rgba(128,128,128,.55)}',
    'body.trk-theme-light .pk-pst.need{color:#a85a00}body.trk-theme-light .pk-pst.ok{color:#1e7d46}body.trk-theme-light .pk-pst.over{color:#b42318}',
    '.pk-edsum{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.76rem;margin:0 0 8px;padding:6px 8px;border-radius:8px;background:rgba(128,128,128,.09)}',
    '.pk-prev{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px;padding:8px 10px;border-radius:10px;border:1px dashed rgba(38,162,105,.65);font-size:.78rem}',
    '.pk-edrow.pk-fromprev{border-color:rgba(59,130,246,.65)}',
    '.pk-tip{position:fixed;z-index:20060;display:none;max-width:340px;padding:7px 10px;border-radius:9px;font-size:.78rem;font-weight:600;line-height:1.35;pointer-events:none;background:#262a32;color:#e6e6e6;border:1px solid rgba(128,128,128,.5);border-left-width:4px;box-shadow:0 10px 28px rgba(0,0,0,.4)}',
    'body.trk-theme-light .pk-tip{background:#fff;color:#1f2328;box-shadow:0 10px 28px rgba(15,23,42,.2)}',
    '.pk-tip.need{border-left-color:#e67e22}.pk-tip.ok{border-left-color:#27ae60}.pk-tip.over{border-left-color:#e74c3c}',
    '.pk-head .pk-edbtn{border-color:#26a269}.pk-head .pk-edbtn.on{background:#26a269;color:#fff}'
    ].join('\n');
    document.head.appendChild(s);
}
function bank(b) { return '<span class="pk-bank" style="background:' + e(b.color) + '" title="' + e(b.name) + '">' + e(b.short) + '</span>'; }
function open() {
    css();
    var ov = document.getElementById('pkOverlay');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'pkOverlay'; ov.className = 'pk-ov';
        ov.innerHTML = '<div class="pk-box" role="dialog" aria-modal="true"><div class="pk-head" id="pkHead"></div><div class="pk-body" id="pkBody"><div class="pk-empty">Загрузка…</div></div></div>';
        document.body.appendChild(ov);
        ov.addEventListener('mousedown', function(ev) { if (ev.target === ov) close(); });
        ov.addEventListener('click', onClick);
        ov.addEventListener('change', onChange);
        ov.addEventListener('input', onInput);
        ov.addEventListener('dragstart', onDragStart);
        ov.addEventListener('dragover', onDragOver);
        ov.addEventListener('drop', onDrop);
        ov.addEventListener('dragend', onDragEnd);
        document.getElementById('pkBody').addEventListener('scroll', popClose);
        window.addEventListener('resize', popClose);
    }
    ov.style.display = 'flex';
    document.addEventListener('keydown', onKey);
    head(); load();
}
function close() { if (ST.ed && edChanges() && !confirm('Закрыть без сохранения изменений в списках?')) return; ST.ed = null; popClose(); var ov = document.getElementById('pkOverlay'); if (ov) ov.style.display = 'none'; document.removeEventListener('keydown', onKey); }
function onKey(ev) {
    var pp = document.getElementById('pkPop');
    if (ev.key === 'Escape' && pp && pp.style.display === 'block') { popClose(); return; }
    if (ev.key === 'Escape') { if (ST.ed) { if (edChanges() && !confirm('Отменить несохранённые изменения?')) return; ST.ed = null; render(); return; } close(); return; }
    var t = ev.target;
    if (ST.ed && ev.key === 'Enter' && t && t.hasAttribute && t.hasAttribute('data-edadd')) {
        ev.preventDefault(); edSync(); var dr = t.getAttribute('data-edadd');
        if (edAdd(dr, t.value)) edRefresh('[data-edadd="' + dr + '"]');
    }
}
var DRAG = null;
function onInput(ev) {
    var t = ev.target; if (!ST.ed || !t || !t.hasAttribute) return;
    var isPlan = t.hasAttribute('data-edplan');
    if (!t.hasAttribute('data-edname') && !isPlan) return;
    edSync();
    // подсветка общих/повторов/статуса плана без перерисовки (чтобы не терять курсор)
    var sh = edShared();
    document.querySelectorAll('#pkEd .pk-edrow').forEach(function(r) {
        var dr = r.getAttribute('data-dir'), it = ST.ed.cols[dr][+r.getAttribute('data-i')], k = nkey(it.name);
        var cnt = ST.ed.cols[dr].filter(function(x) { return !x.del && nkey(x.name) === k; }).length;
        r.classList.toggle('pk-shared', !it.del && !!k && !!sh[k]);
        r.classList.toggle('pk-dup', !it.del && !!k && cnt > 1);
        r.classList.toggle('pk-chg', !!it.id && itChanged(it));
        var st = pstat(it.plan, it.fact || 0), c = r.querySelector('[data-pst]');
        if (c) { c.className = 'pk-pst ' + st.k; c.textContent = st.s; c.title = st.t; }
    });
    ['корпоративная', 'розничная'].forEach(function(dr) { var b = document.querySelector('#pkEd [data-sum="' + dr + '"]'); if (b) b.innerHTML = sumHtml(dr); });
    if (isPlan) { var row = t.closest('.pk-edrow'); if (row) edTip(t, row.getAttribute('data-dir'), ST.ed.cols[row.getAttribute('data-dir')][+row.getAttribute('data-i')]); }
    var n = edChanges(), dup = document.querySelector('#pkEd .pk-edrow.pk-dup'), bar = document.querySelector('#pkEd .pk-edbar');
    if (bar) { bar.querySelector('.pk-mute').textContent = dup ? '⚠ Повтор названия в одном направлении' : (n ? 'Изменений: ' + n : 'Изменений нет'); var sb = bar.querySelector('[data-act="edsave"]'); if (sb) sb.disabled = !n || !!dup; }
}
function onDragStart(ev) {
    var r = ev.target.closest && ev.target.closest('.pk-edrow'); if (!r || !ST.ed) return;
    if (ev.target.tagName === 'INPUT') { ev.preventDefault(); return; }
    edSync(); DRAG = { dir: r.getAttribute('data-dir'), i: +r.getAttribute('data-i') }; r.classList.add('pk-drag');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'pk'); } catch (x) {}
}
function onDragOver(ev) {
    if (!DRAG) return; var r = ev.target.closest && ev.target.closest('.pk-edrow');
    document.querySelectorAll('#pkEd .pk-over').forEach(function(x) { if (x !== r) x.classList.remove('pk-over'); });
    if (r && r.getAttribute('data-dir') === DRAG.dir) { ev.preventDefault(); r.classList.add('pk-over'); }
}
function onDrop(ev) {
    if (!DRAG) return; var r = ev.target.closest && ev.target.closest('.pk-edrow');
    if (r && r.getAttribute('data-dir') === DRAG.dir) {
        ev.preventDefault(); var L = ST.ed.cols[DRAG.dir], to = +r.getAttribute('data-i');
        var it = L.splice(DRAG.i, 1)[0]; L.splice(to, 0, it);
    }
    DRAG = null; edRefresh();
}
function onDragEnd() { if (DRAG) { DRAG = null; edRefresh(); } }
function head() {
    var h = '<h3>🗂 Карманы</h3>'
        + '<span class="pk-seg"><button data-act="yprev" title="Предыдущий год">◀</button><button class="active" style="cursor:default">' + ST.year + '</button><button data-act="ynext" title="Следующий год">▶</button></span>'
        + '<span class="pk-seg" id="pkDirSeg">' + DIRS.map(function(d) { return '<button data-dir="' + e(d[0]) + '" class="' + (ST.dir === d[0] ? 'active' : '') + '">' + e(d[1]) + '</button>'; }).join('') + '</span>'
        + '<button class="pk-btn pk-edbtn' + (ST.ed ? ' on' : '') + '" data-act="' + (ST.ed ? 'edcancel' : 'edopen') + '" title="' + (ST.ed ? 'Вернуться к таблицам' : 'Карманы года по направлениям и план проверок на каждый карман') + '">📋 Справочник и планы</button>'
        + '<button class="pk-btn x" data-act="close" title="Закрыть (Esc)">✕</button>';
    document.getElementById('pkHead').innerHTML = h;
}
function load() {
    api('/api/plugins/pockets/data?year=' + ST.year + '&dir=' + encodeURIComponent(ST.dir)).then(function(d) {
        if (!d || !d.success) { document.getElementById('pkBody').innerHTML = '<div class="pk-empty">Ошибка: ' + e(d && d.error) + '</div>'; return; }
        ST.d = d;
        ST.shared = calcShared(d.pockets);
        setList(d.all_pockets || d.pockets);
        if (ST.ed) edStart();
        render();
    });
}
function pn(v) { v = String(v == null ? '' : v).trim(); if (v === '') return ''; var n = parseInt(v, 10); return isNaN(n) ? 'x' : String(n); }
function itChanged(it) { return it.name.trim() !== it.orig || it.is_active !== it.orig_active || pn(it.plan) !== pn(it.orig_plan); }
function plw(n, acc) { n = Math.abs(n); var a = n % 10, b = n % 100; if (a === 1 && b !== 11) return acc ? 'проверку' : 'проверка'; if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'проверки'; return 'проверок'; }
function pstat(plan, fact) {
    var p = pn(plan);
    if (p === '' || p === 'x') return { k: 'none', s: 'без плана', t: 'План не задан' };
    var d = (+p) - fact;
    if (d > 0) return { k: 'need', s: (d === 1 ? 'нужна ещё 1' : 'нужно ещё ' + d), t: (d === 1 ? 'Нужна ещё 1 проверка' : 'Нужно ещё ' + d + ' ' + plw(d)) };
    if (d < 0) return { k: 'over', s: 'больше плана на ' + (-d), t: 'Заведено больше планового на ' + (-d) + ' ' + plw(-d, true) };
    return { k: 'ok', s: '✓ план выполнен', t: 'План выполнен' };
}
function edSum(dr) {
    var r = { P: 0, F: 0, np: 0, cnt: 0 };
    ST.ed.cols[dr].forEach(function(it) { if (it.del || !nkey(it.name)) return; r.cnt++; var p = pn(it.plan); if (p === '' || p === 'x') { r.np++; return; } r.P += +p; r.F += (it.fact || 0); });
    r.has = r.cnt - r.np > 0; return r;
}
function sumHtml(dr) {
    var s = edSum(dr);
    if (!s.has) return '<span class="pk-mute">План на ' + ST.year + ' год не задан' + (s.cnt ? ' ни для одного кармана' : '') + '</span>';
    var st = pstat(s.P, s.F);
    return '<b>Итого:</b><span>план ' + s.P + ' · заведено ' + s.F + '</span><span class="pk-pst ' + st.k + '" title="' + e(st.t) + '">' + e(st.k === 'ok' ? '✓ план выполнен' : st.t) + '</span>'
        + (s.np ? '<span class="pk-mute">без плана: ' + s.np + ' карм. — в итог не входят</span>' : '');
}
var TIPT = null;
function tipHide() { var tp = document.getElementById('pkTip'); if (tp) tp.style.display = 'none'; }
function edTip(a, dr, it) {
    var ov = document.getElementById('pkOverlay'); if (!ov || !a) return;
    var tip = document.getElementById('pkTip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'pkTip'; tip.className = 'pk-tip'; tip.setAttribute('role', 'status'); tip.setAttribute('aria-live', 'polite'); ov.appendChild(tip); }
    var st = pstat(it.plan, it.fact || 0), s = edSum(dr), p = pn(it.plan);
    var h = '«' + e(it.name.trim() || 'карман') + '»: ' + (st.k === 'none' ? 'план не задан' : 'план ' + p + ', заведено ' + (it.fact || 0) + ' — ' + e(st.t.charAt(0).toLowerCase() + st.t.slice(1)));
    if (s.has) { var ss = pstat(s.P, s.F); h += '<br><span style="font-weight:500">' + DMETA[dr].ic + ' Итого по направлению: план ' + s.P + ', заведено ' + s.F + ' — ' + e(ss.t.charAt(0).toLowerCase() + ss.t.slice(1)) + '</span>'; }
    tip.className = 'pk-tip ' + st.k; tip.innerHTML = h; tip.style.display = 'block';
    var r = a.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
    var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)), y = r.top - hh - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
    clearTimeout(TIPT); TIPT = setTimeout(tipHide, 4000);
}
function edPrevLeft() {
    var n = 0;
    (ST.d.prev_pockets || []).forEach(function(p) { var L = ST.ed.cols[p.direction]; if (L && !L.some(function(x) { return !x.del && nkey(x.name) === nkey(p.name); })) n++; });
    return n;
}
function edPrev() {
    var n = 0;
    (ST.d.prev_pockets || []).forEach(function(p) {
        var L = ST.ed.cols[p.direction]; if (!L || L.some(function(x) { return !x.del && nkey(x.name) === nkey(p.name); })) return;
        L.push({ id: 0, name: p.name, orig: '', is_active: !!p.is_active, orig_active: true, plan: '', orig_plan: '', fact: 0, tasks: 0, del: false, prev: true }); n++;
    });
    msg('📥 Подтянуто из ' + ST.d.prev_year + ' года: ' + n + '. Переименуйте или удалите лишние, задайте план и сохраните');
}
function edStart() {
    var cols = {};
    ['корпоративная', 'розничная'].forEach(function(dr) {
        cols[dr] = ST.d.pockets.filter(function(p) { return p.direction === dr; })
            .map(function(p) { var pl = p.plan_count == null ? '' : String(p.plan_count);
                return { id: p.id, name: p.name, orig: p.name, is_active: !!p.is_active, orig_active: !!p.is_active, plan: pl, orig_plan: pl, fact: p.fact || 0, tasks: p.tasks_total || 0, del: false }; });
    });
    ST.ed = { cols: cols, orig: JSON.stringify(cols), year: ST.year };
}
function edSync() {
    // считать значения из инпутов в модель
    var box = document.getElementById('pkEd'); if (!box || !ST.ed) return;
    box.querySelectorAll('.pk-edrow').forEach(function(r) {
        var it = ST.ed.cols[r.getAttribute('data-dir')][+r.getAttribute('data-i')]; if (!it) return;
        var inp = r.querySelector('input[type=text]'), cb = r.querySelector('input[type=checkbox]');
        if (inp) it.name = inp.value; if (cb) it.is_active = cb.checked;
        var pi = r.querySelector('[data-edplan]'); if (pi) it.plan = pi.value.trim();
    });
}
function edShared() {
    var all = [];
    Object.keys(ST.ed.cols).forEach(function(dr) { ST.ed.cols[dr].forEach(function(it) { if (!it.del) all.push({ name: it.name, direction: dr }); }); });
    return calcShared(all);
}
function edChanges() {
    var n = 0;
    Object.keys(ST.ed.cols).forEach(function(dr) {
        ST.ed.cols[dr].forEach(function(it, i) {
            if (!it.id) { if (nkey(it.name) && !it.del) n++; return; }
            if (it.del || itChanged(it)) n++;
        });
    });
    var o = JSON.parse(ST.ed.orig);
    Object.keys(o).forEach(function(dr) {
        var a = o[dr].map(function(x) { return x.id; }).join(','), b = ST.ed.cols[dr].filter(function(x) { return x.id; }).map(function(x) { return x.id; }).join(',');
        if (a !== b) n++;
    });
    return n;
}
function edRender() {
    var RO = !ST.d.can_edit, Y = ST.year, sh = edShared();
    var h = '<div id="pkEd"><div class="pk-edhint">' + (RO ? 'Просмотр: менять справочник и планы может администратор. ' : 'Карманы и план задаются на каждый год отдельно. Порядок — перетаскиванием за ⋮⋮ или стрелками; переименование переносится в проверки ' + Y + ' года. ')
        + '<b>План</b> — сколько проверок нужно завести в карман за год, <b>факт</b> — проверки ' + Y + ' года с этим карманом (по дате начала, без отменённых). '
        + '<span class="pk-shb">⇄ общий</span> — такой же карман есть в другом направлении.</div>';
    var pp = ST.d.prev_pockets || [];
    if (!RO && ST.d.prev_year && pp.length) {
        var left = edPrevLeft();
        h += '<div class="pk-prev"><span>📥 В ' + ST.d.prev_year + ' году карманов: <b>' + pp.length + '</b>' + (left ? ', нет в ' + Y + ': <b>' + left + '</b>' : ' — все уже есть в ' + Y) + '</span>'
           + (left ? '<button class="pk-btn mini pri" data-act="edprev">Подтянуть из ' + ST.d.prev_year + '</button><span class="pk-mute">добавятся как новые: до сохранения их можно переименовать или удалить, план не переносится</span>' : '') + '</div>';
    }
    h += '<div class="pk-ed">';
    ['корпоративная', 'розничная'].forEach(function(dr) {
        var M = DMETA[dr], list = ST.ed.cols[dr], other = dr === 'корпоративная' ? 'розничная' : 'корпоративная';
        var seen = {}, live = list.filter(function(x) { return !x.del && nkey(x.name); });
        list.forEach(function(it) { var k = nkey(it.name); if (k && !it.del) seen[k] = (seen[k] || 0) + 1; });
        h += '<div class="pk-edcol ' + M.cl + '"><h5>' + M.ic + ' ' + M.t + '<span class="pk-mute">' + live.length + ' карм.</span></h5>';
        h += '<div class="pk-edsum" data-sum="' + e(dr) + '">' + sumHtml(dr) + '</div>';
        if (!list.length) h += '<div class="pk-empty">На ' + Y + ' год карманов нет' + (RO ? '' : ' — добавьте новый' + (pp.length ? ' или подтяните из ' + ST.d.prev_year + ' года' : '')) + '</div>';
        list.forEach(function(it, i) {
            var k = nkey(it.name), cls = 'pk-edrow';
            if (!it.id) cls += ' pk-new' + (it.prev ? ' pk-fromprev' : ''); else if (itChanged(it)) cls += ' pk-chg';
            if (it.del) cls += ' pk-del'; if (!it.del && k && sh[k]) cls += ' pk-shared'; if (!it.del && k && seen[k] > 1) cls += ' pk-dup';
            var canDel = !it.tasks, st = pstat(it.plan, it.fact || 0), dis = (it.del || RO) ? ' disabled' : '';
            h += '<div class="' + cls + '"' + (RO ? '' : ' draggable="true"') + ' data-dir="' + e(dr) + '" data-i="' + i + '">'
               + (RO ? '' : '<span class="pk-hd" title="Перетащить">⋮⋮</span>')
               + '<input type="text" maxlength="100" value="' + e(it.name) + '" data-edname' + dis + ' placeholder="Название кармана">'
               + (!it.del && k && sh[k] ? '<span class="pk-shb" title="Есть и в направлении «' + e(DMETA[other].t) + '»">⇄ общий</span>' : '')
               + (!RO && !it.del && k && !sh[k] ? '<button class="pk-btn mini" data-act="edcopy" data-dir="' + e(dr) + '" data-i="' + i + '" title="Добавить такой же карман в направление «' + e(DMETA[other].t) + '»">⇄ ' + DMETA[other].ic + '</button>' : '')
               + '<span class="pk-cnt" title="Проверок ' + Y + ' года с этим карманом">' + (it.id ? 'факт ' + (it.fact || 0) : (it.prev ? 'из ' + ST.d.prev_year : 'новый')) + '</span>'
               + '<label class="pk-pl" title="План проверок в карман на ' + Y + ' год">план<input type="number" min="0" max="500" step="1" inputmode="numeric" data-edplan value="' + e(it.plan) + '" placeholder="—"' + dis + '></label>'
               + '<span class="pk-pst ' + st.k + '" data-pst title="' + e(st.t) + '">' + e(st.s) + '</span>'
               + '<label title="Закрытый карман не предлагается при создании проверок"><input type="checkbox"' + (it.is_active ? ' checked' : '') + dis + '> актив.</label>'
               + (RO ? '' : '<button class="pk-btn mini" data-act="edup" data-dir="' + e(dr) + '" data-i="' + i + '" title="Выше"' + (i ? '' : ' disabled') + '>↑</button>'
                   + '<button class="pk-btn mini" data-act="eddown" data-dir="' + e(dr) + '" data-i="' + i + '" title="Ниже"' + (i < list.length - 1 ? '' : ' disabled') + '>↓</button>'
                   + (it.del ? '<button class="pk-btn mini" data-act="edundel" data-dir="' + e(dr) + '" data-i="' + i + '" title="Вернуть">↺</button>'
                             : '<button class="pk-btn mini" data-act="eddel" data-dir="' + e(dr) + '" data-i="' + i + '"' + (canDel ? ' title="Удалить"' : ' disabled title="Карман указан в проверках ' + Y + ' года — его можно только закрыть (снять «актив.»)"') + '>🗑</button>'))
               + '</div>';
        });
        if (!RO) h += '<div class="pk-edadd"><input type="text" maxlength="100" data-edadd="' + e(dr) + '" placeholder="Новый карман (Enter — добавить)"><button class="pk-btn mini" data-act="edadd" data-dir="' + e(dr) + '">+ Добавить</button></div>';
        h += '</div>';
    });
    var n = RO ? 0 : edChanges(), dup = h.indexOf('pk-dup"') > -1;
    h += '</div><div class="pk-edbar"><span class="pk-mute">' + (RO ? '' : (dup ? '⚠ Повтор названия в одном направлении' : (n ? 'Изменений: ' + n : 'Изменений нет'))) + '</span>'
       + (RO ? '<button class="pk-btn" data-act="edcancel">← К таблицам</button>'
             : '<button class="pk-btn" data-act="edcancel">Отмена</button><button class="pk-btn pri" data-act="edsave"' + (n && !dup ? '' : ' disabled') + '>💾 Сохранить</button>') + '</div></div>';
    return h;
}
function edRefresh(focusSel) {
    var box = document.getElementById('pkEd'); if (!box) return;
    var tmp = document.createElement('div'); tmp.innerHTML = edRender(); box.parentNode.replaceChild(tmp.firstChild, box);
    if (focusSel) { var f = document.querySelector(focusSel); if (f) f.focus(); }
}
function edAdd(dr, name) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!name) return false;
    var list = ST.ed.cols[dr];
    if (list.some(function(x) { return !x.del && nkey(x.name) === nkey(name); })) { msg('❌ «' + name + '» уже есть в этом направлении', true); return false; }
    list.push({ id: 0, name: name, orig: '', is_active: true, orig_active: true, plan: '', orig_plan: '', fact: 0, tasks: 0, del: false });
    return true;
}
function edSave() {
    edSync();
    var bad = null, payload = {};
    Object.keys(ST.ed.cols).forEach(function(dr) {
        var seen = {};
        payload[dr] = { items: [], deleted: [] };
        ST.ed.cols[dr].forEach(function(it) {
            if (it.del) { if (it.id) payload[dr].deleted.push(it.id); return; }
            var nm = it.name.trim().replace(/\s+/g, ' '), k = nkey(nm);
            if (!k) { if (it.id) bad = bad || 'Пустое название у кармана «' + it.orig + '»'; return; }
            if (seen[k]) bad = bad || 'Повтор «' + nm + '» в направлении «' + DMETA[dr].t + '»'; seen[k] = 1;
            var pc = pn(it.plan); if (pc === 'x' || (pc !== '' && !(+pc >= 0 && +pc <= 500))) bad = bad || 'План кармана «' + nm + '» — целое число от 0 до 500';
            payload[dr].items.push({ id: it.id || 0, name: nm, is_active: it.is_active, plan_count: pc });
        });
    });
    if (bad) { msg('❌ ' + bad, true); return; }
    api('/api/plugins/pockets/bulk', { year: ST.year, lists: payload }).then(function(r) {
        if (r && r.success) { done(r, '✅ Справочник и планы на ' + ST.year + ' год сохранены' + (r.renamed_in_tasks ? ', обновлено проверок: ' + r.renamed_in_tasks : '')); }
        else done(r);
    });
}
function render() {
    var d = ST.d, ed = d.can_edit;
    popClose(); head();
    var bx = document.querySelector('#pkOverlay .pk-box'); if (bx) bx.classList.toggle('pk-box--ed', !!ST.ed);
    if (ST.ed) {
        document.getElementById('pkBody').innerHTML = '<div class="pk-sec"><h4>📋 Справочник карманов и планы на ' + ST.year + ' год</h4>' + edRender() + '</div>';
        return;
    }
    var h = '';
    if (!d.pockets.length) h += '<div class="pk-sec"><div class="pk-cell" style="border-color:rgba(240,160,75,.6)"><b>На ' + ST.year + ' год карманов нет.</b> <span class="pk-mute">'
        + (ed ? 'Откройте «📋 Справочник и планы», чтобы добавить карманы' + (d.prev_year ? ' или подтянуть их из ' + d.prev_year + ' года' : '') : 'Справочник на этот год ещё не заполнен') + '.</span></div></div>';
    h += '<div id="pkCellBox"></div>';
    h += '<div class="pk-legend">Обозначения: <span class="pk-ptag pk-tt pk-tsh">ПВР<b class="pk-sh">⇄</b></span><span class="pk-mute">— общий карман: есть в обоих направлениях</span>' + '<span class="pk-ptag" style="border-left-color:transparent;background:transparent;padding-left:0"><em class="pk-warn" style="margin:0">⚠</em></span> <span class="pk-mute">— значения нет в справочнике, замените в карточке проверки</span>' + '</div>';
    var mm = d.matrices || {};
    DIRS.slice(1).forEach(function(dr) {
        if (ST.dir && ST.dir !== dr[0]) return;
        var M = DMETA[dr[0]]; if (mm[M.k]) h += dirTables(mm[M.k], dr[0], M);
    });
    if (d.nodir && d.nodir.length) {
        h += '<div class="pk-sec"><div class="pk-cell" style="border-color:rgba(240,160,75,.6)"><b>⚠ Без направления: ' + d.nodir.length + '</b> <span class="pk-mute">— не попадают ни в одну таблицу, укажите направление в карточке проверки</span>';
        d.nodir.forEach(function(t) { h += '<div class="pk-plan" style="margin-left:0">• <a data-act="opentask" data-id="' + e(t.id) + '">' + e(t.name) + '</a><span class="pk-mute">' + e(STL[t.status] || t.status) + ' · ' + fd(t.start) + '–' + fd(t.deadline) + (t.pocket ? ' · карман «' + e(t.pocket) + '»' : '') + '</span></div>'; });
        h += '</div></div>';
    }
    h += '<div class="pk-mute" style="margin-top:8px">Числа — фактические проверки «Карты проверок» с датой начала в ' + ST.year + ' году (кроме отменённых). Банк-участник — банк, выбранный в банках проверки. ПШЕ — нормативная численность направления из карточки банка. Клик по ячейке — список проверок.</div>';
    document.getElementById('pkBody').innerHTML = h;
}
function dirTables(m, dir, M) {
    var cols = m.cols, NONE = '__none', pre = M.k + '|';
    var keys = cols.map(function(c) { return c.key; }).concat([NONE]);
    var h = '<div class="pk-dsec ' + M.cl + '"><h4 class="pk-dh">' + M.ic + ' ' + M.t + ' направление · ' + ST.year + ' <span class="pk-mute">· проверок: ' + (m.total_tasks || 0) + '</span></h4>';
    if (!m.total_tasks) h += '<div class="pk-empty">Нет проверок этого направления с датой начала в ' + ST.year + ' году</div>';
    // Таблица 1: банк-руководитель × карман
    h += '<h5>1. Банки-руководители проверок по карманам</h5>';
    h += '<div class="pk-tw"><table class="pk-t"><thead><tr><th>ТБ</th>' + cols.map(function(c) { return '<th' + (shCol(c) ? ' class="pk-thsh"' : '') + '>' + ptagT(c.name, c.direction, c.unknown) + '</th>'; }).join('') + '<th>Вне кармана</th><th>Итого</th></tr></thead><tbody>';
    m.banks.forEach(function(b) {
        var row = m.t1[b.id] || {}, tot = 0;
        h += '<tr><td>' + bank(b) + ' <span class="pk-mute">' + e(b.name) + '</span></td>';
        keys.forEach(function(k, ki) {
            var ids = row[k] || []; tot += ids.length;
            var sc = shCol(cols[ki]) ? ' class="pk-tdsh"' : '';
            if (!ids.length) { h += '<td' + sc + '></td>'; return; }
            var sn = []; ids.forEach(function(id) { var s = m.tasks[id].lead_short; if (s && sn.indexOf(s) < 0) sn.push(s); });
            h += '<td' + sc + ' data-cell="' + pre + 't1|' + e(b.id) + '|' + e(k) + '"><b>' + ids.length + '</b>' + (sn.length ? '<span class="pk-ln">' + e(sn.join(', ')) + '</span>' : '') + '</td>';
        });
        h += '<td><b>' + (tot || '') + '</b></td></tr>';
    });
    var g1 = 0;
    h += '<tr class="pk-tot"><td>Итого</td>' + keys.map(function(k, ki) { var v = m.t1_total[k] || 0; g1 += v; return '<td' + (shCol(cols[ki]) ? ' class="pk-tdsh"' : '') + '>' + (v || '') + '</td>'; }).join('') + '<td>' + (g1 || '') + '</td></tr>';
    h += '</tbody></table></div>';
    // Таблица 2: карман × банк-участник
    h += '<h5>2. Банки-участники: число проверок по карманам</h5>';
    h += '<div class="pk-tw"><table class="pk-t"><thead><tr><th>Карман</th>' + m.banks.map(function(b) { return '<th>' + bank(b) + '</th>'; }).join('') + '<th>Итого</th></tr></thead><tbody>';
    cols.concat([{ key: NONE, name: 'Вне кармана', direction: '' }]).forEach(function(c) {
        var r = m.t2[c.key] || {}, tot = 0;
        h += '<tr' + (shCol(c) ? ' class="pk-trsh"' : '') + '><td>' + (c.key === NONE ? 'Вне кармана' : ptagT(c.name, c.direction, c.unknown)) + '</td>';
        m.banks.forEach(function(b) { var ids = r[b.id] || []; tot += ids.length; h += ids.length ? '<td data-cell="' + pre + 't2|' + e(b.id) + '|' + e(c.key) + '">' + ids.length + '</td>' : '<td></td>'; });
        h += '<td><b>' + (tot || '') + '</b></td></tr>';
    });
    var g2 = 0;
    h += '<tr class="pk-tot"><td>Итого</td>' + m.banks.map(function(b) { var v = m.t2_total[b.id] || 0; g2 += v; return '<td>' + (v || '') + '</td>'; }).join('') + '<td>' + (g2 || '') + '</td></tr>';
    var hcSum = 0, hcCnt = 0; m.banks.forEach(function(b) { var v = parseFloat(b.hc[M.k]); if (v > 0) { hcSum += v; hcCnt += (m.t2_total[b.id] || 0); } });
    h += '<tr class="pk-calc"><td title="Нормативная (штатная) численность направления из карточки банка">Кол-во ПШЕ</td>' + m.banks.map(function(b) { return '<td>' + n(b.hc[M.k]) + '</td>'; }).join('') + '<td>' + (hcSum ? n(hcSum) : '—') + '</td></tr>';
    h += '<tr class="pk-calc"><td title="Итого по банку (участия в проверках направления) / кол-во ПШЕ">Проверок в год на ПШЕ</td>' + m.banks.map(function(b) { return '<td>' + n2(b.per_hc[M.k]) + '</td>'; }).join('') + '<td title="По банкам с заданной численностью">' + (hcSum ? n2(hcCnt / hcSum) : '—') + '</td></tr>';
    h += '</tbody></table></div></div>';
    return h;
}
function showCell(c, anchor) {
    var p = c.split('|'), dk = p[0], tbl = p[1], b = p[2], k = p.slice(3).join('|');
    var m = (ST.d.matrices || {})[dk]; if (!m) return;
    var ids = tbl === 't1' ? ((m.t1[b] || {})[k] || []) : ((m.t2[k] || {})[b] || []);
    var bk = m.banks.filter(function(x) { return x.id === b; })[0] || { name: b, short: '?', color: '#888' };
    var col = m.cols.filter(function(x) { return x.key === k; })[0];
    var dir = dk === 'corp' ? 'корпоративная' : 'розничная';
    var h = '<div class="pk-cell"><div class="pk-line"><b>' + (tbl === 't1' ? 'Руководит: ' : 'Участвует: ') + '</b>' + bank(bk) + ' · ' + (col ? ptag(col.name, col.direction, col.unknown) : DMETA[dir].ic + ' вне кармана')
        + '<button class="pk-btn mini" data-act="cellclose" style="margin-left:auto">✕</button></div>';
    ids.forEach(function(id) { var t = m.tasks[id]; h += '<div class="pk-plan" style="margin-left:0">• <a data-act="opentask" data-id="' + e(id) + '">' + e(t.name) + '</a><span class="pk-mute">' + e(STL[t.status] || t.status) + ' · ' + fd(t.start) + '–' + fd(t.deadline) + (t.lead ? ' · рук. ' + e(t.lead) : '') + '</span></div>'; });
    var ov = document.getElementById('pkOverlay'), pop = document.getElementById('pkPop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'pkPop'; pop.className = 'pk-pop'; pop.setAttribute('role', 'dialog'); ov.appendChild(pop); }
    popClose(); ST.cell = c;
    pop.innerHTML = h + '</div>'; pop.style.display = 'block';
    if (anchor) anchor.classList.add('pk-cell-on');
    popPlace(pop, anchor);
}
function val(scope, f) { var el = scope.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; }
function done(r, ok) { if (r && r.success) { if (ok) msg(ok); load(); } else msg('❌ ' + ((r && r.error) || 'Ошибка'), true); }
function newTask(pid) {
    var p = ST.d.pockets.filter(function(x) { return x.id === pid; })[0]; if (!p) return;
    close();
    if (typeof window.openTaskModal !== 'function') { msg('Откройте «Новая проверка» вручную', true); return; }
    window.openTaskModal(null, 'audit');
    setTimeout(function() {
        var tt = document.getElementById('task_type'); if (tt) { tt.value = p.direction; tt.dispatchEvent(new Event('change', { bubbles: true })); }
        var ps = document.getElementById('task_pocket'); if (ps) { ps.setAttribute('data-cur', p.name); if (window.trkFillPocketOptions) window.trkFillPocketOptions(); else ps.value = p.name; }
    }, 60);
}
function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-dir],[data-cell]') : null;
    if (!(ev.target.closest && ev.target.closest('#pkPop')) && !(t && t.hasAttribute('data-cell'))) popClose();
    if (!t) return;
    if (t.hasAttribute('data-cell')) { var cc = t.getAttribute('data-cell'); if (ST.cell === cc && t.classList.contains('pk-cell-on')) { popClose(); return; } showCell(cc, t); return; }
    var a = t.getAttribute('data-act');
    if (!a && t.parentNode && t.parentNode.id === 'pkDirSeg' && ST.ed) { edSync(); if (edChanges() && !confirm('Несохранённые изменения справочника пропадут. Продолжить?')) return; }
    if (!a && t.parentNode && t.parentNode.id === 'pkDirSeg') { ST.dir = t.getAttribute('data-dir'); try { localStorage.setItem('pk.dir', ST.dir); } catch (x) {} ST.cell = null; head(); load(); return; }
    var id = +t.getAttribute('data-id') || 0;
    if (a === 'close') return close();
    if ((a === 'yprev' || a === 'ynext') && ST.ed) { edSync(); if (edChanges() && !confirm('Сменить год? Несохранённые изменения справочника пропадут.')) return; }
    if (a === 'yprev' || a === 'ynext') { ST.year += (a === 'ynext' ? 1 : -1); ST.cell = null; head(); load(); return; }
    if (a === 'cellclose') { popClose(); return; }
    if (a === 'opentask') { var tid = t.getAttribute('data-id'); close(); if (window.trkOpenTaskById) window.trkOpenTaskById(tid); return; }
    if (a === 'edopen') { popClose(); edStart(); render(); return; }
    if (ST.ed && a && a.indexOf('ed') === 0) {
        edSync();
        var edr = t.getAttribute('data-dir'), ei = +t.getAttribute('data-i'), L = edr ? ST.ed.cols[edr] : null;
        if (a === 'edcancel') { if (edChanges() && !confirm('Отменить несохранённые изменения?')) return; ST.ed = null; render(); return; }
        if (a === 'edsave') { edSave(); return; }
        if (a === 'edup' && ei > 0) { var x = L.splice(ei, 1)[0]; L.splice(ei - 1, 0, x); }
        if (a === 'eddown' && ei < L.length - 1) { var y = L.splice(ei, 1)[0]; L.splice(ei + 1, 0, y); }
        if (a === 'eddel') { if (!L[ei].id) L.splice(ei, 1); else L[ei].del = true; }
        if (a === 'edundel') L[ei].del = false;
        if (a === 'edadd') { var ai = document.querySelector('[data-edadd="' + edr + '"]'); if (!edAdd(edr, ai && ai.value)) { ai && ai.focus(); return; } }
        if (a === 'edprev') edPrev();
        if (a === 'edcopy') { var oth = edr === 'корпоративная' ? 'розничная' : 'корпоративная'; edAdd(oth, L[ei].name); }
        edRefresh(a === 'edadd' ? '[data-edadd="' + edr + '"]' : null);
        return;
    }
    if (a === 'newtask') { newTask(id); return; }
}
function onChange(ev) {
    var t = ev.target;
    if (ST.ed) { if (t.type === 'checkbox') onInput({ target: (t.closest('.pk-edrow') || t).querySelector('[data-edname]') || t }); return; }
    if (t.getAttribute && t.getAttribute('data-act') === 'active') {
        var id = +t.getAttribute('data-id'), p = ST.d.pockets.filter(function(x) { return x.id === id; })[0]; if (!p) return;
        api('/api/plugins/pockets/save', { id: id, name: p.name, direction: p.direction, is_active: t.checked, comment: p.comment || '' })
            .then(function(r) { done(r, t.checked ? '✅ Карман открыт' : '✅ Карман закрыт'); });
    }
}
window.trkOpenPockets = open;
document.addEventListener('click', function(ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('#openPocketsBtn') : null;
    if (b) { ev.preventDefault(); open(); }
});
// Список карманов для формы проверки и песочницы дашбордов
api('/api/plugins/pockets/data?year=' + ST.year).then(function(d) {
    if (d && d.success) setList(d.all_pockets || d.pockets);
});
})();
"""


def register(app, db, hooks):
    print('[pockets] v' + __version__ + ' · ' + __description__)

    @app.route('/plugins-assets/pockets.js', methods=['GET'])
    def _pockets_js():
        resp = app.response_class(_JS, mimetype='application/javascript')
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp

    def _user():
        try:
            from auth import current_user
            return current_user(db)
        except Exception:
            return None

    def _admin():
        u = _user()
        if not u:
            return None, (jsonify({'success': False, 'error': 'auth'}), 401)
        if u.get('role') != 'admin':
            return None, (jsonify({'success': False, 'error': 'Изменять карманы может только администратор'}), 403)
        return u, None

    def _audit(u, kind, eid, details):
        try:
            import json as _j
            db.exec('INSERT INTO audit_log (ts, user_id, username, kind, entity, entity_id, details) VALUES (?,?,?,?,?,?,?)',
                    (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), u.get('id'), u.get('username', ''),
                     kind, 'pocket', str(eid), _j.dumps(details, ensure_ascii=False)))
        except Exception as _e:
            print(f'[pockets] audit failed: {_e}')

    def _pockets(year=None):
        try:
            if year is not None:
                return db.query('SELECT * FROM pockets WHERE year=? ORDER BY direction, sort, name', (int(year),))
            return db.query('SELECT * FROM pockets ORDER BY year, direction, sort, name')
        except Exception:
            return []

    def _used(name, direction, year):
        """Сколько проверок года (по дате начала) указывают этот карман."""
        return db.query_one("SELECT count(*) AS c FROM tasks WHERE trim(pocket)=? AND task_type=? AND substr(start_date,1,4)=?",
                            (name, direction, str(year)))['c']

    def _year_of(b, old=None):
        try:
            y = int((b or {}).get('year') or (old or {}).get('year') or date.today().year)
            return y if 2000 <= y <= 2100 else date.today().year
        except Exception:
            return date.today().year

    def _plan_val(v):
        if v is None or str(v).strip() == '':
            return None
        n = int(str(v).strip())
        if n < 0 or n > 500:
            raise ValueError
        return n

    def _plans(year=None):
        try:
            if year:
                y = str(year)
                return db.query('SELECT * FROM pocket_plans WHERE substr(date_from,1,4)<=? AND substr(date_to,1,4)>=? '
                                'ORDER BY date_from', (y, y))
            return db.query('SELECT * FROM pocket_plans ORDER BY date_from')
        except Exception:
            return []

    @app.route('/api/plugins/pockets/data', methods=['GET'])
    def _pk_data():
        u = _user()
        if not u:
            return jsonify({'success': False, 'error': 'auth'}), 401
        try:
            year = int(request.args.get('year') or date.today().year)
        except Exception:
            year = date.today().year
        direction = request.args.get('dir', '').strip()
        if direction not in DIRS:
            direction = ''
        data = db.load_all()
        pockets = _pockets(year)
        plans = []
        cnt = {}
        for t in _audits(data):
            if (t.get('start_date') or '')[:4] != str(year):
                continue
            k = ((t.get('pocket') or '').strip(), t.get('task_type') or '')
            cnt[k] = cnt.get(k, 0) + 1
        for p in pockets:
            p['tasks_total'] = p['fact'] = cnt.get((p['name'], p['direction']), 0)
        prev_year, prev_pockets = None, []
        try:
            r = db.query_one('SELECT MAX(year) AS y FROM pockets WHERE year<?', (year,))
            if r and r.get('y'):
                prev_year = int(r['y'])
                prev_pockets = [{'name': p['name'], 'direction': p['direction'], 'is_active': p['is_active'],
                                 'plan_count': p.get('plan_count')} for p in _pockets(prev_year)]
        except Exception:
            pass
        all_pockets = [{'id': p['id'], 'name': p['name'], 'direction': p['direction'],
                        'is_active': p['is_active'], 'year': p.get('year')} for p in _pockets()]
        mats = {_DIR_KEY[dr]: pockets_compute(data, pockets, year, dr)
                for dr in DIRS if not direction or dr == direction}
        nodir = []
        if not direction:
            emp = {e['id']: e for e in data.get('employees') or []}
            for t in _audits(data):
                if (t.get('start_date') or '')[:4] == str(year) and (t.get('task_type') or '') not in DIRS:
                    nodir.append({'id': t['id'], 'name': t.get('name') or '', 'status': t.get('status') or '',
                                  'start': t.get('start_date') or '', 'deadline': t.get('deadline') or '',
                                  'pocket': (t.get('pocket') or '').strip(),
                                  'lead': (emp.get(t.get('lead_employee') or '') or {}).get('name') or ''})
        return jsonify({'success': True, 'can_edit': u.get('role') == 'admin', 'pockets': pockets,
                        'plans': plans, 'matrices': mats, 'nodir': nodir,
                        'year': year, 'prev_year': prev_year, 'prev_pockets': prev_pockets, 'all_pockets': all_pockets})

    @app.route('/api/plugins/pockets/save', methods=['POST'])
    def _pk_save():
        """Один карман года: создать, переименовать, открыть/закрыть, задать план."""
        u, err = _admin()
        if err:
            return err
        b = request.get_json(silent=True) or {}
        pid = int(b.get('id') or 0)
        old = db.query_one('SELECT * FROM pockets WHERE id=?', (pid,)) if pid else None
        if pid and not old:
            return jsonify({'success': False, 'error': 'Карман не найден'}), 404
        year = _year_of(b, old)
        name = re.sub(r'\s+', ' ', str(b.get('name') or '')).strip()[:100]
        direction = str(b.get('direction') or '').strip()
        active = 1 if b.get('is_active', True) else 0
        comment = str(b.get('comment') or '').strip()[:500]
        if not name:
            return jsonify({'success': False, 'error': 'Укажите название кармана'}), 400
        if direction not in DIRS:
            return jsonify({'success': False, 'error': 'Выберите направление'}), 400
        try:
            pc = _plan_val(b.get('plan_count')) if 'plan_count' in b else (old or {}).get('plan_count')
        except Exception:
            return jsonify({'success': False, 'error': 'План — целое число от 0 до 500'}), 400
        dup = db.query_one('SELECT id FROM pockets WHERE lower(name)=lower(?) AND direction=? AND year=? AND id<>?',
                           (name, direction, year, pid))
        if dup:
            return jsonify({'success': False, 'error': 'Карман «%s» уже есть в этом направлении на %d год' % (name, year)}), 400
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        if old:
            if direction != old['direction'] and _used(old['name'], old['direction'], old['year']):
                return jsonify({'success': False, 'error': 'Карман уже указан в проверках — направление поменять нельзя'}), 400
            renamed = 0
            with db.transaction() as tx:
                tx.exec('UPDATE pockets SET name=?, direction=?, is_active=?, plan_count=?, comment=?, updated_at=? WHERE id=?',
                        (name, direction, active, pc, comment, now, pid))
                if name != old['name']:
                    c = tx.exec('UPDATE tasks SET pocket=? WHERE trim(pocket)=? AND task_type=? AND substr(start_date,1,4)=?',
                                (name, old['name'], old['direction'], str(old['year']))).rowcount
                    renamed = max(c or 0, 0)
            _audit(u, 'update', pid, {'name': [old['name'], name], 'year': old['year'], 'is_active': [old['is_active'], active],
                                      'plan_count': [old.get('plan_count'), pc], 'renamed_in_tasks': renamed})
            return jsonify({'success': True, 'id': pid, 'renamed_in_tasks': renamed})
        mx = db.query_one('SELECT COALESCE(MAX(sort),0) AS m FROM pockets WHERE direction=? AND year=?', (direction, year))['m']
        new_id = db.exec('INSERT INTO pockets (name, direction, year, is_active, sort, plan_count, comment, created_at, updated_at) '
                         'VALUES (?,?,?,?,?,?,?,?,?)', (name, direction, year, active, (mx or 0) + 1, pc, comment, now, now))
        _audit(u, 'create', new_id, {'name': name, 'direction': direction, 'year': year})
        return jsonify({'success': True, 'id': new_id})

    @app.route('/api/plugins/pockets/bulk', methods=['POST'])
    def _pk_bulk():
        """Справочник карманов года целиком: порядок, названия, активность, план, новые и удалённые."""
        u, err = _admin()
        if err:
            return err
        body = request.get_json(silent=True) or {}
        year = _year_of(body)
        lists = body.get('lists') or {}
        cur = {p['id']: p for p in _pockets(year)}
        plan = {}
        for dr, pack in lists.items():
            if dr not in DIRS:
                return jsonify({'success': False, 'error': 'Неизвестное направление'}), 400
            items, seen = [], set()
            for it in (pack or {}).get('items') or []:
                name = re.sub(r'\s+', ' ', str(it.get('name') or '')).strip()[:100]
                pid = int(it.get('id') or 0)
                if not name:
                    return jsonify({'success': False, 'error': 'Пустое название кармана'}), 400
                if name.lower() in seen:
                    return jsonify({'success': False, 'error': 'Карман «%s» повторяется в направлении «%s»' % (name, dr)}), 400
                seen.add(name.lower())
                if pid and (pid not in cur or cur[pid]['direction'] != dr):
                    return jsonify({'success': False, 'error': 'Карман #%d не найден в %d году — обновите окно' % (pid, year)}), 409
                try:
                    pc = _plan_val(it.get('plan_count'))
                except Exception:
                    return jsonify({'success': False, 'error': 'План кармана «%s» — целое число от 0 до 500' % name}), 400
                items.append((pid, name, 1 if it.get('is_active', True) else 0, pc))
            dels = [int(x) for x in (pack or {}).get('deleted') or [] if int(x) in cur and cur[int(x)]['direction'] == dr]
            for pid in dels:
                used = _used(cur[pid]['name'], dr, year)
                if used:
                    return jsonify({'success': False, 'error': 'Карман «%s» указан в %d проверк(ах) %d года — его можно только закрыть' % (cur[pid]['name'], used, year)}), 400
            plan[dr] = (items, dels)
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        renamed, log = 0, []
        with db.transaction() as tx:
            for dr, (items, dels) in plan.items():
                for pid in dels:
                    tx.exec('DELETE FROM pockets WHERE id=?', (pid,))
                    log.append(('delete', pid, {'name': cur[pid]['name'], 'direction': dr, 'year': year}))
                ren = [(pid, name) for pid, name, act, pc in items if pid and name != cur[pid]['name']]
                # временные имена: перестановка/обмен названий не упрётся в UNIQUE и не склеит проверки двух карманов
                for pid, name in ren:
                    tmp = '\u0000tmp%d' % pid
                    tx.exec('UPDATE pockets SET name=? WHERE id=?', (tmp, pid))
                    tx.exec('UPDATE tasks SET pocket=? WHERE trim(pocket)=? AND task_type=? AND substr(start_date,1,4)=?',
                            (tmp, cur[pid]['name'], dr, str(year)))
                for pid, name in ren:
                    c = tx.exec('UPDATE tasks SET pocket=? WHERE pocket=? AND task_type=?', (name, '\u0000tmp%d' % pid, dr)).rowcount
                    renamed += max(c or 0, 0)
                for sort, (pid, name, act, pc) in enumerate(items, 1):
                    if pid:
                        old = cur[pid]
                        tx.exec('UPDATE pockets SET name=?, is_active=?, sort=?, plan_count=?, updated_at=? WHERE id=?',
                                (name, act, sort, pc, now, pid))
                        if name != old['name'] or act != old['is_active'] or pc != old.get('plan_count'):
                            log.append(('update', pid, {'name': [old['name'], name], 'is_active': [old['is_active'], act],
                                                        'plan_count': [old.get('plan_count'), pc], 'direction': dr, 'year': year}))
                    else:
                        c = tx.exec('INSERT INTO pockets (name, direction, year, is_active, sort, plan_count, comment, created_at, updated_at) '
                                    'VALUES (?,?,?,?,?,?,?,?,?)', (name, dr, year, act, sort, pc, '', now, now))
                        log.append(('create', c.lastrowid, {'name': name, 'direction': dr, 'year': year, 'plan_count': pc}))
        for kind, pid, det in log:
            _audit(u, kind, pid, det)
        return jsonify({'success': True, 'renamed_in_tasks': renamed, 'changes': len(log), 'year': year})

    @app.route('/api/plugins/pockets/delete', methods=['POST'])
    def _pk_delete():
        u, err = _admin()
        if err:
            return err
        pid = int((request.get_json(silent=True) or {}).get('id') or 0)
        old = db.query_one('SELECT * FROM pockets WHERE id=?', (pid,))
        if not old:
            return jsonify({'success': False, 'error': 'Карман не найден'}), 404
        used = _used(old['name'], old['direction'], old.get('year'))
        if used:
            return jsonify({'success': False, 'error': 'Карман указан в %d проверк(ах). Закройте его (снимите «актив.») или поменяйте карман в проверках' % used}), 400
        db.exec('DELETE FROM pockets WHERE id=?', (pid,))
        _audit(u, 'delete', pid, {'name': old['name'], 'direction': old['direction'], 'year': old.get('year')})
        return jsonify({'success': True})

    @app.route('/api/plugins/pockets/plan/save', methods=['POST'])
    def _pk_plan_save():
        u, err = _admin()
        if err:
            return err
        b = request.get_json(silent=True) or {}
        pid = int(b.get('pocket_id') or 0)
        if not db.query_one('SELECT id FROM pockets WHERE id=?', (pid,)):
            return jsonify({'success': False, 'error': 'Карман не найден'}), 404
        d1 = str(b.get('date_from') or '').strip()
        d2 = str(b.get('date_to') or '').strip()
        if not _valid_date(d1) or not _valid_date(d2):
            return jsonify({'success': False, 'error': 'Укажите даты открытия и закрытия кармана'}), 400
        if d2 < d1:
            return jsonify({'success': False, 'error': 'Дата закрытия раньше даты открытия'}), 400
        try:
            cnt = int(b.get('plan_count'))
            if cnt < 0 or cnt > 500:
                raise ValueError
        except Exception:
            return jsonify({'success': False, 'error': 'План проверок — целое число от 0'}), 400
        comment = str(b.get('comment') or '').strip()[:500]
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        plid = int(b.get('id') or 0)
        if plid:
            db.exec('UPDATE pocket_plans SET date_from=?, date_to=?, plan_count=?, comment=?, updated_at=? WHERE id=? AND pocket_id=?',
                    (d1, d2, cnt, comment, now, plid, pid))
        else:
            plid = db.exec('INSERT INTO pocket_plans (pocket_id, date_from, date_to, plan_count, comment, created_at, updated_at) '
                           'VALUES (?,?,?,?,?,?,?)', (pid, d1, d2, cnt, comment, now, now))
        _audit(u, 'plan_save', pid, {'plan_id': plid, 'date_from': d1, 'date_to': d2, 'plan_count': cnt})
        return jsonify({'success': True, 'id': plid})

    @app.route('/api/plugins/pockets/plan/delete', methods=['POST'])
    def _pk_plan_delete():
        u, err = _admin()
        if err:
            return err
        plid = int((request.get_json(silent=True) or {}).get('id') or 0)
        db.exec('DELETE FROM pocket_plans WHERE id=?', (plid,))
        _audit(u, 'plan_delete', plid, {})
        return jsonify({'success': True})
