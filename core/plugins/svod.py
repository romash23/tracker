# -*- coding: utf-8 -*-
"""plugins/svod.py — «Свод» по проверкам (вкладка Статистика → Свод).

Заменяет прежний свод часов. Считает по проверкам и банкам:
KPI за период, разрез по банкам (загрузка как в «Нагрузке по ТБ»),
карманы/направления, отсутствия по банкам, таблица проверок, выгрузка Excel.
"""
__version__ = '1.1'
__description__ = 'Свод по проверкам: KPI, индекс здоровья, банки, карманы, отсутствия, недельный отчёт (пятница), Excel'

import json
import io
from datetime import date, datetime, timedelta
from flask import request, jsonify, Response

_SCOPES = ('', 'корпоративная', 'розничная', 'розничная_без_пвр')
_STATUS = {'planning': 'Планирование', 'approved': 'Утверждена', 'active': 'Активна',
           'done': 'Завершена', 'cancelled': 'Отменена'}
_ABS = {'vacation': 'Отпуск', 'sick_leave': 'Больничный', 'business_trip': 'Командировка',
        'remote': 'Удалёнка', 'other': 'Другое'}


_JS = r"""
(function(){
'use strict';
if (window.__svodV1) return; window.__svodV1 = true;
var ST = { scope: '', from: '', to: '', data: null, sort: 'start', dir: 1, q: '', view: 'svod', week: '', wdata: null };
try { ST.view = localStorage.getItem('svod.view') || 'svod'; } catch (e) {}
try { ST.scope = localStorage.getItem('svod.scope') || ''; } catch (e) {}
var SCOPES = [['', 'Всего ОАМ'], ['корпоративная', 'Корпоративное'], ['розничная', 'Розничное с ПВР'], ['розничная_без_пвр', 'Розничное без ПВР']];
var STC = { planning: '#7e57c2', approved: '#d68910', active: '#2874a6', done: '#239b56', cancelled: '#8a8f96' };
function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function n(v) { return v == null ? '—' : String(Math.round(v * 100) / 100).replace('.', ','); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function css() {
    if (document.getElementById('svodCss')) return;
    var st = document.createElement('style'); st.id = 'svodCss';
    st.textContent = [
    '.svod-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}',
    '.svod-seg{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--trk-card-border,rgba(245,215,110,.12))}',
    '.svod-seg button{border:none;background:transparent;cursor:pointer;padding:5px 13px;border-radius:999px;font:inherit;font-size:.8rem;font-weight:600;color:var(--trk-filter-color,#a0a0a0);white-space:nowrap}',
    '.svod-seg button.active{background:#f4f4f4;color:#111;box-shadow:0 1px 3px rgba(0,0,0,.25)}',
    'body.trk-theme-light .svod-seg{background:#dfe3e8;border-color:rgba(0,0,0,.08)}',
    'body.trk-theme-light .svod-seg button.active{background:#fff;font-weight:700;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 1px 3px rgba(0,0,0,.16)}',
    '.svod-bar input[type=date]{padding:4px 6px;border-radius:6px;border:1px solid var(--trk-card-border,#444);background:transparent;color:inherit;font:inherit;font-size:.8rem}',
    '.svod-btn{padding:5px 12px;border-radius:8px;border:1px solid var(--trk-card-border,#555);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600}',
    '.svod-btn:hover{border-color:#26a269}',
    '.svod-kpi{display:grid;grid-template-columns:2fr repeat(5,1fr);gap:8px;margin-bottom:12px}',
    '@media (max-width:1100px){.svod-kpi{grid-template-columns:repeat(3,1fr)}}',
    '.svod-card{border:1px solid var(--trk-card-border,#333);background:var(--trk-card-bg,rgba(20,20,20,.6));border-radius:10px;padding:9px 12px}',
    '.svod-card b{display:block;font-size:1.35rem;line-height:1.2}',
    '.svod-card span{font-size:.74rem;opacity:.85}',
    '.svod-card.warn b{color:#e67e22}.svod-card.bad b{color:#e74c3c}.svod-card.ok b{color:#27ae60}',
    '.svod-stbar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:6px;gap:1px}',
    '.svod-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:12px;margin-bottom:12px}',
    '.svod-box{border:1px solid var(--trk-card-border,#333);background:var(--trk-card-bg,rgba(20,20,20,.6));border-radius:10px;padding:10px 12px;overflow:auto}',
    '.svod-box h4{margin:0 0 8px;font-size:.88rem}',
    '.svod-t{width:100%;border-collapse:collapse;font-size:.78rem}',
    '.svod-t th{text-align:left;font-weight:700;padding:5px 6px;border-bottom:1px solid var(--trk-card-border,#444);white-space:nowrap;cursor:default}',
    '.svod-t th[data-k]{cursor:pointer}.svod-t th[data-k]:hover{color:#26a269}',
    '.svod-t td{padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.15);vertical-align:top}',
    '.svod-t td.num,.svod-t th.num{text-align:right;white-space:nowrap}',
    '.svod-t tr.svod-row{cursor:pointer}.svod-t tr.svod-row:hover td{background:rgba(38,162,105,.08)}',
    '.svod-st{display:inline-block;padding:1px 7px;border-radius:9px;color:#fff;font-size:.7rem;font-weight:700;white-space:nowrap}',
    '.svod-lv{display:inline-block;min-width:44px;text-align:center;padding:1px 5px;border-radius:5px;font-weight:700}',
    '.svod-lv1{background:#c8e6c9;color:#1b5e20}.svod-lv2{background:#81c784;color:#103d12}.svod-lv3{background:#ffe082;color:#5d4100}.svod-lv4{background:#ef9a9a;color:#7f1010}.svod-lv5{background:#c62828;color:#fff;outline:2px solid #7f0000}',
    '.svod-bad{color:#e74c3c;font-weight:700}.svod-good{color:#27ae60;font-weight:700}',
    '.svod-probs{display:flex;flex-wrap:wrap;gap:4px}.svod-chip{font-size:.74rem;padding:1px 7px;border-radius:9px;background:rgba(230,126,34,.18);color:#f0a64a;border:1px solid rgba(230,126,34,.45)}',
    'body.trk-theme-light .svod-chip{color:#9a3412;background:#fff1e6;border-color:#f3b27a}',
    'body.trk-theme-light .svod-note{opacity:.8}',
    '.svod-leg{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:.72rem;margin-top:6px}',
    '#panel-summary{padding-right:64px}',
    '.svod-search{padding:4px 8px;border-radius:6px;border:1px solid var(--trk-card-border,#444);background:transparent;color:inherit;font:inherit;font-size:.78rem;min-width:320px;font-weight:400}',
    '.svod-empty{opacity:.6;font-size:.8rem;padding:6px 0}',
    '.svod-note{font-size:.72rem;opacity:.65;margin-top:6px}',
    '.svod-seg{height:32px;box-sizing:border-box;border-radius:9px!important;padding:2px!important;align-items:stretch}',
    '.svod-seg button{border-radius:7px!important;padding:0 12px!important;font-size:.8rem!important}',
    '.svod-sub{font-size:.7rem;opacity:.75;margin-top:3px}',
    '.svod-cnt{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:rgba(128,128,128,.22);font-size:.72rem;text-align:center;margin-left:4px}',
    '.svod-wk{font-size:.95rem}',
    '.svod-chg{white-space:nowrap}',
    '.svod-skel i{display:block;height:12px;border-radius:6px;margin:6px 0;background:linear-gradient(90deg,rgba(128,128,128,.16) 25%,rgba(128,128,128,.3) 50%,rgba(128,128,128,.16) 75%);background-size:400% 100%;animation:svodSk 1.3s ease-in-out infinite}',
    '.svod-skel i:first-child{height:22px;width:50%}',
    '.svod-skel-row i{display:block;height:14px;border-radius:6px;margin:10px 0;background:linear-gradient(90deg,rgba(128,128,128,.16) 25%,rgba(128,128,128,.3) 50%,rgba(128,128,128,.16) 75%);background-size:400% 100%;animation:svodSk 1.3s ease-in-out infinite}',
    '@keyframes svodSk{0%{background-position:100% 0}100%{background-position:0 0}}',
    '#svodTasks{max-height:70vh;overflow:auto}',
    '#svodTasks .svod-t thead th{position:sticky;top:0;z-index:3;background:var(--trk-card-bg,#1f2326)}',
    '#svodTasks .svod-t td:first-child,#svodTasks .svod-t th:first-child{position:sticky;left:0;z-index:2;background:var(--trk-card-bg,#1f2326)}',
    '#svodTasks .svod-t thead th:first-child{z-index:4}',
    'body.trk-theme-light #svodTasks .svod-t thead th,body.trk-theme-light #svodTasks .svod-t td:first-child{background:#fff}',
    'body.trk-theme-light .svod-note,body.trk-theme-light .svod-sub{opacity:1;color:#4b5563}'
    ].join('\n');
    document.head.appendChild(st);
}
function root() { return document.getElementById('svodRoot'); }
function lvl(v, c) { if (!(v > 0) || !c) return 0; var p = Math.round(v / c * 100); return p < 50 ? 1 : p < 75 ? 2 : p <= 100 ? 3 : p <= 125 ? 4 : 5; }
function presetRange(k) {
    var t = new Date();
    if (k === 'y') return [t.getFullYear() + '-01-01', t.getFullYear() + '-12-31'];
    if (k === 'q') { var q0 = Math.floor(t.getMonth() / 3) * 3; return [iso(new Date(t.getFullYear(), q0, 1)), iso(new Date(t.getFullYear(), q0 + 3, 0))]; }
    return [iso(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1)), iso(t)];
}
function presetOf() {
    var ks = ['q', 'y', '12'];
    for (var i = 0; i < ks.length; i++) { var r = presetRange(ks[i]); if (r[0] === ST.from && r[1] === ST.to) return ks[i]; }
    return '';
}
function bar() {
    return '<div class="svod-bar"><div class="svod-seg" id="svodScope">' + SCOPES.map(function(s) {
        return '<button type="button" data-v="' + s[0] + '"' + (s[0] === ST.scope ? ' class="active"' : '') + '>' + s[1] + '</button>'; }).join('') + '</div>'
        + '<div class="svod-seg" id="svodPreset">' + [['q', 'Квартал'], ['y', 'Год'], ['12', '12 мес. назад']].map(function(x) { return '<button type="button" data-p="' + x[0] + '"' + (presetOf() === x[0] ? ' class="active"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>'
        + '<input type="date" id="svodFrom" value="' + ST.from + '"> — <input type="date" id="svodTo" value="' + ST.to + '">'
        + '<button type="button" class="svod-btn" id="svodApply">✓ Показать</button>'
        + '<button type="button" class="svod-btn" id="svodXls" style="margin-left:auto">⬇ Excel</button></div>';
}
function kpiHtml(k) {
    var bs = k.by_status || {}, tot = k.total || 0;
    var seg = ['planning', 'approved', 'active', 'done', 'cancelled'].map(function(s) {
        return bs[s] ? '<i title="' + s + ': ' + bs[s] + '" style="flex:' + bs[s] + ';background:' + STC[s] + '"></i>' : ''; }).join('');
    var lbl = { planning: 'Планир.', approved: 'Утв.', active: 'Акт.', done: 'Заверш.', cancelled: 'Отмен.' };
    var leg = ['planning', 'approved', 'active', 'done', 'cancelled'].filter(function(s) { return bs[s]; }).map(function(s) {
        return '<span style="color:' + STC[s] + ';opacity:1">● ' + lbl[s] + ' ' + bs[s] + '</span>'; }).join(' ');
    function card(val, cap, cls, title) { return '<div class="svod-card ' + (cls || '') + '"' + (title ? ' title="' + e(title) + '"' : '') + '><b>' + val + '</b><span>' + cap + '</span></div>'; }
    var ot = k.on_time_pct;
    return '<div class="svod-kpi">'
        + '<div class="svod-card"><b>' + tot + '</b><span>проверок в периоде</span><div class="svod-stbar">' + seg + '</div><div style="font-size:.7rem;margin-top:4px;display:flex;flex-wrap:wrap;gap:8px">' + leg + '</div></div>'
        + card(k.done_in_period, 'завершено в периоде')
        + card(ot == null ? '—' : ot + '%', 'закрыто в срок', ot == null ? '' : ot >= 90 ? 'ok' : ot >= 70 ? 'warn' : 'bad', 'Срок — первоначальный дедлайн (до продлений)')
        + card(k.avg_duration == null ? '—' : k.avg_duration + ' дн.', 'средняя длительность', '', 'От начала до даты завершения, по завершённым в периоде')
        + card(k.extensions, 'продлений сроков', k.extensions ? 'warn' : '')
        + card(k.overdue, 'просрочено сейчас', k.overdue ? 'bad' : 'ok')
        + (k.health ? card(k.health.index, 'индекс здоровья', k.health.index >= 80 ? 'ok' : k.health.index >= 60 ? 'warn' : 'bad',
            'Индекс = 100 − ½·доля проблемных проверок − ½·доля перегруженных недель ТБ.\nПроблемных: ' + k.health.problem + ' из ' + k.health.active + ' (' + k.health.problem_pct + '%)\nПерегруженных недель: ' + k.health.over_weeks + ' из ' + k.health.bank_weeks + ' (' + k.health.over_pct + '%)')
            .replace('</span></div>', '</span><div class="svod-sub">проблемных ' + k.health.problem_pct + '% · перегруз ' + k.health.over_pct + '%</div></div>') : '')
        + '</div>';
}
function banksHtml(bs) {
    if (!bs.length) return '<div class="svod-empty">Нет банков в выборке</div>';
    return '<table class="svod-t"><thead><tr><th>Тер банк</th><th class="num">Проверок</th><th class="num" title="Сколько проверок банк возглавляет">👑 Рук.</th><th class="num">Ёмкость</th><th class="num">Средняя</th><th class="num">Пик</th><th class="num" title="Рабочих недель с загрузкой выше ёмкости">Недель в перегрузе</th></tr></thead><tbody>'
        + bs.map(function(b) {
            var c = b.capacity;
            return '<tr><td>' + e(b.name) + '</td><td class="num">' + b.tasks + '</td><td class="num">' + (b.lead || '') + '</td><td class="num">' + (c == null ? '<span title="Не заполнены коэффициент или численность">нет</span>' : n(c)) + '</td>'
                + '<td class="num"><span class="svod-lv svod-lv' + lvl(b.avg, c) + '">' + n(b.avg) + '</span></td>'
                + '<td class="num"><span class="svod-lv svod-lv' + lvl(b.peak, c) + '">' + n(b.peak) + '</span></td>'
                + '<td class="num' + (b.over_weeks ? ' svod-bad' : '') + '">' + (b.over_weeks == null ? '—' : b.over_weeks + ' из ' + b.weeks) + '</td></tr>';
        }).join('') + '</tbody></table><div class="svod-note">Загрузка по неделям — как в «Текущей загрузке» (с предварительными, с ручными правками по проверкам). </div><div class="svod-leg">% к ёмкости: <span class="svod-lv svod-lv1">0–50</span><span class="svod-lv svod-lv2">50–75</span><span class="svod-lv svod-lv3">75–100</span><span class="svod-lv svod-lv4">100–125</span><span class="svod-lv svod-lv5">&gt;125</span></div>';
}
function pocketsHtml(ps) {
    if (!ps.length) return '<div class="svod-empty">Нет данных</div>';
    return '<table class="svod-t"><thead><tr><th>Карман</th><th>Направление</th><th class="num">Проверок</th><th style="width:40%">Доля</th></tr></thead><tbody>'
        + ps.map(function(p) {
            return '<tr><td>' + e(p.pocket) + '</td><td>' + e(p.task_type) + '</td><td class="num">' + p.count + '</td><td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:8px;border-radius:4px;background:rgba(128,128,128,.18)"><div style="height:8px;border-radius:4px;background:#26a269;width:' + Math.max(3, p.share) + '%"></div></div><span style="font-size:.72rem">' + p.share + '%</span></div></td></tr>';
        }).join('') + '</tbody></table>';
}
function absHtml(as) {
    if (!as.length) return '<div class="svod-empty">Отсутствий в периоде нет</div>';
    return '<table class="svod-t"><thead><tr><th>Тер банк</th><th class="num" title="Рабочие дни отсутствия в периоде">Дней отсутствия</th><th class="num">Сотр.</th><th>По типам</th></tr></thead><tbody>'
        + as.map(function(a) {
            return '<tr><td>' + e(a.bank) + '</td><td class="num">' + a.days + '</td><td class="num">' + a.people + '</td><td style="font-size:.72rem">'
                + Object.keys(a.by_type).map(function(k) { return e(k) + ': ' + a.by_type[k]; }).join(' · ') + '</td></tr>';
        }).join('') + '</tbody></table>';
}
function probsHtml(rows) {
    var st = window.__trkState || {}, byId = {};
    (st.tasks || []).forEach(function(t) { byId[t.id] = t; });
    if (typeof window.trkTaskProblems !== 'function') return '<div class="svod-empty">—</div>';
    var list = rows.map(function(r) { var t = byId[r.id]; var p = t ? window.trkTaskProblems(t) : null; return p ? { r: r, p: p } : null; }).filter(Boolean);
    if (!list.length) return '<div class="svod-empty">Проблемных проверок нет 👍</div>';
    return '<table class="svod-t"><tbody>' + list.map(function(x) {
        return '<tr class="svod-row" data-tid="' + e(x.r.id) + '"><td style="white-space:nowrap">' + e(x.r.name) + '<div style="font-size:.68rem;opacity:.7">' + e(x.r.lead || '') + (x.r.start ? ' · с ' + fd(x.r.start) : '') + '</div></td><td><div class="svod-probs">' + x.p.map(function(s) { return '<span class="svod-chip">' + e(s) + '</span>'; }).join('') + '</div></td></tr>';
    }).join('') + '</tbody></table><div class="svod-note">Правила те же, что у фильтра «🚨 Проблемные» во вкладке «Задачи».</div>';
}
var COLS = [['name', 'Проверка'], ['status', 'Статус'], ['task_type', 'Направление'], ['pocket', 'Карман'], ['lead', 'Руководитель'], ['banks', 'Банки'],
            ['start', 'Начало'], ['deadline', 'Дедлайн'], ['stage', 'Текущий этап'], ['deviation', 'Откл., дн.'], ['extensions', 'Продл.']];
function fd(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(2, 4) : ''; }
function tasksHtml(rows) {
    var q = ST.q.toLowerCase();
    var list = rows.filter(function(r) { return !q || (r.name + ' ' + r.pocket + ' ' + r.lead + ' ' + r.banks.join(' ') + ' ' + r.curator).toLowerCase().indexOf(q) >= 0; });
    var k = ST.sort, d = ST.dir;
    list.sort(function(a, b) {
        var x = a[k], y = b[k];
        if (k === 'banks') { x = x.length; y = y.length; }
        if (x == null || x === '') return 1; if (y == null || y === '') return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * d;
    });
    return '<table class="svod-t"><thead><tr>' + COLS.map(function(c) {
            return '<th data-k="' + c[0] + '"' + (['deviation', 'extensions'].indexOf(c[0]) >= 0 ? ' class="num"' : '') + '>' + c[1] + (k === c[0] ? (d > 0 ? ' ▴' : ' ▾') : '') + '</th>'; }).join('') + '</tr></thead><tbody>'
        + (list.length ? list.map(function(r) {
            var dv = r.deviation;
            var dvh = dv == null ? '' : '<span class="' + (dv > 0 ? 'svod-bad' : 'svod-good') + '" title="' + (r.status === 'done' ? 'Завершена относительно первоначального дедлайна' : 'Просрочка от дедлайна') + '">' + (dv > 0 ? '+' : '') + dv + '</span>';
            return '<tr class="svod-row" data-tid="' + e(r.id) + '"><td>' + e(r.name) + '</td><td><span class="svod-st" style="background:' + (STC[r.status] || '#888') + '">' + e(r.status_label) + '</span></td>'
                + '<td>' + e(r.task_type) + '</td><td>' + (r.pocket ? e(r.pocket) : '—') + '</td><td>' + e(r.lead) + '</td><td style="font-size:.72rem">' + e(r.banks.join(', ')) + '</td>'
                + '<td>' + fd(r.start) + '</td><td>' + fd(r.deadline) + (r.completed_at ? '<div style="font-size:.68rem;opacity:.7">✓ ' + fd(r.completed_at) + '</div>' : '') + '</td>'
                + '<td style="font-size:.72rem">' + e(r.stage) + '</td><td class="num">' + dvh + '</td><td class="num">' + (r.extensions || '') + '</td></tr>';
        }).join('') : '<tr><td colspan="11" class="svod-empty">Ничего не найдено</td></tr>') + '</tbody></table>';
}
function render() {
    var R = root(); if (!R) return; css();
    var d = ST.data;
    if (ST.view === 'week') { R.innerHTML = viewSeg() + weekHtml(); return; }
    var body = !d ? skel() : (d.error ? '<div class="svod-empty" style="color:#e74c3c">❌ ' + e(d.error) + '</div>' :
        kpiHtml(d.kpi)
        + '<div class="svod-grid"><div class="svod-box"><h4>🏦 Тер банки</h4>' + banksHtml(d.banks) + '</div>'
        + '<div class="svod-box"><h4>🚨 Проблемные проверки</h4>' + probsHtml(d.tasks) + '</div></div>'
        + '<div class="svod-box" style="margin-bottom:12px"><h4 style="display:flex;align-items:center;gap:10px">📋 Проверки <input class="svod-search" id="svodQ" placeholder="Поиск: название, банк, карман, куратор" value="' + e(ST.q) + '"></h4><div id="svodTasks">' + tasksHtml(d.tasks) + '</div></div>'
        + '<div class="svod-grid"><div class="svod-box"><h4>🗂 Карманы и направления</h4>' + pocketsHtml(d.pockets) + '</div>'
        + '<div class="svod-box"><h4>🏖 Отсутствия по банкам</h4>' + absHtml(d.absences) + '</div></div>');
    R.innerHTML = viewSeg() + bar() + body;
}
function defaults() {
    if (ST.from && ST.to) return;
    var t = new Date();
    ST.from = t.getFullYear() + '-01-01'; ST.to = t.getFullYear() + '-12-31';
}
function load() {
    defaults(); ST.data = null; render();
    var url = '/api/plugins/svod/data?from=' + encodeURIComponent(ST.from) + '&to=' + encodeURIComponent(ST.to) + '&scope=' + encodeURIComponent(ST.scope);
    fetch(url, { credentials: 'same-origin' }).then(function(r) { return r.json().catch(function() { return { success: false, error: 'HTTP ' + r.status }; }); })
        .then(function(d) { ST.data = d.success ? d : { error: d.error || 'Ошибка' }; render(); })
        .catch(function(er) { ST.data = { error: er.message || 'Ошибка сети' }; render(); });
}
function skel() {
    var h = '<div class="svod-kpi">'; for (var i = 0; i < 6; i++) h += '<div class="svod-card svod-skel"><i></i><i></i></div>';
    h += '</div><div class="svod-box"><h4>Загрузка…</h4>'; for (i = 0; i < 6; i++) h += '<div class="svod-skel-row"><i></i></div>';
    return h + '</div>';
}
function viewSeg() {
    return '<div class="svod-bar"><div class="svod-seg" id="svodView">'
        + [['svod', '📊 Свод'], ['week', '📰 Недельный отчёт']].map(function(x) { return '<button type="button" data-v="' + x[0] + '"' + (ST.view === x[0] ? ' class="active"' : '') + '>' + x[1] + '</button>'; }).join('')
        + '</div></div>';
}
function monOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function fdd(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) : ''; }
function wsec(title, rows, empty) { return '<div class="svod-box"><h4>' + title + ' <span class="svod-cnt">' + rows.length + '</span></h4>' + (rows.length ? '<table class="svod-t"><tbody>' + rows.join('') + '</tbody></table>' : '<div class="svod-empty">' + empty + '</div>') + '</div>'; }
function trow(id, cells) { return '<tr class="svod-row" data-tid="' + e(id) + '">' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }
function weekHtml() {
    var w = ST.wdata;
    var mon = ST.week, sun = (function() { var d = new Date(mon + 'T00:00:00'); d.setDate(d.getDate() + 6); return iso(d); })();
    var head = '<div class="svod-bar"><button type="button" class="svod-btn" id="svodWPrev" title="Предыдущая неделя">◀</button>'
        + '<b class="svod-wk">Неделя ' + fdd(mon) + ' — ' + fdd(sun) + '.' + sun.slice(0, 4) + '</b>'
        + '<button type="button" class="svod-btn" id="svodWNext" title="Следующая неделя">▶</button>'
        + '<button type="button" class="svod-btn" id="svodWNow">Текущая</button>'
        + '<span class="svod-note" style="margin:0">Формируется автоматически по пятницам в 16:00, администраторам приходит уведомление' + (w && w.saved_at ? ' · сохранён ' + e(w.saved_at) : '') + '</span>'
        + '<button type="button" class="svod-btn" id="svodWXls" style="margin-left:auto">⬇ Excel</button></div>';
    if (!w) return head + skel();
    if (w.error) return head + '<div class="svod-empty" style="color:#e74c3c">❌ ' + e(w.error) + '</div>';
    var h = w.health || {};
    var kp = '<div class="svod-kpi">'
        + '<div class="svod-card ' + (h.index >= 80 ? 'ok' : h.index >= 60 ? 'warn' : 'bad') + '"><b>' + (h.index == null ? '—' : h.index) + '</b><span>индекс здоровья</span><div class="svod-sub">проблемных ' + (h.problem_pct || 0) + '% · перегруз ' + (h.over_pct || 0) + '%</div></div>'
        + '<div class="svod-card"><b>' + w.status_changes.length + '</b><span>смен статуса</span></div>'
        + '<div class="svod-card"><b>' + w.created.length + '</b><span>новых проверок</span></div>'
        + '<div class="svod-card ok"><b>' + w.done.length + '</b><span>завершено</span></div>'
        + '<div class="svod-card ' + (w.extensions.length ? 'warn' : '') + '"><b>' + w.extensions.length + '</b><span>продлений</span></div>'
        + '<div class="svod-card ' + (w.overloads.length ? 'bad' : 'ok') + '"><b>' + w.overloads.length + '</b><span>ТБ в перегрузе</span></div></div>';
    var st = w.status_changes.map(function(x) { return trow(x.id, [e(x.name), '<span class="svod-chg">' + e(x.from) + ' → <b>' + e(x.to) + '</b></span>', fdd(x.ts.slice(0, 10)) + ' ' + x.ts.slice(11, 16), e(x.who) + (x.auto ? ' <span class="svod-note" style="display:inline">(авто)</span>' : '')]); });
    var cr = w.created.map(function(x) { return trow(x.id, [e(x.name), e(x.status), fdd(x.ts.slice(0, 10)), e(x.who)]); });
    var dn = w.done.map(function(x) { return trow(x.id, [e(x.name), '✓ ' + fdd(x.date)]); });
    var ex = w.extensions.map(function(x) { return trow(x.id, [e(x.name), '+' + (x.days || 0) + ' дн.', fdd(x.from) + ' → <b>' + fdd(x.to) + '</b>', e(x.comment)]); });
    var ov = w.overloads.map(function(x) { return '<tr><td>' + e(x.bank) + '</td><td class="num">пик ' + n(x.peak) + ' из ' + n(x.capacity) + '</td><td class="num"><span class="svod-lv svod-lv' + (x.pct > 125 ? 5 : 4) + '">' + x.pct + '%</span></td></tr>'; });
    var pr = w.problems.map(function(x) { return trow(x.id, [e(x.name), '<div class="svod-probs">' + x.problems.map(function(p) { return '<span class="svod-chip">' + e(p) + '</span>'; }).join('') + '</div>']); });
    var sn = w.deadlines_soon.map(function(x) { return trow(x.id, [e(x.name), fdd(x.deadline), e(x.status)]); });
    return head + kp
        + '<div class="svod-grid">' + wsec('🔄 Смена статуса', st, 'За неделю статусы не менялись') + wsec('⏳ Продления сроков', ex, 'Продлений не было') + '</div>'
        + '<div class="svod-grid">' + wsec('🔥 Перегрузы ТБ (эта и следующая неделя)', ov, 'Перегрузов нет 👍') + wsec('🚨 Проблемные проверки', pr, 'Проблемных нет 👍') + '</div>'
        + '<div class="svod-grid">' + wsec('🆕 Новые проверки', cr, 'Новых проверок нет') + wsec('✅ Завершены', dn, 'Завершённых нет') + '</div>'
        + wsec('📅 Дедлайны в ближайшие 14 дней', sn, 'Дедлайнов нет');
}
function loadWeek() {
    if (!ST.week) ST.week = iso(monOf(new Date()));
    ST.wdata = null; render();
    fetch('/api/plugins/svod/weekly?week=' + ST.week, { credentials: 'same-origin' }).then(function(r) { return r.json().catch(function() { return { success: false, error: 'HTTP ' + r.status }; }); })
        .then(function(d) { ST.wdata = d.success ? d : { error: d.error || 'Ошибка' }; render(); })
        .catch(function(er) { ST.wdata = { error: er.message || 'Ошибка сети' }; render(); });
}
function shiftWeek(k) { var d = new Date(ST.week + 'T00:00:00'); d.setDate(d.getDate() + 7 * k); ST.week = iso(d); loadWeek(); }
window.__svodLoad = function() { if (ST.view === 'week') loadWeek(); else load(); };
document.addEventListener('click', function(ev) {
    var R = root(); if (!R || !R.contains(ev.target)) return;
    var vb = ev.target.closest('#svodView button[data-v]');
    if (vb) { ST.view = vb.getAttribute('data-v'); try { localStorage.setItem('svod.view', ST.view); } catch (x) {} window.__svodLoad(); return; }
    if (ev.target.closest('#svodWPrev')) { shiftWeek(-1); return; }
    if (ev.target.closest('#svodWNext')) { shiftWeek(1); return; }
    if (ev.target.closest('#svodWNow')) { ST.week = ''; loadWeek(); return; }
    if (ev.target.closest('#svodWXls')) { location.href = '/api/plugins/svod/weekly?format=xlsx&week=' + ST.week; return; }
    var b = ev.target.closest('#svodScope button[data-v]');
    if (b) { ST.scope = b.getAttribute('data-v'); try { localStorage.setItem('svod.scope', ST.scope); } catch (x) {} load(); return; }
    var p = ev.target.closest('#svodPreset button[data-p]');
    if (p) {
        var rr = presetRange(p.getAttribute('data-p')); ST.from = rr[0]; ST.to = rr[1];
        load(); return;
    }
    if (ev.target.closest('#svodApply')) {
        ST.from = (document.getElementById('svodFrom') || {}).value || ST.from;
        ST.to = (document.getElementById('svodTo') || {}).value || ST.to;
        load(); return;
    }
    if (ev.target.closest('#svodXls')) {
        location.href = '/api/plugins/svod/export?from=' + encodeURIComponent(ST.from) + '&to=' + encodeURIComponent(ST.to) + '&scope=' + encodeURIComponent(ST.scope);
        return;
    }
    var th = ev.target.closest('th[data-k]');
    if (th && ST.data && ST.data.tasks) {
        var key = th.getAttribute('data-k');
        if (ST.sort === key) ST.dir = -ST.dir; else { ST.sort = key; ST.dir = 1; }
        document.getElementById('svodTasks').innerHTML = tasksHtml(ST.data.tasks); return;
    }
    var tr = ev.target.closest('tr.svod-row[data-tid]');
    if (tr) {
        var id = tr.getAttribute('data-tid');
        var st = window.__trkState || {};
        var t = (st.tasks || []).find(function(x) { return String(x.id) === String(id); });
        if (t && typeof window.trkOpenTaskSmart === 'function') window.trkOpenTaskSmart(t);
        else if (typeof window.trkOpenTaskById === 'function') window.trkOpenTaskById(id);
    }
});
document.addEventListener('input', function(ev) {
    if (ev.target && ev.target.id === 'svodQ' && ST.data && ST.data.tasks) {
        ST.q = ev.target.value || '';
        document.getElementById('svodTasks').innerHTML = tasksHtml(ST.data.tasks);
    }
});
})();
"""


def _d(s):
    try:
        return datetime.strptime(str(s or '')[:10], '%Y-%m-%d').date()
    except Exception:
        return None


def _num(v):
    try:
        return float(v) if v not in (None, '') else None
    except Exception:
        return None


def _is_pvr(pk):
    return ''.join((pk or '').split()).lower() == 'пвр'


_NO_CUR = ('', 'нет', '-', '—', '–')


def _server_problems(r, today):
    """Упрощённые правила «проблемных» для сервера (отчёт, индекс здоровья)."""
    p = []
    if r['status'] in ('planning', 'approved', 'active'):
        if r.get('deviation'):
            p.append('просрочена на ' + str(r['deviation']) + ' дн.')
        if (r.get('curator') or '').strip().lower() in _NO_CUR:
            p.append('не указан куратор ЦА')
        if not r.get('banks'):
            p.append('нет банков')
        if not r.get('lead'):
            p.append('нет банка-руководителя')
        if r['status'] == 'planning' and r.get('start') and r['start'] < today.strftime('%Y-%m-%d'):
            p.append('начало прошло, статус «Планирование»')
    return p


def weekly_compute(data, audit_rows, extensions, overrides, mon, today=None):
    """Недельный отчёт по проверкам за неделю mon..mon+6.
    audit_rows — строки audit_log (entity='task') за неделю."""
    today = today or date.today()
    sun = mon + timedelta(days=6)
    a, z = mon.strftime('%Y-%m-%d'), sun.strftime('%Y-%m-%d')
    tasks = {t['id']: t for t in data.get('tasks', []) if (t.get('task_kind') or 'audit') == 'audit'}
    st_lbl = lambda k: _STATUS.get(k, k or '—')
    status_changes, created = [], []
    for r in audit_rows:
        tid = r.get('entity_id')
        if tid not in tasks:
            continue
        try:
            det = json.loads(r.get('details') or '{}')
        except Exception:
            det = {}
        who = r.get('username') or ('система' if r.get('kind') == 'task_auto_activate' else '')
        if r.get('kind') == 'task_auto_activate':
            status_changes.append({'id': tid, 'name': tasks[tid].get('name'), 'ts': r['ts'], 'who': who or 'система',
                                   'from': st_lbl(det.get('from')), 'to': st_lbl(det.get('to')), 'auto': True})
        elif r.get('kind') == 'create':
            created.append({'id': tid, 'name': tasks[tid].get('name'), 'ts': r['ts'], 'who': who,
                            'status': st_lbl(det.get('status'))})
        for c in det.get('changes') or []:
            if c.get('field') == 'status':
                status_changes.append({'id': tid, 'name': tasks[tid].get('name'), 'ts': r['ts'], 'who': who,
                                       'from': st_lbl(c.get('from')), 'to': st_lbl(c.get('to'))})
    status_changes.sort(key=lambda x: x['ts'])
    ext = []
    for x in extensions:
        ea = (x.get('extended_at') or '')[:10]
        if a <= ea <= z and x['task_id'] in tasks:
            ext.append({'id': x['task_id'], 'name': tasks[x['task_id']].get('name'), 'date': ea,
                        'days': x.get('days_added'), 'from': x.get('prev_deadline') or '', 'to': x.get('new_deadline') or '',
                        'comment': x.get('comment') or '', 'who': x.get('created_by') or ''})
    # перегрузы ТБ: эта неделя и следующая
    nxt = mon + timedelta(days=7)
    res = svod_compute(data, mon, nxt + timedelta(days=6), '', overrides, extensions, today)
    over = []
    for b in res['banks']:
        if b['capacity'] and b['peak'] > b['capacity']:
            over.append({'bank': b['name'], 'peak': b['peak'], 'capacity': b['capacity'],
                         'pct': round(100.0 * b['peak'] / b['capacity'])})
    over.sort(key=lambda x: -x['pct'])
    probs = [{'id': r['id'], 'name': r['name'], 'problems': _server_problems(r, today)}
             for r in res['tasks'] if _server_problems(r, today)]
    soon = [{'id': r['id'], 'name': r['name'], 'deadline': r['deadline'], 'status': r['status_label']}
            for r in res['tasks'] if r['status'] in ('planning', 'approved', 'active')
            and r['deadline'] and today.strftime('%Y-%m-%d') <= r['deadline'] <= (today + timedelta(days=14)).strftime('%Y-%m-%d')]
    soon.sort(key=lambda x: x['deadline'])
    done = [{'id': t['id'], 'name': t.get('name'), 'date': (t.get('completed_at') or '')[:10]}
            for t in tasks.values() if t.get('status') == 'done' and a <= (t.get('completed_at') or '')[:10] <= z]
    return {'week': a, 'week_end': z, 'status_changes': status_changes, 'created': created, 'extensions': ext,
            'done': done, 'overloads': over, 'problems': probs, 'deadlines_soon': soon,
            'health': res['kpi'].get('health'), 'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M')}


def _weekly_xlsx(rep):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = 'Недельный отчёт'
    bold, hdr = Font(bold=True), PatternFill('solid', fgColor='E0E0E0')
    ws.append(['Недельный отчёт по проверкам · ' + rep['week'] + ' — ' + rep['week_end']])
    ws['A1'].font = Font(bold=True, size=12)
    h = rep.get('health') or {}
    ws.append(['Индекс здоровья', h.get('index'), 'проблемных ' + str(h.get('problem_pct')) + '%, перегруженных недель ' + str(h.get('over_pct')) + '%'])

    def block(title, head, rows):
        ws.append([])
        ws.append([title]); ws.cell(ws.max_row, 1).font = Font(bold=True, size=11)
        ws.append(head)
        for c in ws[ws.max_row]:
            c.font, c.fill = bold, hdr
        for r in rows or [['—']]:
            ws.append(r)
    block('Смена статуса', ['Проверка', 'Было', 'Стало', 'Когда', 'Кто'],
          [[x['name'], x['from'], x['to'], x['ts'], x['who']] for x in rep['status_changes']])
    block('Новые проверки', ['Проверка', 'Статус', 'Когда', 'Кто'], [[x['name'], x['status'], x['ts'], x['who']] for x in rep['created']])
    block('Завершены', ['Проверка', 'Дата'], [[x['name'], x['date']] for x in rep['done']])
    block('Продления сроков', ['Проверка', 'Дата', '+дней', 'Было', 'Стало', 'Комментарий'],
          [[x['name'], x['date'], x['days'], x['from'], x['to'], x['comment']] for x in rep['extensions']])
    block('Перегрузы ТБ (эта и следующая неделя)', ['Тер банк', 'Пик', 'Ёмкость', '% ёмкости'],
          [[x['bank'], x['peak'], x['capacity'], x['pct']] for x in rep['overloads']])
    block('Проблемные проверки', ['Проверка', 'Проблемы'], [[x['name'], '; '.join(x['problems'])] for x in rep['problems']])
    block('Дедлайны в ближайшие 14 дней', ['Проверка', 'Дедлайн', 'Статус'], [[x['name'], x['deadline'], x['status']] for x in rep['deadlines_soon']])
    for col, w in zip('ABCDEF', (40, 16, 16, 18, 16, 40)):
        ws.column_dimensions[col].width = w
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()



def svod_compute(data, d1, d2, scope, overrides=None, extensions=None, today=None):
    """Чистая функция расчёта свода (без Flask) — удобно тестировать."""
    today = today or date.today()
    overrides = overrides or {}
    extensions = extensions or []
    f_type = 'розничная' if scope in ('розничная', 'розничная_без_пвр') else scope
    no_pvr = scope == 'розничная_без_пвр'
    dirs = ['retail'] if f_type == 'розничная' else ['corp'] if f_type == 'корпоративная' else ['retail', 'corp']
    deps = {x['id']: x for x in data.get('departments', [])}
    dname = {k: (v.get('name') or k) for k, v in deps.items()}
    holidays = data.get('holidays') or {}

    def in_scope(t):
        if (t.get('task_kind') or 'audit') != 'audit':
            return False
        if f_type and (t.get('task_type') or '') != f_type:
            return False
        if no_pvr and _is_pvr(t.get('pocket')):
            return False
        return True

    def overlaps(t):
        a = _d(t.get('start_date')) or _d(t.get('deadline'))
        b = _d(t.get('completed_at')) if t.get('status') == 'done' and t.get('completed_at') else None
        b = b or _d(t.get('deadline')) or a
        return a is not None and a <= d2 and b >= d1

    tasks = [t for t in data.get('tasks', []) if in_scope(t) and overlaps(t)]

    ext_by_task = {}
    for x in extensions:
        ext_by_task[x['task_id']] = ext_by_task.get(x['task_id'], 0) + 1

    def cur_stage(t):
        iso = today.strftime('%Y-%m-%d')
        for s in t.get('stages') or []:
            if s.get('start') and s['start'] <= iso <= (s.get('end') or t.get('deadline') or s['start']):
                return s.get('label') or s.get('key') or ''
        return ''

    # --- таблица проверок + KPI ---
    rows, by_status, done_rows = [], {k: 0 for k in _STATUS}, []
    for t in tasks:
        st = t.get('status') or 'active'
        by_status[st] = by_status.get(st, 0) + 1
        dl = _d(t.get('deadline'))
        plan_dl = _d(t.get('initial_deadline')) or dl
        comp = _d(t.get('completed_at'))
        if st == 'done' and comp:
            dev = (comp - plan_dl).days if plan_dl else None
        elif st not in ('done', 'cancelled') and dl:
            dev = (today - dl).days if today > dl else None
        else:
            dev = None
        r = {
            'id': t['id'], 'name': t.get('name') or '', 'status': st,
            'status_label': _STATUS.get(st, st),
            'task_type': t.get('task_type') or '', 'pocket': t.get('pocket') or '',
            'lead': dname.get(t.get('lead_department') or '', ''),
            'banks': [dname.get(b, b) for b in (t.get('department_ids') or [])],
            'start': t.get('start_date') or '', 'deadline': t.get('deadline') or '',
            'completed_at': t.get('completed_at') or '', 'stage': cur_stage(t) if st not in ('done', 'cancelled') else '',
            'deviation': dev, 'extensions': ext_by_task.get(t['id'], 0), 'curator': t.get('curator') or '',
        }
        rows.append(r)
        if st == 'done' and comp and d1 <= comp <= d2:
            done_rows.append((t, comp, plan_dl))
    rows.sort(key=lambda r: (r['start'] or '9999', r['name'].lower()))
    on_time = [1 for (t, comp, pdl) in done_rows if pdl and comp <= pdl]
    durs = [(comp - _d(t.get('start_date'))).days for (t, comp, _p) in done_rows if _d(t.get('start_date'))]
    ext_in_period = sum(1 for x in extensions if (_d(x.get('extended_at')) or date.min) >= d1
                        and (_d(x.get('extended_at')) or date.max) <= d2
                        and x['task_id'] in {t['id'] for t in tasks})
    overdue = sum(1 for r in rows if r['status'] not in ('done', 'cancelled') and r['deviation'])
    kpi = {
        'total': len(rows), 'by_status': by_status,
        'done_in_period': len(done_rows),
        'on_time_pct': (round(100.0 * len(on_time) / len(done_rows)) if done_rows else None),
        'avg_duration': (round(sum(durs) / len(durs)) if durs else None),
        'extensions': ext_in_period, 'overdue': overdue,
    }

    # --- банки: недельная загрузка (вес активного этапа × коэф. руководителя) ---
    def lead_coef(t, b):
        if (t.get('lead_department') or '') != b:
            return 1.0
        return 2.0 if t.get('task_type') == 'розничная' else 1.5 if t.get('task_type') == 'корпоративная' else 1.0

    def weight_at(t, mon):
        iso = mon.strftime('%Y-%m-%d')
        if t.get('task_kind') == 'other':
            if t.get('status') in ('cancelled', 'done'):
                return 0.0
            end = (mon + timedelta(days=6)).strftime('%Y-%m-%d')
            try:
                prs = json.loads(t.get('periods_json') or '[]') or []
            except Exception:
                prs = []
            if not prs:
                prs = [{'start': t.get('start_date') or iso, 'end': t.get('deadline') or end}]
            on = any((p.get('start') or '') <= end and (p.get('end') or p.get('start') or '') >= iso for p in prs)
            return float(t.get('load_coef') or 0) if on else 0.0
        # завершённые (с даты завершения) и отменённые проверки нагрузку не дают
        if t.get('status') == 'cancelled':
            return 0.0
        if t.get('status') == 'done':
            ca = (t.get('completed_at') or '')[:10]
            if len(ca) < 10 or iso >= min(ca, date.today().isoformat()):
                return 0.0
        for s in t.get('stages') or []:
            if s.get('start') and s['start'] <= iso <= (s.get('end') or s['start']):
                return float(s.get('weight') if s.get('weight') is not None else 1)
        return 0.0

    weeks = []
    m = d1 - timedelta(days=d1.weekday())
    while m <= d2:
        weeks.append(m)
        m += timedelta(days=7)
    load_tasks = [t for t in tasks if t.get('status') != 'cancelled']
    # Доп. задачи в проверке («Другое» → привязаны к проверке): нагрузка = заданная пользователем
    _scope_ids = {t['id'] for t in tasks}
    _all_by_id = {t['id']: t for t in data.get('tasks', [])}
    for _x in data.get('tasks', []):
        if (_x.get('task_kind') == 'other' and (_x.get('other_subkind') or '') == 'audit_extra'
                and (_x.get('parent_task_id') or '') in _scope_ids and _x.get('status') != 'cancelled'):
            load_tasks.append(_x)
    bank_ids = sorted({b for t in tasks for b in (t.get('department_ids') or [])}, key=lambda b: dname.get(b, b).lower())

    def cap(b):
        dep = deps.get(b) or {}
        tot, has = 0.0, False
        for dr in dirs:
            k, h = _num(dep.get('expert_coef_' + dr)), _num(dep.get('headcount_' + dr))
            if k is not None and h is not None:
                tot += k * h
                has = True
        return round(tot, 2) if has else None

    def wk_off(mon):
        return all(((mon + timedelta(days=i)).strftime('%Y-%m-%d') in holidays) for i in range(5))

    banks = []
    for b in bank_ids:
        vals = []
        for mon in weeks:
            v = 0.0
            for t in load_tasks:
                if b not in (t.get('department_ids') or []):
                    continue
                key = (t['id'], b, mon.strftime('%Y-%m-%d'))
                if key in overrides:
                    v += overrides[key]
                else:
                    v += weight_at(t, mon) * lead_coef(t, b)
            vals.append(round(v, 2))
        c = cap(b)
        work = [v for v, mon in zip(vals, weeks) if not wk_off(mon)]
        bt = [t for t in tasks if b in (t.get('department_ids') or [])]
        banks.append({
            'id': b, 'name': dname.get(b, b), 'capacity': c,
            'tasks': len(bt), 'lead': sum(1 for t in bt if (t.get('lead_department') or '') == b),
            'avg': round(sum(work) / len(work), 2) if work else 0,
            'peak': max(work) if work else 0,
            'over_weeks': (sum(1 for v in work if c and v > c) if c else None),
            'weeks': len(work),
        })

    # --- карманы × направление ---
    pk = {}
    for t in tasks:
        key = ((t.get('pocket') or '').strip() or '—', t.get('task_type') or '—')
        pk[key] = pk.get(key, 0) + 1
    pockets = [{'pocket': k[0], 'task_type': k[1], 'count': v,
                'share': round(100.0 * v / len(tasks)) if tasks else 0}
               for k, v in sorted(pk.items(), key=lambda kv: (-kv[1], kv[0][0].lower()))]

    # --- отсутствия по банкам (рабочие дни внутри периода) ---
    absb = {}
    for e in data.get('employees', []):
        b = e.get('department_id') or ''
        for v in e.get('vacations') or []:
            a, z = _d(v.get('from')), _d(v.get('to'))
            if not a or not z:
                continue
            a, z = max(a, d1), min(z, d2)
            if a > z:
                continue
            n, cur = 0, a
            while cur <= z:
                if cur.weekday() < 5 and cur.strftime('%Y-%m-%d') not in holidays:
                    n += 1
                cur += timedelta(days=1)
            if not n:
                continue
            rec = absb.setdefault(b, {'bank': dname.get(b, b or '— без банка'), 'days': 0, 'people': set(), 'by_type': {}})
            rec['days'] += n
            rec['people'].add(e['id'])
            tp = _ABS.get(v.get('type') or 'vacation', v.get('type') or '')
            rec['by_type'][tp] = rec['by_type'].get(tp, 0) + n
    absences = sorted(({'bank': r['bank'], 'days': r['days'], 'people': len(r['people']), 'by_type': r['by_type']}
                       for r in absb.values()), key=lambda r: -r['days'])

    # --- индекс здоровья: доля проблемных проверок и перегруженных банко-недель ---
    act = [r for r in rows if r['status'] in ('planning', 'approved', 'active')]
    probs = [r for r in act if _server_problems(r, today)]
    bw = sum(b['weeks'] for b in banks if b['capacity'])
    bo = sum(b['over_weeks'] or 0 for b in banks if b['capacity'])
    p_share = (len(probs) / len(act)) if act else 0.0
    o_share = (bo / bw) if bw else 0.0
    kpi['health'] = {'index': round(100 * (1 - 0.5 * p_share - 0.5 * o_share)),
                     'problem': len(probs), 'active': len(act), 'over_weeks': bo, 'bank_weeks': bw,
                     'problem_pct': round(100 * p_share), 'over_pct': round(100 * o_share)}

    return {'kpi': kpi, 'tasks': rows, 'banks': banks, 'pockets': pockets, 'absences': absences,
            'from': d1.strftime('%Y-%m-%d'), 'to': d2.strftime('%Y-%m-%d'), 'scope': scope}


def _xlsx(res, scope_label):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    bold = Font(bold=True)
    hdr = PatternFill('solid', fgColor='E0E0E0')

    def sheet(ws, title, head, data, widths):
        ws.title = title
        ws.append([f"Свод · {scope_label} · {res['from']} — {res['to']}"])
        ws['A1'].font = Font(bold=True, size=12)
        ws.append([])
        ws.append(head)
        for c in ws[3]:
            c.font = bold
            c.fill = hdr
        for r in data:
            ws.append(r)
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[chr(64 + i)].width = w
        ws.freeze_panes = 'A4'

    k = res['kpi']
    ws = wb.active
    sheet(ws, 'KPI', ['Показатель', 'Значение'], [
        ['Проверок в периоде', k['total']], *[[_STATUS[s], k['by_status'].get(s, 0)] for s in _STATUS],
        ['Завершено в периоде', k['done_in_period']], ['Закрыто в срок, %', k['on_time_pct']],
        ['Средняя длительность, дн.', k['avg_duration']], ['Продлений сроков', k['extensions']],
        ['Просрочено сейчас', k['overdue']]], [32, 14])
    sheet(wb.create_sheet(), 'Проверки',
          ['Проверка', 'Статус', 'Направление', 'Карман', 'Банк-руководитель', 'Банки', 'Начало', 'Дедлайн',
           'Завершена', 'Текущий этап', 'Отклонение, дн.', 'Продлений', 'Куратор ЦА'],
          [[r['name'], r['status_label'], r['task_type'], r['pocket'], r['lead'], ', '.join(r['banks']), r['start'],
            r['deadline'], r['completed_at'], r['stage'], r['deviation'], r['extensions'], r['curator']]
           for r in res['tasks']], [34, 14, 14, 12, 20, 34, 11, 11, 11, 20, 12, 10, 16])
    sheet(wb.create_sheet(), 'Банки', ['Тер банк', 'Проверок', 'Руководит', 'Ёмкость', 'Средняя загрузка',
                                       'Пик', 'Недель в перегрузе', 'Рабочих недель'],
          [[b['name'], b['tasks'], b['lead'], b['capacity'], b['avg'], b['peak'], b['over_weeks'], b['weeks']]
           for b in res['banks']], [28, 10, 10, 10, 14, 10, 16, 14])
    sheet(wb.create_sheet(), 'Карманы', ['Карман', 'Направление', 'Проверок', 'Доля, %'],
          [[p['pocket'], p['task_type'], p['count'], p['share']] for p in res['pockets']], [20, 16, 10, 10])
    sheet(wb.create_sheet(), 'Отсутствия', ['Тер банк', 'Раб. дней', 'Сотрудников', 'По типам'],
          [[a['bank'], a['days'], a['people'], '; '.join(f'{k}: {v}' for k, v in a['by_type'].items())]
           for a in res['absences']], [28, 10, 12, 40])
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


def register(app, db, hooks):
    print('[svod] v' + __version__ + ' · ' + __description__)

    @app.route('/plugins-assets/svod.js', methods=['GET'])
    def _svod_js():
        resp = app.response_class(_JS, mimetype='application/javascript')
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp

    def _auth():
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u:
                return None, (jsonify({'success': False, 'error': 'auth'}), 401)
            if not user_has(db, u, 'tab.summary'):
                return None, (jsonify({'success': False, 'error': 'forbidden'}), 403)
            return u, None
        except Exception:
            return None, (jsonify({'success': False, 'error': 'auth'}), 401)

    def _calc():
        d1 = _d(request.args.get('from'))
        d2 = _d(request.args.get('to'))
        if not d1 or not d2:
            y = date.today().year
            d1, d2 = date(y, 1, 1), date(y, 12, 31)
        if d2 < d1:
            d1, d2 = d2, d1
        if (d2 - d1).days > 3 * 366:
            d2 = d1 + timedelta(days=3 * 366)
        scope = request.args.get('scope', '').strip()
        if scope not in _SCOPES:
            scope = ''
        data = db.load_all()
        ov = {}
        try:
            for r in db.query('SELECT task_id, bank_id, week, value FROM gantt_task_load_overrides'):
                ov[(r['task_id'], r['bank_id'], r['week'])] = float(r['value'] or 0)
        except Exception:
            ov = {}
        try:
            ext = db.query('SELECT task_id, extended_at FROM task_extensions')
        except Exception:
            ext = []
        return svod_compute(data, d1, d2, scope, ov, ext)

    def _week_data(mon):
        sun = mon + timedelta(days=6)
        rows = db.query("SELECT ts, user_id, username, kind, entity, entity_id, details FROM audit_log "
                        "WHERE entity='task' AND substr(ts,1,10) BETWEEN ? AND ? ORDER BY id",
                        (mon.strftime('%Y-%m-%d'), sun.strftime('%Y-%m-%d')))
        data = db.load_all()
        try:
            ov = {(r['task_id'], r['bank_id'], r['week']): float(r['value'] or 0)
                  for r in db.query('SELECT task_id, bank_id, week, value FROM gantt_task_load_overrides')}
        except Exception:
            ov = {}
        try:
            ext = db.query('SELECT * FROM task_extensions')
        except Exception:
            ext = []
        return weekly_compute(data, rows, ext, ov, mon)

    def _week_of(s):
        d = _d(s) or date.today()
        return d - timedelta(days=d.weekday())

    @app.route('/api/plugins/svod/weekly', methods=['GET'])
    def _svod_weekly():
        u, err = _auth()
        if err:
            return err
        mon = _week_of(request.args.get('week'))
        snap = None
        try:
            r = db.query_one('SELECT value FROM settings WHERE key=?', ('svod_weekly_' + mon.strftime('%Y-%m-%d'),))
            snap = json.loads(r['value']) if r and r.get('value') else None
        except Exception:
            snap = None
        rep = _week_data(mon)
        rep['saved_at'] = (snap or {}).get('generated_at')
        if request.args.get('format') == 'xlsx':
            resp = Response(_weekly_xlsx(rep), mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
            resp.headers['Content-Disposition'] = 'attachment; filename=weekly_' + rep['week'] + '.xlsx'
            return resp
        rep['success'] = True
        return jsonify(rep)

    def _friday_job():
        """Пятница, 16:00 и позже: сохранить отчёт недели и разослать уведомление админам (один раз)."""
        now = datetime.now()
        if now.weekday() != 4 or now.hour < 16:
            return False
        mon = (now.date() - timedelta(days=now.weekday()))
        key = 'svod_weekly_' + mon.strftime('%Y-%m-%d')
        if db.query_one('SELECT 1 FROM settings WHERE key=?', (key,)):
            return False
        rep = _week_data(mon)
        db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                (key, json.dumps({k: rep[k] for k in ('generated_at', 'health')}, ensure_ascii=False)))
        h = rep.get('health') or {}
        msg = ('📰 Недельный отчёт ' + mon.strftime('%d.%m') + '–' + (mon + timedelta(days=6)).strftime('%d.%m')
               + ': смен статуса ' + str(len(rep['status_changes'])) + ', продлений ' + str(len(rep['extensions']))
               + ', перегрузов ТБ ' + str(len(rep['overloads'])) + ', индекс здоровья ' + str(h.get('index', '—'))
               + '. Статистика → Свод → Недельный отчёт.')
        for adm in db.query("SELECT id FROM users WHERE role='admin'"):
            db.exec("INSERT INTO notifications (ts, to_user_id, from_user_id, from_username, kind, task_id, employee_id, message, status, read_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (now.strftime('%Y-%m-%d %H:%M:%S'), adm['id'], None, 'Свод', 'weekly_report', '', '', msg, 'new', ''))
        print('[svod] недельный отчёт сохранён:', key)
        return True

    app.config['SVOD_FRIDAY_JOB'] = _friday_job

    def _scheduler():
        import time
        while True:
            try:
                _friday_job()
            except Exception as e:
                print('[svod] weekly job error:', repr(e))
            time.sleep(600)

    def _on_start(**ctx):
        import threading
        threading.Thread(target=_scheduler, daemon=True, name='svod-weekly').start()
        print('[svod] расписание недельного отчёта: пятница, 16:00')
    hooks.on('on_startup', _on_start)

    @app.route('/api/plugins/svod/data', methods=['GET'])
    def _svod_data():
        u, err = _auth()
        if err:
            return err
        res = _calc()
        res['success'] = True
        return jsonify(res)

    @app.route('/api/plugins/svod/export', methods=['GET'])
    def _svod_export():
        u, err = _auth()
        if err:
            return err
        res = _calc()
        lbl = {'': 'Всего ОАМ', 'корпоративная': 'Корпоративное', 'розничная': 'Розничное с ПВР',
               'розничная_без_пвр': 'Розничное без ПВР'}.get(res['scope'], '')
        fname = 'svod_' + res['from'] + '_' + res['to']
        try:
            data = _xlsx(res, lbl)
        except Exception as e:
            import traceback, csv
            traceback.print_exc()
            print('[svod] openpyxl не удался, отдаю CSV:', repr(e))
            sio = io.StringIO()
            w = csv.writer(sio, delimiter=';')
            w.writerow(['Проверка', 'Статус', 'Направление', 'Карман', 'Банк-руководитель', 'Банки', 'Начало',
                        'Дедлайн', 'Завершена', 'Этап', 'Отклонение', 'Продлений'])
            for r in res['tasks']:
                w.writerow([r['name'], r['status_label'], r['task_type'], r['pocket'], r['lead'], ', '.join(r['banks']),
                            r['start'], r['deadline'], r['completed_at'], r['stage'], r['deviation'], r['extensions']])
            resp = Response(('\ufeff' + sio.getvalue()).encode('utf-8'), mimetype='text/csv; charset=utf-8')
            resp.headers['Content-Disposition'] = 'attachment; filename=' + fname + '.csv'
            return resp
        resp = Response(data, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        resp.headers['Content-Disposition'] = 'attachment; filename=' + fname + '.xlsx'
        return resp
