/* tracker/boot.js — Загрузка: квартал завершения, признаки проблем, guard-флаги, меню плагинов.
   Файлы грузятся строго по порядку: boot → core → ui → task_card → tabs (см. templates/tracker.html). */
/* PATCH quarter-completion: поле «Завершение» (бывшая «Иконка») — квартал вида 4Q26 */
(function(){
    var RE = /^[1-4]Q\d{2}$/;
    function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
    window.trkIsQuarter = function(v){ return RE.test(String(v || '').trim()); };
    window.trkQuarterValue = function(v){ v = String(v || '').trim(); return RE.test(v) ? v : ''; };
    window.trkEnsureQuarterOption = function(v){
        if (!v) return;
        var sel = document.getElementById('task_icon');
        if (!sel || sel.tagName !== 'SELECT') return;
        for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) return;
        var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    };
    window.trkQuarterBadge = function(v, cls){
        var q = window.trkQuarterValue(v);
        if (q) return '<span class="' + (cls || '') + ' trk-quarter-badge" title="Завершение">' + esc(q) + '</span>';
        return '<span class="' + (cls || '') + ' trk-quarter-empty" title="Завершение не указано">—</span>';
    };
})();

/* PATCH task-problems: признаки «Проблемных» — общий источник для фильтра и бейджа на карточке */
(function(){
    var PLAN_WARN_DAYS = 7;
    function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
    function diffDays(a, b){ return Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000); }
    function quarterEnd(q){
        var m = /^([1-4])Q(\d{2})$/.exec(String(q || '').trim());
        if (!m) return '';
        var y = 2000 + parseInt(m[2], 10), qq = parseInt(m[1], 10);
        return iso(new Date(y, qq * 3, 0));
    }
    var _logCache = { ref: null, len: -1, map: {} };
    function logsByTask(){
        var st = window.__trkState || {};
        var log = st.log || [];
        if (_logCache.ref === log && _logCache.len === log.length) return _logCache.map;
        var map = {};
        log.forEach(function(l){ map[l.task_id] = (map[l.task_id] || 0) + 1; });
        _logCache = { ref: log, len: log.length, map: map };
        return map;
    }
    window.trkQuarterEnd = quarterEnd;
    window.trkTaskProblems = function(t){
        if (!t) return null;
        if (t.status === 'done' || t.status === 'cancelled' || t.status === 'archived') return null;
        var st = window.__trkState || {};
        var today = st.today || iso(new Date());
        var isAudit = (t.task_kind || 'audit') !== 'other';
        var r = [];
        if (!(t.assignees || []).length) r.push('нет участников');
        if (isAudit && !(t.department_ids || []).length) r.push('нет банков-участников');
        var _cur = String(t.curator || '').trim().toLowerCase();
        if (!_cur || _cur === 'нет' || _cur === '-' || _cur === '—' || _cur === 'не указан') r.push('не указан куратор ЦА');
        if (isAudit && !String(t.pocket || '').trim()) r.push('нет кармана');
        if (isAudit && (!t.lead_department || !t.lead_employee)) r.push('нет руководителя');
        var q = (window.trkQuarterValue ? window.trkQuarterValue(t.icon) : '');
        if (!q) r.push('не указан квартал');
        else {
            var qe = quarterEnd(q);
            if (t.deadline && qe && t.deadline > qe) r.push('дедлайн позже ' + q);
        }
        if (t.status === 'approved' && t.start_date && t.start_date <= today) r.push('не перешла в «Активна»');
        if (t.status === 'planning' && t.start_date) {
            var left = diffDays(t.start_date, today);
            if (left < PLAN_WARN_DAYS) r.push(left < 0 ? 'не утверждена, старт прошёл' : 'не утверждена, до старта ' + left + ' дн.');
        }
        if (t.deadline && t.deadline < today) r.push('просрочена');
        return r.length ? r : null;
    };
    /* opts.soft — приглушённые янтарные чипы (список); opts.max — показать не больше N чипов, остальные в «+N» (плитка) */
    window.trkTaskProblemsBadge = function(t, opts){
        opts = opts || {};
        var r = window.trkTaskProblems(t);
        if (!r) return '';
        var esc = function(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); };
        var cap = function(p){ return p.charAt(0).toUpperCase() + p.slice(1); };
        var cls = 'trk-prob-chip' + (opts.soft ? ' trk-prob-chip--soft' : '');
        var shown = r, rest = [];
        if (opts.max && r.length > opts.max) { shown = r.slice(0, opts.max); rest = r.slice(opts.max); }
        var html = shown.map(function(p){
            var txt = cap(p);
            return '<span class="' + cls + '" title="' + esc(txt) + '">\ud83d\udea8 ' + esc(txt) + '</span>';
        }).join('');
        if (rest.length) html += '<span class="' + cls + ' trk-prob-more" title="' + esc(rest.map(cap).join('\n')) + '">+' + rest.length + '</span>';
        return '<div class="trk-prob-chips' + (opts.max ? ' trk-prob-chips--clip' : '') + '">' + html + '</div>';
    };
    /* Автоматическое число колонок плитки: 5 при масштабе 100%, меняется с масштабом браузера */
    function _zoom(){
        var ow = window.outerWidth, iw = window.innerWidth;
        if (!ow || !iw) return 1;
        var z = ow / iw;
        if (!isFinite(z) || z < 0.25 || z > 5) return 1;
        if (Math.abs(z - 1) < 0.04) return 1;
        return z;
    }
    window.trkAutoColsCount = function(width){
        var n = Math.round(5 / _zoom());
        if (n < 1) n = 1;
        if (n > 12) n = 12;
        if (width) {
            var maxByWidth = Math.max(1, Math.floor(width / 170));
            if (n > maxByWidth) n = maxByWidth;
        }
        return n;
    };
    window.trkApplyAutoCols = function(el){
        if (!el) return;
        var n = window.trkAutoColsCount(el.clientWidth || window.innerWidth);
        el.style.setProperty('grid-template-columns', 'repeat(' + n + ', minmax(0, 1fr))', 'important');
        el.setAttribute('data-auto-cols', String(n));
    };
    var _acT = null;
    window.addEventListener('resize', function(){
        clearTimeout(_acT);
        _acT = setTimeout(function(){
            document.querySelectorAll('.tasks-grid.tsk-auto-cols').forEach(window.trkApplyAutoCols);
        }, 80);
    });
})();
/* PATCH 1.0.35 — B3: глушим старые перехватчики log/save */
(function(){
    'use strict';
    window.__trkOverflowModalV2 = true;   // PATCH 07
    window.__trkLogFormFocusFetch = true; // v1.0.4
    window.__trkAutoAssignFetch = true;   // v1.0.10
    window.__trkLogDupDayFetch = true;    // v1.0.19
    window.__trkCloseAllAfterLogV1024 = true; // v1.0.24
    window.__trkMultiFieldsFixV1032 = true;   // v1.0.32
})();
/* PATCH 1.0.34 — отключаем устаревшую кнопку #tskCompactToggle (v1.0.12) */
(function(){ 'use strict'; window.__trkCompactModeV112 = true; })();
/* ============================================================
   PATCH 1.0.3 — реестр плагинов + дропдаун под вкладкой «Статистика»
   ============================================================ */
(function(){
'use strict';
if (window.__trkPluginMenuV103) return;
window.__trkPluginMenuV103 = true;

window.__trkPluginRegistry = window.__trkPluginRegistry || [];

window.__trkRegisterPlugin = function(opts){
    if (!opts) return;
    if (!opts.url && typeof opts.onClick !== 'function') return;
    var arr = window.__trkPluginRegistry;
    var key = opts.id || opts.url || opts.name || '';
    if (!key) return;
    for (var i = 0; i < arr.length; i++) {
        var ex = arr[i];
        if ((opts.id && ex.id === opts.id) || (opts.url && ex.url && ex.url === opts.url)) return;
    }
    arr.push(opts);
    if (window.__trkBuildStatsMenu) setTimeout(window.__trkBuildStatsMenu, 30);
};

window.__trkBuildStatsMenu = function(){
    var statsTab = document.querySelector('.tracker-tab[data-tab="stats"]');
    if (!statsTab) return;
    if (!statsTab.querySelector('.tab-menu-arrow')) {
        var arrow = document.createElement('span');
        arrow.className = 'tab-menu-arrow';
        arrow.textContent = '▾';
        statsTab.appendChild(arrow);
    }
    var menu = document.getElementById('statsPluginMenu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'statsPluginMenu';
        menu.className = 'stats-plugin-menu';
        document.body.appendChild(menu);
    }
    var perms = window.REESTR_PERMS || {};
    var html = '<div class="spm-item" data-action="builtin"><span>📊</span><span>Встроенная статистика</span></div>';
    /* PATCH: «Свод» переехал из верхнего ряда в меню «Статистика» */
    html += '<div class="spm-item" data-action="summary"><span>📊</span><span>Свод</span></div>';
    var arr = window.__trkPluginRegistry || [];
    var HIDDEN_PLUGINS = { capacity: 1, stats_teams: 1 };   /* убраны из меню, страницы остались */
    for (var i = 0; i < arr.length; i++) {
        var p = arr[i];
        if (p.id && HIDDEN_PLUGINS[p.id]) continue;
        if (p.perm && !perms[p.perm]) continue;
        if (typeof p.onClick === 'function') {
            html += '<button type="button" class="spm-item" data-plugin-idx="' + i + '"><span>' + (p.icon || '🔗') + '</span><span>' + p.name + '</span></button>';
        } else if (p.url && p.url !== '#') {
            html += '<a class="spm-item" href="' + p.url + '"><span>' + (p.icon || '🔗') + '</span><span>' + p.name + '</span></a>';
        } else {
            html += '<button type="button" class="spm-item" data-plugin-idx="' + i + '"><span>' + (p.icon || '🔗') + '</span><span>' + p.name + '</span></button>';
        }
    }
    var _lp = window.REESTR_PLUGINS;
    if (perms['tab.settings'] && (!Array.isArray(_lp) || _lp.indexOf('weekly_report') >= 0)) {
        html += '<a class="spm-item" href="/plugins/weekly_report/"><span>📥</span><span>Недельные отчёты</span></a>';
    }
    menu.innerHTML = html;
};

document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    // PATCH 1.0.12: клик по всей кнопке «Статистика» открывает меню,
    // вкладка при этом не переключается.
    var statsTab = e.target.closest('.tracker-tab[data-tab="stats"]');
    if (statsTab) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        var menu = document.getElementById('statsPluginMenu');
        if (!menu) { window.__trkBuildStatsMenu(); menu = document.getElementById('statsPluginMenu'); }
        if (!menu) return;
        var rect = statsTab.getBoundingClientRect();
        menu.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
        menu.style.top = (rect.bottom + 6) + 'px';
        menu.classList.toggle('active');
        return;
    }
    var sumItem = e.target.closest('#statsPluginMenu [data-action="summary"]');
    if (sumItem) {
        e.preventDefault();
        e.stopPropagation();
        document.querySelectorAll('.tracker-tab').forEach(function(t){ t.classList.remove('active'); });
        document.querySelectorAll('.tracker-panel').forEach(function(p){
            p.classList.toggle('active', p.id === 'panel-summary');
        });
        try { localStorage.setItem('tracker_activeTab', 'summary'); } catch (er) {}
        if (typeof window.__trkLoadSummary === 'function') { try { window.__trkLoadSummary(); } catch (er) {} }
        var ms = document.getElementById('statsPluginMenu');
        if (ms) ms.classList.remove('active');
        return;
    }
    var builtin = e.target.closest('#statsPluginMenu [data-action="builtin"]');
    if (builtin) {
        e.preventDefault();
        e.stopPropagation();
        var st = document.querySelector('.tracker-tab[data-tab="stats"]');
        if (st) {
            document.querySelectorAll('.tracker-tab').forEach(function(t) {
                t.classList.toggle('active', t === st);
            });
            document.querySelectorAll('.tracker-panel').forEach(function(p) {
                p.classList.toggle('active', p.id === 'panel-stats');
            });
            try { localStorage.setItem('tracker_activeTab', 'stats'); } catch (er) {}
            if (typeof window.__trkLoadStats === 'function') {
                try { window.__trkLoadStats(); } catch (er) {}
            }
        }
        var m = document.getElementById('statsPluginMenu');
        if (m) m.classList.remove('active');
        return;
    }
    if (!e.target.closest('#statsPluginMenu')) {
        var m2 = document.getElementById('statsPluginMenu');
        if (m2 && m2.classList.contains('active')) m2.classList.remove('active');
    }
}, true);

setTimeout(function(){ try { window.__trkBuildStatsMenu(); } catch(e){} }, 500);
setTimeout(function(){ try { window.__trkBuildStatsMenu(); } catch(e){} }, 1500);
setTimeout(function(){ try { window.__trkBuildStatsMenu(); } catch(e){} }, 3000);

// PATCH 1.0.16: клик по кнопке плагина с onClick
document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var btn = e.target.closest('#statsPluginMenu [data-plugin-idx]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var idx = parseInt(btn.getAttribute('data-plugin-idx'), 10);
    var arr = window.__trkPluginRegistry || [];
    if (!isNaN(idx) && arr[idx] && typeof arr[idx].onClick === 'function') {
        try { arr[idx].onClick(); } catch (er) { console.error('[plugin-menu]', er); }
    }
    var m = document.getElementById('statsPluginMenu');
    if (m) m.classList.remove('active');
}, true);

})();
/* ============================================================
   PATCH 1.0.1 — применён (2026-10-15)
   Guard-флаги конфликтов + маркер версии.
   Проверка в браузере: window.__trkPatchVersion
   ============================================================ */
(function () {
    'use strict';
    window.__trkPatchVersion = '1.0.1';
    window.__trkPatchAppliedAt = '2026-10-15';
    window.__trkLogEditTaskMergeV1015 = true;
    window.__trkDelLogFeedbackV1013 = true;
    window.__trkQuickAddAssigned = true;
    try {
        console.log('%c[tracker.js] патч 1.0.1 применён', 'color:#2ecc71;font-weight:bold');
    } catch (e) {}
})();
