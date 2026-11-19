/* tracker_next/01_core.js — Ядро трекера: состояние, API, отрисовка вкладок (без изменений).
   Файлы грузятся строго по порядку 00→04. Источник: static/tracker.js. */
/* Трекер задач — клиентская логика (standalone). v1.4 */
(function() {
'use strict';

var PERMS = window.REESTR_PERMS || {};
function hasPerm(k) { return !!PERMS[k]; }

var state = {
    employees: [], tasks: [], log: [], emoji: [], palette: [],
    departments: [], teams: [], holidays: {},
    allTags: [], tagPresets: [],
    statusLabels: {}, taskStatusLabels: {}, absenceTypes: {},
    calendar: null, heatmap: null, summary: null, summaryIsGrid: true,
    currentYM: '', currentEmployee: '', currentDepartment: '', currentTeam: '', currentDay: '',
    calViewMode: 'tasks', tskViewMode: 'all',
    tskDisplayMode: 'list', tskGridCols: 3, tskView: 'list',
    hmYM: '', hmDateFrom: '', hmDateTo: '',
    sumViewMode: 'grid', sumShowDayTotals: true, sumTaskRowMode: 'full',
    today: '', theme: 'dark', maskNames: false,
    currentUser: null,
    calExpandOnHover: true,
    tskCompactMode: false,
};

var MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                 'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

var CSRF = window.REESTR_CSRF || '';
window.__trkState = state;
var meta = document.querySelector('meta[name="csrf-token"]');
if (!CSRF && meta) CSRF = meta.getAttribute('content') || '';

var _tagDraft = [];
var _logExistingMode = 'me';
var _logExistingEmpId = '';

/* ============================================================
   УТИЛИТЫ
   ============================================================ */
function $(id) { return document.getElementById(id); }
function on(id, ev, fn) {
    var el = $(id);
    if (el) el.addEventListener(ev, fn);
    return el;
}
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function maskName(name) {
    if (!state.maskNames) return name;
    var s = String(name == null ? '' : name);
    if (!s) return s;
    return s.split(/\s+/).map(function(w) {
        if (w.length <= 1) return w;
        return w[0] + new Array(w.length).join('*');
    }).join(' ');
}
function escName(name) { return escapeHtml(maskName(name)); }

function notify(msg, kind) {
    var n = $('trackerNotif'); if (!n) return;
    var isErr = (kind === 'error');
    n.className = 'tracker-notification show' + (isErr ? ' error' : '');
    clearTimeout(n._t);
    // PATCH v1.0.11: ошибка не автоскрывается — только по крестику или новому notify
    if (isErr) {
        n.innerHTML = '';
        var msgSpan = document.createElement('span');
        msgSpan.className = 'notif-msg';
        msgSpan.textContent = String(msg == null ? '' : msg);
        n.appendChild(msgSpan);
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'notif-close';
        closeBtn.setAttribute('aria-label', 'Закрыть');
        closeBtn.title = 'Закрыть';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', function() {
            n.classList.remove('show');
            clearTimeout(n._t);
        });
        n.appendChild(closeBtn);
    } else {
        n.textContent = msg;
        n._t = setTimeout(function() { n.classList.remove('show'); }, 4500);
    }
}
window.__trackerNotify = notify;

/* ============================================================
   ЛОАДЕР
   ============================================================ */
var _reqCount = 0;
var _minHideTimer = null;
var LOADER_MIN_MS = 250;

function _setLoaderLabel(label) {
    var l = $('globalLoader');
    if (!l) return;
    var t = l.querySelector('.gl-text');
    if (!t) return;
    t.textContent = label || 'Загрузка…';
}
// PATCH v1.0.11: опциональный label — 'Сохранение…', 'Удаление…' и т.п.
// PATCH v1.0.12: стек меток параллельных запросов.
var _loaderStack = [];
function _showLoader(label) {
    _reqCount++;
    _loaderStack.push(label || '');
    if (_minHideTimer) { clearTimeout(_minHideTimer); _minHideTimer = null; }
    var l = $('globalLoader');
    if (l) l.classList.add('active');
    _setLoaderLabel(label);
}
function _hideLoader() {
    _reqCount = Math.max(0, _reqCount - 1);
    _loaderStack.pop();
    if (_reqCount > 0) {
        var top = _loaderStack.length ? _loaderStack[_loaderStack.length - 1] : '';
        _setLoaderLabel(top);
        return;
    }
    if (_minHideTimer) return;
    _minHideTimer = setTimeout(function() {
        if (_reqCount === 0) {
            var l = $('globalLoader');
            if (l) l.classList.remove('active');
            _setLoaderLabel('');
        }
        _minHideTimer = null;
    }, LOADER_MIN_MS);
}
(function() {
    var SEL = [
        'button', 'a[href]',
        '.tracker-tab', '.segmented button', '.dict-action-btn', '.btn',
        '.cal-nav-btn', '.period-arrow-btn', '.log-existing-tab',
        '.tracker-back-btn', '.theme-toggle-btn', '.mask-toggle-btn',
        '.user-btn', '.dict-add-btn', '.icon-picker-btn', '.emoji-btn',
        '.palette-dot', '.assignees-item', '.dept-multi-item',
        '.chart-bar', '.chart-slice', '.donut-legend-item.clickable',
        '.task-tag-chip.clickable',
    ].join(', ');
    document.addEventListener('click', function(e) {
        var t = e.target.closest(SEL);
        if (!t) return;
        if (t.disabled) return;
        if (t.dataset && t.dataset.noLoader === '1') return;
        _showLoader();
        setTimeout(_hideLoader, 0);
    }, true);
})();

function apiJson(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers || {});
    if (CSRF && options.method && options.method !== 'GET')
        options.headers['X-CSRF-Token'] = CSRF;
    if (!options.credentials) options.credentials = 'same-origin';
    if (!options.cache) options.cache = 'no-store';
    // PATCH v1.0.11: пробрасываем подпись загрузчика (options.label)
    _showLoader(options.label);
    return fetch(url, options).then(function(r) {
        if (r.status === 401) { location.href = '/login'; return new Promise(function(){}); }
        if (r.status === 403) {
            return r.text().then(function(t) {
                var m = 'Недостаточно прав';
                try { var j = JSON.parse(t); if (j.error) m += ': ' + j.error; } catch (e) {}
                throw new Error(m);
            });
        }
        if (!r.ok) {
            return r.text().then(function(t) {
                var msg = 'HTTP ' + r.status;
                try { var j = JSON.parse(t); if (j && j.error) msg += ' — ' + j.error; }
                catch (e) { if (t) msg += ' — ' + t.slice(0, 200); }
                throw new Error(msg);
            });
        }
        return r.json();
    }).finally(_hideLoader);
}

/* ============================================================
   ДАТЫ / ЧИСЛА
   ============================================================ */
function todayYM() {
    var t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
}
function todayISO() {
    var t = new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function isoFromDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseISO(s) {
    var p = String(s).split('-');
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}
function addDaysISO(iso, delta) {
    var d = parseISO(iso);
    d.setDate(d.getDate() + delta);
    return isoFromDate(d);
}
function firstOfMonthISO(ym) { return ym + '-01'; }
function firstOfMonthISOFromDate(d) {
    var t = d || new Date();
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-01';
}
function getMondayISO() {
    var t = new Date();
    var wd = t.getDay();
    var diff = (wd === 0) ? -6 : (1 - wd);
    var mon = new Date(t.getTime() + diff * 86400000);
    return isoFromDate(mon);
}
function getSundayISO() {
    var mon = getMondayISO();
    var sun = new Date(new Date(mon + 'T00:00:00').getTime() + 6 * 86400000);
    return isoFromDate(sun);
}
function setDefaultWeekRange() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    if (a) a.value = getMondayISO();
    if (b) b.value = getSundayISO();
}
function setMonthRange() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    if (a) a.value = firstOfMonthISOFromDate(new Date());
    if (b) b.value = todayISO();
}
function formatDateHuman(iso) {
    try {
        var p = iso.split('-');
        return parseInt(p[2], 10) + ' ' + MONTHS_RU[parseInt(p[1], 10) - 1].toLowerCase() + ' ' + p[0];
    } catch (e) { return iso; }
}
function formatDateShort(iso) {
    try { var p = iso.split('-'); return parseInt(p[2], 10) + '.' + p[1]; }
    catch (e) { return iso; }
}
function formatHours(h) {
    h = Number(h) || 0;
    if (h === Math.floor(h)) return h + ' ч';
    return h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' ч';
}
function shortHours(h) {
    h = Number(h) || 0;
    if (h === Math.floor(h)) return String(h);
    return h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function hoursClass(h) {
    h = Number(h) || 0;
    if (h <= 0) return '';
    if (h < 2) return 'hours-1';
    if (h < 4) return 'hours-2';
    if (h < 6) return 'hours-3';
    return 'hours-4';
}
function heatmapColor(hours) {
    return cellLightGreen(hours) || '';
}

function cellLightGreen(hours) {
    var h = Number(hours) || 0;
    if (h <= 0) return '';
    if (h > 24) h = 24;
    var yellow = [250, 235, 150];
    var green  = [110, 200, 140];
    var pink   = [250, 180, 200];
    var a, b, t;
    if (h <= 8) {
        a = yellow; b = green; t = h / 8;
    } else {
        a = green; b = pink; t = Math.min((h - 8) / 8, 1);
    }
    var r = Math.round(a[0] + (b[0] - a[0]) * t);
    var g = Math.round(a[1] + (b[1] - a[1]) * t);
    var bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
}
function statusClass(s) {
    if (s === 'done') return 'status-done';
    if (s === 'in_progress') return 'status-in_progress';
    if (s === 'planned') return 'status-planned';
    if (s === 'blocked') return 'status-blocked';
    return '';
}
function absenceIcon(t) {
    if (t === 'sick_leave') return '🤒';
    if (t === 'business_trip') return '✈️';
    if (t === 'vacation') return '🌞';
    if (t === 'remote') return '🏠';
    return '';
}
function absenceLabel(t) {
    var m = state.absenceTypes || {};
    if (m[t]) return m[t];
    if (t === 'sick_leave') return '🤒 Больничный';
    if (t === 'business_trip') return '✈️ Командировка';
    if (t === 'remote') return '🏠 Удаленка';
    return '🌞 Отпуск';
}
function absenceClass(t) {
    if (t === 'sick_leave') return 'sick_leave';
    if (t === 'business_trip') return 'business_trip';
    if (t === 'remote') return 'remote';
    return 'vacation';
}

/* ============================================================
   ТЕМА
   ============================================================ */
function applyTrkTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    state.theme = theme;
    document.body.classList.remove('trk-theme-dark', 'trk-theme-light');
    document.body.classList.add('trk-theme-' + theme);
    document.documentElement.setAttribute('data-trk-theme', theme);
    try { localStorage.setItem('reestr_tracker_theme', theme); } catch (e) {}
    var icon = $('trkThemeIcon'), label = $('trkThemeLabel');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (label) label.textContent = theme === 'dark' ? 'Светлая' : 'Тёмная';
}
(function initTheme() {
    var saved = 'dark';
    try { saved = localStorage.getItem('reestr_tracker_theme') || 'dark'; } catch (e) {}
    applyTrkTheme(saved);
})();
on('trkThemeToggle', 'click', function() {
    applyTrkTheme(state.theme === 'dark' ? 'light' : 'dark');
});

/* ============================================================
   ОПЦИОНАЛЬНЫЙ РАЗВОРОТ ДНЯ
   ============================================================ */
function applyCalExpand(on) {
    state.calExpandOnHover = !!on;
    try { localStorage.setItem('tracker_cal_expand', on ? '1' : '0'); } catch (e) {}
    var grid = $('calGrid');
    if (grid) grid.setAttribute('data-expand', on ? 'on' : 'off');
    document.body.classList.toggle('cal-expand-off', !on);
    var btn = $('calExpandToggle');
    if (btn) btn.classList.toggle('active', on);
    var icon = $('calExpandIcon');
    var label = $('calExpandLabel');
    if (icon) icon.textContent = on ? '⤢' : '⤡';
    if (label) label.textContent = on ? 'Разворот дня: вкл' : 'Разворот дня: выкл';
}
(function initCalExpand() {
    var saved = '1';
    try { saved = localStorage.getItem('tracker_cal_expand') || '1'; } catch (e) {}
    applyCalExpand(saved === '1');
})();
on('calExpandToggle', 'click', function() {
    applyCalExpand(!state.calExpandOnHover);
});

/* ============================================================
   МАСКИРОВАНИЕ
   ============================================================ */
function applyMask(enabled) {
    state.maskNames = !!enabled;
    try { localStorage.setItem('reestr_tracker_mask', enabled ? '1' : '0'); } catch (e) {}
    window.__trkMaskNames = state.maskNames;
    if (typeof window.__trkOnMaskChange === 'function') {
        try { window.__trkOnMaskChange(state.maskNames); } catch (e) {}
    }
    var btn = $('trkMaskToggle');
    if (btn) btn.classList.toggle('active', state.maskNames);
    var icon = $('trkMaskIcon'), label = $('trkMaskLabel');
    if (icon) icon.textContent = state.maskNames ? '🙈' : '👁';
    if (label) label.textContent = state.maskNames ? 'Показать ФИО' : 'Маска ФИО';
}
(function initMask() {
    var saved = '0';
    try { saved = localStorage.getItem('reestr_tracker_mask') || '0'; } catch (e) {}
    applyMask(saved === '1');
})();
on('trkMaskToggle', 'click', function() {
    applyMask(!state.maskNames);
    renderDepartments();
    renderEmployees();
    renderTeams();
    renderTasks();
    renderHolidaysInline();
    if (state.calendar) renderCalendar();
    if (state.summary) {
        if (state.summaryIsGrid) renderSummaryGrid();
        else renderSummary();
    }
    if (state.heatmap) renderHeatmap();
});

/* ============================================================
   ТАБЫ
   ============================================================ */
document.querySelectorAll('.tracker-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
        var id = this.getAttribute('data-tab');
        document.querySelectorAll('.tracker-tab').forEach(function(t) {
            t.classList.toggle('active', t === tab);
        });
        document.querySelectorAll('.tracker-panel').forEach(function(p) {
            p.classList.toggle('active', p.id === 'panel-' + id);
        });
        try { localStorage.setItem('tracker_activeTab', id); } catch (e) {}
        if (id === 'tasks') renderTasksFull();
        if (id === 'completed' && typeof renderCompletedFull === 'function') renderCompletedFull();
        if (id === 'heatmap') loadHeatmap();
        if (id === 'summary') loadSummary();
        if (id === 'stats') {
            var a = $('stDateFrom'), b = $('stDateTo');
            if (a && !a.value) a.value = firstOfMonthISO(todayYM());
            if (b && !b.value) b.value = todayISO();
            loadStats();
        }
    });
});
(function restoreTab() {
    try {
        var savedDept = localStorage.getItem('tracker_calDept');
        if (savedDept) state.currentDepartment = savedDept;
    } catch (e) {}
})();

/* ============================================================
   SEGMENTED
   ============================================================ */
function setupSegmented(elId, initial, onChange) {
    var wrap = $(elId); if (!wrap) return;
    var btns = wrap.querySelectorAll('button');
    btns.forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === initial);
        b.addEventListener('click', function() {
            btns.forEach(function(x) { x.classList.remove('active'); });
            this.classList.add('active');
            onChange(this.getAttribute('data-mode'));
        });
    });
}

/* ============================================================
   STATE
   ============================================================ */
window.__trkState = state;
window.__trkRenderSummaryGrid = function() {
    try { renderSummaryGrid(); } catch (e) { console.error(e); }
};

/* PATCH: не затираем внешний __trkOnSummaryRender — раньше он терялся
   при второй обёртке renderSummaryGrid (collapse-all v2). Теперь 
   вызываем оба: и внешний хук, и collapse-all-функцию. */
(function() {
    var _orig = renderSummaryGrid;
    renderSummaryGrid = function() {
        _orig.apply(this, arguments);
        // Сначала внешний хук (штриховки missing, future-даты)
        if (typeof window.__trkOnSummaryRender === 'function') {
            try { window.__trkOnSummaryRender(); } catch (e) { console.error(e); }
        }
    };
})();

/* === Bridge в window === */
window.__trkState = state;
window.__trkOpenDayModal = openDayModal;
window.__trkOpenTaskModal = openTaskModal;
window.__trkOpenTaskKindChooser = openTaskKindChooser;
window.__trkLoadSummary = loadSummary;   // PATCH: раньше не экспортировался — 
                                          // пилюли тегов в Своде не перерисовывали
window.__trkLoadStats = loadStats;
window.__trkRenderTasksFull = renderTasksFull;
window.__trkRenderCalendar = loadCalendar;
window.__trkLoadState = loadState;
window.__trkOpenLogModal = openLogModal;
window.__trkFillTaskSelect = fillTaskSelect;
window.__trkBindDayEntryActions = bindDayEntryActions;
window.__trkCanEditEntry = canEditEntry;
window.__trkCanDeleteEntry = canDeleteEntry;
window.__trackerNotify = notify;

/* Инициализация режима просмотра дневной карточки */
(function initDayViewMode() {
    var v = 'task';
    try { v = localStorage.getItem('tracker_day_view') || 'task'; } catch (e) {}
    if (v !== 'task' && v !== 'employee') v = 'task';
    state.dayViewMode = v;
})();

/* Обёртка renderDayList — диспатч по режиму */
var __origRenderDayList = renderDayList;
renderDayList = function(entries, totalHours, day) {
    var mode = state.dayViewMode || 'task';
    if (mode === 'employee' && typeof window.__trkRenderDayByEmployee === 'function') {
        try {
            var handled = window.__trkRenderDayByEmployee(entries, totalHours, day);
            if (handled) return;
        } catch (e) { console.error('[day-view]', e); }
    }
    return __origRenderDayList.call(this, entries, totalHours, day);
};

/* PATCH: __lastTaskCardData — чтобы PATCH 26/29 могли вставить 
   расширенную карточку задачи. Обёртка над openTaskCardModal сохраняет
   ответ в state. */
(function() {
    var _origOpenTaskCard = openTaskCardModal;
    openTaskCardModal = function(taskId) {
        var from = $('sumDateFrom') ? $('sumDateFrom').value : '';
        var to = $('sumDateTo') ? $('sumDateTo').value : '';
        if (!from || !to) {
            var t = new Date();
            from = firstOfMonthISOFromDate(t);
            to = todayISO();
        }
        var qs = '?task=' + encodeURIComponent(taskId)
            + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
        return apiJson('/api/tracker/task/card' + qs)
            .then(function(d) {
                if (!d.success) throw new Error(d.error || 'Ошибка');
                // PATCH: сохраняем данные для PATCH 26/29
                state.__lastTaskCardData = d;
                renderTaskCardModal(d);
                if (window.__trkTaskFeedRender) { try { window.__trkTaskFeedRender(d); } catch(e){} }
                if (window.__trkRenderTaskCardEmployees) {
                    try { window.__trkRenderTaskCardEmployees(d); } catch(e){}
                }
                if (window.__trkInjectTaskSummary) {
                    setTimeout(function() {
                        try { window.__trkInjectTaskSummary(); } catch(e){}
                    }, 80);
                }
                var m = $('taskCardModal'); if (m) m.classList.add('active');
            })
            .catch(function(err) {
                if (err && (err.message || '').indexOf('cancelled') !== -1) return;
                notify('❌ ' + (err.message || 'Ошибка'), 'error');
            });
    };
    window.__trkOpenTaskCardModal = openTaskCardModal;
})();

function trkRefreshAll() {
    return loadState().then(function() {
        return trkRefreshCurrentTab();
    });
}
function trkRefreshCurrentTab() {
    var activeTab = document.querySelector('.tracker-tab.active');
    var tabId = activeTab ? activeTab.getAttribute('data-tab') : '';
    var p = Promise.resolve();
    if (tabId === 'calendar') p = loadCalendar();
    else if (tabId === 'heatmap') p = loadHeatmap();
    else if (tabId === 'summary') p = loadSummary();
    else if (tabId === 'stats') p = loadStats();
    return p;
}
window.__trkRefreshAll = trkRefreshAll;
function loadState() {
    return apiJson('/api/tracker/state').then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка загрузки');
        state.employees = d.employees || [];
        state.tasks = d.tasks || [];
        state.log = d.log || [];
        state.emoji = d.emoji || [];
        state.palette = d.palette || [];
        state.departments = d.departments || [];
        state.teams = d.teams || [];
        state.holidays = d.holidays || {};
        state.today = d.today || todayISO();
        state.allTags = d.all_tags || [];
        state.tagPresets = d.tag_presets || [];
        state.currentUser = d.current_user || null;
        if (d.status_labels) state.statusLabels = d.status_labels;
        if (d.task_status_labels) state.taskStatusLabels = d.task_status_labels;
        if (d.absence_types) state.absenceTypes = d.absence_types;
        if (d.permissions) { PERMS = d.permissions; window.REESTR_PERMS = PERMS; }
        renderDepartments();
        renderEmployees();
        renderTeams();
        renderTasks();
        renderHolidaysInline();
        renderPalette();
        renderEmojiGrid();
        fillDepartmentFilters();
        fillTeamFilters();
        fillEmployeeFilter();
        fillEmployeeSelect();
        fillTaskSelect();
        fillSummaryFilters();
        fillTagFilters();
        // PATCH 1.0.9: читаем сохранённый вид задач
        try {
            // 13.11: по умолчанию «Список»; новый ключ, чтобы старый сохранённый «tile» не перебивал
            var _tv109 = localStorage.getItem('tracker_tsk_view2');
            if (_tv109 !== 'tile') _tv109 = 'list';
            state.tskView = _tv109;
        } catch (e) { state.tskView = 'list'; }
        applyPermsToUI();
        try {
            state.tskCompactMode = (localStorage.getItem('tracker_tsk_compact') === '1');
        } catch (e) { state.tskCompactMode = false; }
    }).catch(function(err) {
        notify('❌ ' + (err.message || 'Ошибка'), 'error');
    });
}

function applyPermsToUI() {
    var map = [
        ['addEmployeeBtn', 'action.employee.create'],
        ['addDepartmentBtn', 'action.department.create'],
        ['addTeamBtn', 'action.team.create'],
        ['addTaskBtn', 'action.task.create'],
        ['addTaskBtn2', 'action.task.create'],
        ['dayAddBtn', 'action.log.create'],
        ['dayCopyPrevBtn', 'action.log.create'],
        ['dayClearBtn', 'action.log.delete.any'],
        ['trkMaskToggle', 'action.mask.use'],
    ];
    map.forEach(function(p) {
        var el = $(p[0]);
        if (el && !hasPerm(p[1])) el.style.display = 'none';
    });
}

/* ============================================================
   ОТДЕЛЫ
   ============================================================ */
function renderDepartments() {
    var list = $('departmentsList'), cnt = $('departmentsCount');
    if (!list) return;
    var deps = state.departments || [];
    if (cnt) cnt.textContent = deps.length;
    if (!deps.length) { list.innerHTML = '<div class="dict-empty">Пока нет банков</div>'; return; }
    var canEdit = hasPerm('action.department.edit');
    var canDel = hasPerm('action.department.delete');
    var html = '';
    deps.forEach(function(dep) {
        var count = (state.employees || []).filter(function(e) { return e.department_id === dep.id && !e.fired; }).length;
        var _head = dep.head_employee_id ? state.employees.find(function(e) { return e.id === dep.head_employee_id; }) : null;
        var _headTxt = _head ? '<span class="badge badge-dept">👤 ' + escName(_head.name) + '</span>' : '';
        var _hc = (dep.headcount === null || dep.headcount === undefined || dep.headcount === '') ? '–' : dep.headcount;
        html += '<div class="dict-item" data-id="' + escapeHtml(dep.id) + '">'
            + '<span class="dict-item-dot" style="background:' + escapeHtml(dep.color || '#7a9ab5') + '; box-shadow:0 0 8px ' + escapeHtml(dep.color || '#7a9ab5') + ';"></span>'
            + '<div class="dict-item-body"><div class="dict-item-name">' + escapeHtml(dep.name) + '</div>'
            + '<div class="dict-bank-counts">штатная численность: <b>' + escapeHtml(String(_hc)) + '</b>\nфактическая численность: <b>' + count + '</b></div>'
            + (_headTxt ? '<div class="dict-item-meta">' + _headTxt + '</div>' : '')
            + '</div><div class="dict-actions">'
            + (canEdit ? '<button class="dict-action-btn" data-act="edit">✏️</button>' : '')
            + (canDel ? '<button class="dict-action-btn danger" data-act="delete">🗑</button>' : '')
            + '</div></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.dict-item').forEach(function(item) {
        var id = item.getAttribute('data-id');
        var eb = item.querySelector('[data-act="edit"]');
        var db = item.querySelector('[data-act="delete"]');
        if (eb) eb.addEventListener('click', function() {
            var dep = state.departments.find(function(x) { return x.id === id; });
            if (dep) openDepartmentModal(dep);
        });
        if (db) db.addEventListener('click', function() { deleteDepartment(id); });
    });
}

/* ============================================================
   СОТРУДНИКИ
   ============================================================ */
function refreshEmployeeVacationViews(employeeId, keepCardOpen) {
    return loadState().then(function() {
        renderEmployees();
        if (keepCardOpen && employeeId) {
            var emp = (state.employees || []).find(function(x){ return x.id === employeeId; });
            if (emp) openEmployeeModal(emp, true);
        }
        if (state.currentTab === 'absence' && typeof window.__renderAbsenceTab === 'function') {
            try { window.__renderAbsenceTab(); } catch (e) { console.error(e); }
        }
    });
}
window.refreshEmployeeVacationViews = refreshEmployeeVacationViews;

function renderEmployees() {
    var list = $('employeesList'), cnt = $('employeesCount');
    if (!list) return;
    if (cnt) cnt.textContent = state.employees.length;
    if (!state.employees.length) { list.innerHTML = '<div class="dict-empty">Пока нет сотрудников</div>'; return; }
    var canEdit = hasPerm('action.employee.edit');
    var canDel = hasPerm('action.employee.delete');
    if (!window.__empDictCollapsed) window.__empDictCollapsed = {};
    var collapsed = window.__empDictCollapsed;

    // карточка одного сотрудника
    function empCard(e) {
        var color = e.color || '#00897b';
        var vac = (e.vacations || []).filter(function(v) { return (v.type||'vacation') === 'vacation'; }).length;
        var sick = (e.vacations || []).filter(function(v) { return v.type === 'sick_leave'; }).length;
        var trip = (e.vacations || []).filter(function(v) { return v.type === 'business_trip'; }).length;
        var remote = (e.vacations || []).filter(function(v) { return v.type === 'remote'; }).length;
        var other = (e.vacations || []).filter(function(v) { return v.type === 'other'; }).length;
        var badges = '';
        if (vac) badges += '<span class="badge badge-vac">🌞 ' + vac + '</span>';
        if (sick) badges += '<span class="badge badge-sick">🤒 ' + sick + '</span>';
        if (trip) badges += '<span class="badge badge-trip">✈️ ' + trip + '</span>';
        if (remote) badges += '<span class="badge badge-remote">🏠 ' + remote + '</span>';
        if (other) badges += '<span class="badge badge-other">📝 ' + other + '</span>';
        var metaArr = [];
        if (e.role) metaArr.push(escapeHtml(e.role));
        if (e.fired) metaArr.push('<span class="badge badge-fired">🚪 уволен ' + escapeHtml(e.fired_date || '') + '</span>');
        // эмодзи направления
        var dc = +e.dir_corp || 0, dr = +e.dir_retail || 0, dirEmo = '';
        if (dc > 0 && dr > 0) dirEmo = '🟣'; else if (dr > 0) dirEmo = '🔴'; else if (dc > 0) dirEmo = '🔵'; else dirEmo = '⚪';
        return '<div class="dict-item dict-emp-item' + (e.fired ? ' fired' : '') + '" data-id="' + escapeHtml(e.id) + '">'
            + '<span class="dict-item-dot" style="background:' + escapeHtml(color) + '; box-shadow:0 0 8px ' + escapeHtml(color) + ';"></span>'
            + '<div class="dict-item-body"><div class="dict-item-name">' + dirEmo + ' ' + escName(e.name) + '</div>'
            + (metaArr.length || badges ? '<div class="dict-item-meta">' + badges + metaArr.join(' ') + '</div>' : '')
            + '</div><div class="dict-actions">'
            + (canEdit ? '<button class="dict-action-btn" data-act="edit">✏️</button>' : '')
            + (canDel ? '<button class="dict-action-btn danger" data-act="delete">🗑</button>' : '')
            + '</div></div>';
    }

    // группировка по банкам
    var deps = (state.departments || []).slice();
    var byDep = {};
    deps.forEach(function(d) { byDep[d.id] = []; });
    var noDep = [];
    state.employees.forEach(function(e) {
        if (e.department_id && byDep[e.department_id]) byDep[e.department_id].push(e);
        else noDep.push(e);
    });

    var html = '';
    function groupBlock(key, title, color, emps) {
        if (!emps.length) return '';
        var isCol = !!collapsed[key];
        var caret = isCol ? '▸' : '▾';
        var dot = color ? '<span class="dict-item-dot" style="background:' + escapeHtml(color) + '; box-shadow:0 0 8px ' + escapeHtml(color) + ';"></span>' : '';
        var h = '<div class="dict-emp-group' + (isCol ? ' collapsed' : '') + '" data-gkey="' + escapeHtml(key) + '">'
            + '<div class="dict-emp-grouphead" data-gtoggle="' + escapeHtml(key) + '">'
            + '<span class="dict-emp-caret">' + caret + '</span>'
            + dot
            + '<span class="dict-emp-groupname">' + escapeHtml(title) + '</span>'
            + '<span class="dict-emp-groupcount">' + emps.length + '</span>'
            + '</div>'
            + '<div class="dict-emp-groupbody"' + (isCol ? ' style="display:none;"' : '') + '>';
        emps.forEach(function(e) { h += empCard(e); });
        h += '</div></div>';
        return h;
    }
    deps.forEach(function(d) { html += groupBlock(d.id, d.name, d.color, byDep[d.id] || []); });
    html += groupBlock('__none__', 'Без банка', '#94a3b8', noDep);
    list.innerHTML = html || '<div class="dict-empty">Пока нет сотрудников</div>';

    // тоггл сворачивания группы
    list.querySelectorAll('[data-gtoggle]').forEach(function(hd) {
        hd.addEventListener('click', function() {
            var k = hd.getAttribute('data-gtoggle');
            collapsed[k] = !collapsed[k];
            renderEmployees();
        });
    });
    // кнопки сотрудника
    list.querySelectorAll('.dict-emp-item').forEach(function(item) {
        var id = item.getAttribute('data-id');
        var eb = item.querySelector('[data-act="edit"]');
        var db = item.querySelector('[data-act="delete"]');
        item.addEventListener('click', function() {
            var emp = state.employees.find(function(x) { return x.id === id; });
            if (emp) openEmployeeModal(emp, true);
        });
        if (eb) eb.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var emp = state.employees.find(function(x) { return x.id === id; });
            if (emp) openEmployeeModal(emp);
        });
        if (db) db.addEventListener('click', function(ev) {
            ev.stopPropagation();
            deleteEmployee(id);
        });
    });
}

/* ============================================================
   КОМАНДЫ
   ============================================================ */
function renderTeams() {
    var list = $('teamsList'), cnt = $('teamsCount');
    if (!list) return;
    var teams = state.teams || [];
    if (cnt) cnt.textContent = teams.length;
    if (!teams.length) { list.innerHTML = '<div class="dict-empty">Пока нет команд</div>'; return; }
    var canEdit = hasPerm('action.team.edit');
    var canDel = hasPerm('action.team.delete');
    var html = '';
    teams.forEach(function(tm) {
        var mgr = state.employees.find(function(e) { return e.id === tm.manager_id; });
        var mgrName = mgr ? maskName(mgr.name) : '—';
        var dept = (state.departments || []).find(function(d) { return d.id === tm.department_id; });
        var deptName = dept ? dept.name : '';
        var mc = (tm.member_ids || []).length;
        html += '<div class="dict-item" data-id="' + escapeHtml(tm.id) + '">'
            + '<span class="dict-item-icon">👥</span>'
            + '<div class="dict-item-body"><div class="dict-item-name">' + escapeHtml(tm.name) + '</div>'
            + '<div class="dict-item-meta">'
            + (deptName ? '<span class="badge badge-dept">🏢 ' + escapeHtml(deptName) + '</span>' : '')
            + '<span class="badge badge-team">👤 ' + escapeHtml(mgrName) + '</span>'
            + '<span class="badge">👥 ' + mc + '</span>'
            + '</div></div><div class="dict-actions">'
            + (canEdit ? '<button class="dict-action-btn" data-act="edit">✏️</button>' : '')
            + (canDel ? '<button class="dict-action-btn danger" data-act="delete">🗑</button>' : '')
            + '</div></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.dict-item').forEach(function(item) {
        var id = item.getAttribute('data-id');
        var eb = item.querySelector('[data-act="edit"]');
        var db = item.querySelector('[data-act="delete"]');
        if (eb) eb.addEventListener('click', function() {
            var tm = state.teams.find(function(x) { return x.id === id; });
            if (tm) openTeamModal(tm);
        });
        if (db) db.addEventListener('click', function() { deleteTeam(id); });
    });
}

/* ============================================================
   ПРАЗДНИКИ INLINE
   ============================================================ */
function renderHolidaysInline() {
    var list = $('holidaysInlineList'); if (!list) return;
    var grid = $('holidaysGrid') || list;
    var hol = state.holidays || {};
    var keys = Object.keys(hol).sort().slice(0, 80);
    if (!keys.length) { grid.innerHTML = '<div class="dict-empty">Нет праздников</div>'; return; }
    var html = '';
    keys.forEach(function(k) {
        html += '<div class="dict-item">'
            + '<span class="dict-item-icon">🎉</span>'
            + '<div class="dict-item-body"><div class="dict-item-name">' + escapeHtml(hol[k]) + '</div>'
            + '<div class="dict-item-meta">' + escapeHtml(k) + '</div>'
            + '</div></div>';
    });
    grid.innerHTML = html;
}

/* ============================================================
   ЗАДАЧИ
   ============================================================ */
function _deptBadgesForTask(t) {
    var ids = t.department_ids || [];
    if (!ids.length) return '';
    var names = ids.map(function(id) {
        var d = (state.departments || []).find(function(x) { return x.id === id; });
        return d ? d.name : id;
    });
    var limit = 2;
    var shown = names.slice(0, limit).map(function(n) {
        return '<span class="badge badge-dept">🏢 ' + escapeHtml(n) + '</span>';
    }).join('');
    if (names.length > limit) {
        shown += '<span class="badge badge-dept" title="' + escapeHtml(names.join(', ')) + '">+' + (names.length - limit) + '</span>';
    }
    return shown;
}
function _tagChipsForTask(t) {
    var tags = t.tags || [];
    if (!tags.length) return '';
    return tags.slice(0, 6).map(function(tag) {
        return '<span class="task-tag-chip">#' + escapeHtml(tag) + '</span>';
    }).join('');
}
function _completionBadge(t) {
    if (!t || !t.completion_kind) return '';
    var cls = t.completion_kind;
    var label = cls === 'early' ? '✅ Досрочно' : (cls === 'late' ? '⏰ С опозданием' : '✅ В срок');
    var extra = t.completed_at ? ' · ' + escapeHtml(t.completed_at) : '';
    // PATCH v1.0.9: помечаем автозакрытие в бейдже выполнения
    var auto = t.auto_closed_at ? ' 🤖' : '';
    var autoTitle = t.auto_closed_at ? (' title="Закрыто автоматически: ' + escapeHtml(t.auto_closed_at) + '"') : '';
    return '<span class="task-completion-badge ' + cls + '"' + autoTitle + '>' + label + extra + auto + '</span>';
}
function taskCardRow(t) {
    var meta = [];
    if (t.overdue) meta.push('<span class="badge badge-danger">⚠ просрочено</span>');
    if (t.status && t.status !== 'active') {
        var lbl = state.taskStatusLabels[t.status] || t.status;
        meta.push('<span class="badge">' + escapeHtml(lbl) + '</span>');
    }
    var db = _deptBadgesForTask(t);
    if (db) meta.push(db);
    if (t.curator) meta.push('<span class="badge badge-curator">👤 ' + escapeHtml(t.curator) + '</span>');
    if (t.start_date) meta.push('🚀 ' + escapeHtml(t.start_date));
    if (t.deadline) meta.push('⏰ ' + escapeHtml(t.deadline));
    if (t.assignees && t.assignees.length) {
        var names = t.assignees.map(function(aid) {
            var e = state.employees.find(function(x) { return x.id === aid; });
            return e ? maskName(e.name) : '?';
        }).slice(0, 3);
        meta.push('👥 ' + names.map(escapeHtml).join(', ') + (t.assignees.length > 3 ? ' +' + (t.assignees.length - 3) : ''));
    }
    var tagsHtml = '';
    var compBadge = _completionBadge(t);
    var canEdit = hasPerm('action.task.edit');
    var canDel = hasPerm('action.task.delete');
    return '<div class="dict-item" data-id="' + escapeHtml(t.id) + '">'
        + window.trkQuarterBadge(t.icon, 'dict-item-icon')
        + '<div class="dict-item-body"><div class="dict-item-name' + (t.overdue ? ' overdue' : '') + '">' + escapeHtml(t.name) + '</div>'
        + (meta.length ? '<div class="dict-item-meta">' + meta.join(' · ') + '</div>' : '')
        + (tagsHtml ? '<div class="dict-item-meta" style="margin-top:3px;">' + tagsHtml + '</div>' : '')
        + (compBadge ? '<div class="dict-item-meta" style="margin-top:3px;">' + compBadge + '</div>' : '')
        + '</div><div class="dict-actions">'
        + (canEdit ? '<button class="dict-action-btn" data-act="edit" title="Редактировать">✏️</button>' : '')
        + (canDel ? '<button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button>' : '')
        + '</div></div>';
}
/* Список задач: одна строка на задачу — название, статус, банки, сроки; проблемы отдельной строкой */
/* «Карта проверок» — режим «Список»: таблица */
function _kpLastComment(folder) {
    var lines = String(folder || '').split(/\r?\n/).map(function(x) { return x.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    function key(l) { var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(l); return m ? m[3] + m[2] + m[1] : ''; }
    var best = lines[lines.length - 1], bk = key(best);
    lines.forEach(function(l) { var k = key(l); if (k && k >= bk) { best = l; bk = k; } });
    var m = /^(\d{2}\.\d{2}\.\d{4})\s*[—–-]?\s*(.*)$/.exec(best);
    return m ? { date: m[1], text: m[2] || '', n: lines.length } : { date: '', text: best, n: lines.length };
}
function trkMapTableHtml(tasks) {
    var stMap = { planning: 'Планирование', approved: 'Утверждена', active: 'Активна', done: 'Завершена', cancelled: 'Отменена' };
    var depName = function(id) { var d = (state.departments || []).find(function(x) { return x.id === id; }); return d ? d.name : (id || ''); };
    var empName = function(id) { var e = (state.employees || []).find(function(x) { return x.id === id; }); return e ? maskName(e.name) : ''; };
    var extras = {};
    (state.tasks || []).forEach(function(x) { if (x.task_kind === 'other' && x.other_subkind === 'audit_extra' && x.parent_task_id) (extras[x.parent_task_id] = extras[x.parent_task_id] || []).push(x); });
    var canDel = hasPerm('action.task.delete') && !!(state.currentUser && state.currentUser.role === 'admin');
    var h = '<table class="kp-table"><thead><tr>'
        + '<th>Проверка</th><th>Карман</th><th>Описание</th><th>Куратор ЦА</th><th>Руководитель</th><th>Участники</th><th>Статус</th><th>Срок</th><th>Комментарий</th><th>Проблемы</th>'
        + (canDel ? '<th></th>' : '') + '</tr></thead><tbody>';
    tasks.forEach(function(t) {
        var sv = t.status || 'active';
        var isOther = (t.task_kind || 'audit') === 'other';
        var lead = t.lead_department ? escapeHtml(depName(t.lead_department)) + (t.lead_employee ? ' <span class="kp-sub">→ ' + escapeHtml(empName(t.lead_employee)) + '</span>' : '') : '<span class="kp-muted">—</span>';
        var parts = (t.department_ids || []).filter(function(d) { return d !== t.lead_department; }).map(depName);
        var cur = (t.curator && t.curator !== 'нет') ? escapeHtml(t.curator) : '<span class="kp-warn">не указан</span>';
        var c = _kpLastComment(t.folder);
        var com = c ? ('<span class="kp-com-date">' + escapeHtml(c.date) + '</span> ' + escapeHtml(c.text) + (c.n > 1 ? ' <span class="kp-sub">(' + c.n + ')</span>' : '')) : '<span class="kp-muted">—</span>';
        var nm = escapeHtml(t.name || '');
        var desc = String(t.description || '').trim();
        var sub = '';
        if (isOther) {
            var par = t.parent_task_id ? (state.tasks || []).find(function(x) { return x.id === t.parent_task_id; }) : null;
            sub = '<div class="kp-sub">' + escapeHtml(TRK_OTHER_SUB[t.other_subkind] || TRK_OTHER_SUB.other) + (par ? ' · ' + escapeHtml(par.name) : '') + '</div>';
        } else if (extras[t.id]) sub = '<div class="kp-sub">🧩 доп. задач: ' + extras[t.id].length + '</div>';
        var _docs = Array.isArray(t.orders) ? t.orders.filter(function(o) { return o && (o.value || o.description); }) : [];
        if (_docs.length) sub += '<div class="kp-sub kp-docs" title="' + escapeHtml(_docs.map(function(o) { return window.trkDocTypeLabel(o) + ': ' + (o.description || o.value); }).join('\n')) + '">📄 документов: ' + _docs.length + '</div>';
        var prs = _trkTaskPeriods(t);
        var term = prs.length > 1
            ? prs.map(function(p) { return formatDateShort(p.start) + '–' + formatDateShort(p.end); }).join(' + ')
            : (t.start_date ? formatDateShort(t.start_date) : '') + (t.start_date && t.deadline ? ' → ' : '') + (t.deadline ? formatDateShort(t.deadline) : '');
        var probs = window.trkTaskProblemsBadge ? window.trkTaskProblemsBadge(t, { soft: true }) : '';
        h += '<tr class="dict-item kp-row st-' + escapeHtml(sv) + (t.overdue ? ' kp-row--overdue' : '') + '" data-id="' + escapeHtml(t.id) + '">'
            + '<td class="kp-name"><span class="dict-item-name">' + nm + '</span>' + sub + '</td>'
            + '<td class="kp-pocket">' + _trkPocketBadge(t) + '</td>'
            + '<td class="kp-desc"' + (desc ? ' title="' + escapeHtml(desc) + '"' : '') + '>' + (desc ? '<div class="kp-desc-txt">' + escapeHtml(desc) + '</div>' : '<span class="kp-muted">—</span>') + '</td>'
            + '<td class="kp-cur">' + cur + '</td><td>' + lead + '</td>'
            + '<td>' + (parts.length ? escapeHtml(parts.join(', ')) : '<span class="kp-muted">—</span>') + '</td>'
            + '<td><span class="task-card-badge status-' + escapeHtml(sv) + '">' + escapeHtml(stMap[sv] || sv) + '</span></td>'
            + '<td class="kp-term' + (t.overdue ? ' tsk-row-overdue' : '') + '">' + escapeHtml(term || '—') + '</td>'
            + '<td class="kp-com">' + com + '</td>'
            + '<td class="kp-probs">' + (probs || '') + '</td>'
            + (canDel ? '<td class="dict-actions"><button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button></td>' : '')
            + '</tr>';
    });
    return h + '</tbody></table>';
}
function _trkPocketBadge(t, opts) {
    opts = opts || {};
    if (!t) return '';
    var p = String(t.pocket || '').trim();
    var dir = t.task_type || '';
    var cls = dir === '\u043a\u043e\u0440\u043f\u043e\u0440\u0430\u0442\u0438\u0432\u043d\u0430\u044f' ? 'corp'
            : (dir === '\u0440\u043e\u0437\u043d\u0438\u0447\u043d\u0430\u044f' ? 'retail' : '');
    var icon = cls === 'corp' ? '\ud83c\udfe2' : (cls === 'retail' ? '\ud83d\udc65' : '');
    if (!p) {
        if (opts.hideEmpty) return '';
        return '<span class="task-card-pocket none" title="\u0412\u043d\u0435 \u043a\u0430\u0440\u043c\u0430\u043d\u0430">\u2014 \u0432\u043d\u0435 \u043a\u0430\u0440\u043c\u0430\u043d\u0430</span>';
    }
    var known = false;
    try {
        var list = window.__trkPocketList || (state && state.pockets) || [];
        known = list.some(function(x) { return x && x.name === p && (!dir || x.direction === dir) && x.is_active !== false; });
    } catch (e) {}
    var warn = known ? '' : ' data-pk-warn="1"';
    var ttl = '\u041a\u0430\u0440\u043c\u0430\u043d' + (dir ? ' \u00b7 ' + dir : '') + (known ? '' : ' (\u043d\u0435\u0442 \u0432 \u0441\u043f\u0440\u0430\u0432\u043e\u0447\u043d\u0438\u043a\u0435)');
    return '<span class="task-card-pocket ' + cls + '"' + warn + ' title="' + escapeHtml(ttl) + '">' + (icon ? icon + ' ' : '') + escapeHtml(p) + '</span>';
}
window._trkPocketBadge = _trkPocketBadge;
function taskRowMin(t) {
    var stMap = { planning: 'Планирование', approved: 'Утверждена', active: 'Активна', done: 'Завершена', cancelled: 'Отменена' };
    var sv = t.status || 'active';
    var slbl = (state.taskStatusLabels && state.taskStatusLabels[sv]) || stMap[sv] || sv;
    var meta = ['<span class="task-card-badge status-' + escapeHtml(sv) + '">' + escapeHtml(slbl) + '</span>'];
    var banks = _deptBadgesForTask(t);
    if (!banks && t.assignees && t.assignees.length) {
        var names = t.assignees.map(function(aid) {
            var e = (state.employees || []).find(function(x) { return x.id === aid; });
            return e ? maskName(e.name) : '?';
        });
        banks = '<span title="' + escapeHtml(names.join(', ')) + '">👥 '
            + escapeHtml(names.slice(0, 3).join(', ')) + (names.length > 3 ? ' +' + (names.length - 3) : '') + '</span>';
    }
    var _curOk = !!(t.curator && t.curator !== 'нет');
    meta.push('<span class="tsk-row-cur' + (_curOk ? '' : ' tsk-row-cur--none') + '" title="Куратор ЦА: ' + escapeHtml(_curOk ? t.curator : 'не указан') + '">👤 ' + escapeHtml(_curOk ? t.curator : 'не указан') + '</span>');
    if (banks) meta.push('<span class="tsk-row-banks">' + banks + '</span>');
    if (t.start_date || t.deadline) {
        meta.push('<span class="tsk-row-dates">'
            + (t.start_date ? '🚀 ' + escapeHtml(formatDateShort(t.start_date)) : '')
            + (t.start_date && t.deadline ? ' → ' : '')
            + (t.deadline ? '<span class="' + (t.overdue ? 'tsk-row-overdue' : '') + '">⏰ ' + escapeHtml(formatDateShort(t.deadline)) + '</span>' : '')
            + '</span>');
    }
    var probs = window.trkTaskProblemsBadge(t, { soft: true });
    var canDel = hasPerm('action.task.delete');
    return '<div class="dict-item tsk-row st-' + escapeHtml(sv) + (t.overdue ? ' tsk-row--overdue' : '') + (probs ? ' tsk-row--prob' : '') + '" data-id="' + escapeHtml(t.id) + '">'
        + '<div class="dict-item-body">'
        +   '<div class="tsk-row-line">'
        +     '<span class="dict-item-name tsk-row-name' + (t.overdue ? ' overdue' : '') + '" title="' + escapeHtml(t.name || '') + '">' + escapeHtml(t.name || '') + '</span>'
        +     '<span class="dict-item-meta tsk-row-meta">' + meta.join('<span class="tsk-row-sep"> · </span>') + '</span>'
        +   '</div>'
        +   probs
        + '</div>'
        + '<div class="dict-actions">'
        +   (canDel ? '<button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button>' : '')
        + '</div></div>';
}
/* PATCH v1.0.10: K/N по задаче — сколько исполнителей уже закрыли */
var _lastDoneCacheClient = null;
var _lastDoneCacheClientSrc = null;
function _buildLastDoneMapClient() {
    var m = {};
    var logs = (state && state.log) || [];
    for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        if (!l || l.status !== 'done') continue;
        var eid = l.employee_id;
        var tid = l.task_id;
        var d = l.date || '';
        if (!eid || !tid || !d) continue;
        var k = tid + '|' + eid;
        if (!m[k] || d > m[k]) m[k] = d;
    }
    return m;
}
function _taskProgressClient(t) {
    if (!t || !t.id) return null;
    var ids = t.assignees || [];
    if (!ids.length) return null;
    var src = (state && state.log) || null;
    if (_lastDoneCacheClient === null || _lastDoneCacheClientSrc !== src) {
        _lastDoneCacheClient = _buildLastDoneMapClient();
        _lastDoneCacheClientSrc = src;
    }
    var closed = 0;
    for (var i = 0; i < ids.length; i++) {
        if (_lastDoneCacheClient[t.id + '|' + ids[i]]) closed++;
    }
    return { total: ids.length, closed: closed, pct: Math.round(100 * closed / ids.length) };
}

function taskCardRowGrid(t) {
    var canEdit = hasPerm('action.task.edit');
    var canDel = hasPerm('action.task.delete');
    var today = state.today || todayISO();

    function daysBetween(a, b) {
        try {
            var d1 = new Date(a + 'T00:00:00');
            var d2 = new Date(b + 'T00:00:00');
            return Math.round((d2 - d1) / 86400000);
        } catch (err) { return null; }
    }
    function pluralDays(n) {
        n = Math.abs(n);
        var l2 = n % 100;
        var l1 = n % 10;
        if (l2 >= 11 && l2 <= 14) return n + ' дней';
        if (l1 === 1) return n + ' день';
        if (l1 >= 2 && l1 <= 4) return n + ' дня';
        return n + ' дней';
    }
    function countdown() {
        var dl = t.deadline;
        var st = t.start_date;
        if (t.status === 'done' || t.status === 'archived') {
            if (t.completed_at) return { text: '✅ завершено ' + formatDateShort(t.completed_at), kind: 'ok' };
            return { text: '✅ завершено', kind: 'ok' };
        }
        if (dl) {
            var d = daysBetween(today, dl);
            if (d === null) return null;
            if (d < 0) return { text: '⚠ просрочено ' + pluralDays(-d), kind: 'danger' };
            if (d === 0) return { text: '🔥 сегодня', kind: 'warn' };
            if (d === 1) return { text: '⏰ завтра', kind: 'warn' };
            if (d <= 3) return { text: '⏰ ' + pluralDays(d), kind: 'warn' };
            return { text: 'осталось ' + pluralDays(d), kind: 'neutral' };
        }
        if (st) {
            var s = daysBetween(today, st);
            if (s !== null && s > 0) return { text: '🚀 старт ' + formatDateShort(st), kind: 'neutral' };
        }
        return null;
    }
    function progress() {
        if (!t.start_date || !t.deadline) return null;
        try {
            var s = new Date(t.start_date + 'T00:00:00');
            var e = new Date(t.deadline + 'T00:00:00');
            var n = new Date(today + 'T00:00:00');
            var total = (e - s) / 86400000;
            if (total <= 0) return 100;
            var elapsed = (n - s) / 86400000;
            return Math.round(Math.max(0, Math.min(100, (elapsed / total) * 100)));
        } catch (err) { return null; }
    }

    var statusKey = t.status || 'active';
    var cardCls = 'task-card st-' + statusKey;
    if (t.overdue) cardCls += ' overdue';
    // PATCH v1.0.18: розовая подсветка «очень срочных»
    if (t.is_urgent) cardCls += ' task-card--urgent';

    // PATCH v1.0.9: помечаем задачи, закрытые автоматически (🤖 + tooltip)
    var _autoClosed = !!(t.auto_closed_at);
    var _autoSuffix = _autoClosed ? ' 🤖' : '';
    var _autoTitle = _autoClosed ? (' title="Закрыто автоматически: ' + escapeHtml(t.auto_closed_at) + '"') : '';

    // PATCH v1.0.10: K/N — сколько исполнителей закрыли задачу (виден, если их больше одного)
    var _prog = _taskProgressClient(t);
    var _progSuffix = (_prog && _prog.total > 1 && _prog.closed > 0)
        ? ' · ' + _prog.closed + '/' + _prog.total
        : '';
    var _progTitle = (_prog && _prog.total > 1)
        ? (' title="Закрыли ' + _prog.closed + ' из ' + _prog.total + ' исполнителей"')
        : '';

    var _urgBadge = t.is_urgent ? '<span class="task-card-badge urgent">🚨 Срочно</span>' : '';
    var _stMap = {
        planning: 'Планирование',
        approved: 'Утверждена',
        active: 'Активна',
        done: 'Завершена',
        cancelled: 'Отменена'
    };
    var _stVal = t.status || 'active';
    var slbl = (state.taskStatusLabels && state.taskStatusLabels[_stVal]) || _stMap[_stVal] || _stVal;
    var _cls = 'task-card-badge status-' + escapeHtml(_stVal) + (_autoClosed ? ' auto-closed' : '');
    var statusBadge = '<span class="' + _cls + '"' + _autoTitle + _progTitle + '>' + escapeHtml(slbl) + _autoSuffix + _progSuffix + '</span>';
    if (t.overdue && _stVal !== 'done' && _stVal !== 'cancelled') {
        statusBadge = '<span class="task-card-badge overdue"' + _autoTitle + _progTitle + '>⚠ Просрочено</span>' + statusBadge;
    }
    if (_urgBadge) statusBadge += _urgBadge;

    var deptBadges = _deptBadgesForTask(t);
    var _pkHtml = _trkPocketBadge(t, { hideEmpty: true });
    var _curOk = !!(t.curator && t.curator !== 'нет');
    var _curTxt = _curOk ? t.curator : 'не указан';
    var curatorHtml = '<div class="task-card-curator' + (_curOk ? '' : ' task-card-curator--none') + '" title="Куратор ЦА: ' + escapeHtml(_curTxt) + '">👤 ' + escapeHtml(_curTxt) + '</div>';

    var pct = progress();
    var progressHtml = '';
    if (pct !== null) {
        var pcls = 'ok';
        if (t.overdue) pcls = 'danger';
        else if (pct >= 70) pcls = 'warn';
        progressHtml = '<div class="task-card-progress" title="Пройдено ' + pct + '% срока">'
            + '<div class="task-card-progress-fill ' + pcls + '" style="width:' + pct + '%"></div>'
            + '</div>';
    }

    var datesHtml = '';
    if (t.start_date || t.deadline) {
        datesHtml = '<div class="task-card-dates">';
        if (t.start_date) datesHtml += '<span class="date-chip">🚀 ' + escapeHtml(formatDateShort(t.start_date)) + '</span>';
        if (t.start_date && t.deadline) datesHtml += '<span class="date-chip-arrow">→</span>';
        if (t.deadline) datesHtml += '<span class="date-chip' + (t.overdue ? ' overdue' : '') + '">⏰ ' + escapeHtml(formatDateShort(t.deadline)) + '</span>';
        datesHtml += '</div>';
    }

    var cd = countdown();
    var cdHtml = cd ? '<span class="task-card-countdown ' + cd.kind + '">' + escapeHtml(cd.text) + '</span>' : '';

    var tagsHtml = '';

    var assigneesHtml = '';
    if (!(t.department_ids || []).length && t.assignees && t.assignees.length) {
        var allNames = t.assignees.map(function(aid) {
            var e = state.employees.find(function(x) { return x.id === aid; });
            return e ? e.name : '?';
        });
        assigneesHtml = '<div class="task-card-assignees" title="' + escapeHtml(allNames.join(', ')) + '">';
        t.assignees.slice(0, 4).forEach(function(aid) {
            var e = state.employees.find(function(x) { return x.id === aid; });
            if (!e) return;
            var color = e.color || '#888';
            assigneesHtml += '<span class="assignee-dot" '
                + 'style="background:' + escapeHtml(color) + ';" '
                + 'title="' + escapeHtml(maskName(e.name)) + '">'
                + escapeHtml(initials(e.name)) + '</span>';
        });
        if (t.assignees.length > 4) {
            assigneesHtml += '<span class="assignee-dot more">+' + (t.assignees.length - 4) + '</span>';
        }
        assigneesHtml += '</div>';
    }

    var actionsHtml = '<div class="task-card-actions">'
        + (canDel ? '<button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button>' : '')
        + '</div>';

    return '<div class="' + cardCls + '" data-id="' + escapeHtml(t.id) + '">'
        + '<div class="task-card-accent"></div>'
        + '<div class="task-card-head">'
        +   '<div class="task-card-icon-wrap">' + window.trkQuarterBadge(t.icon, 'task-card-icon') + '</div>'
        +   '<div class="task-card-titles' + (_pkHtml ? ' task-card-titles--pocket' : '') + '">'
        +     _pkHtml
        +     '<div class="task-card-title' + (t.overdue ? ' overdue' : '') + '">' + escapeHtml(t.name) + '</div>'
        +     (deptBadges ? '<div class="task-card-sub">' + deptBadges + '</div>' : '')
        +     curatorHtml
        +   '</div>'
        +   '<div class="task-card-topright">'
        +     (statusBadge || '')
        +   '</div>'
        + '</div>'
        + window.trkTaskProblemsBadge(t, { max: 2 })
        + progressHtml
        + '<div class="task-card-mid">'
        +   (datesHtml || '<div class="task-card-dates"></div>')
        +   (cdHtml || '')
        + '</div>'
        + '<div class="task-card-foot">'
        +   (tagsHtml || '<div class="task-card-tags"></div>')
        +   (assigneesHtml || '')
        +   actionsHtml
        + '</div>'
        + '</div>';
}

function bindTaskCardActions(container, sel) {
    container.querySelectorAll(sel || '.dict-item').forEach(function(item) {
        var id = item.getAttribute('data-id');
        if (!id) return;
        var editBtn = item.querySelector('[data-act="edit"]');
        var delBtn = item.querySelector('[data-act="delete"]');
        if (editBtn) editBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var t = state.tasks.find(function(x) { return x.id === id; });
            if (t) trkOpenTaskSmart(t);
        });
        if (delBtn) delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            deleteTask(id);
        });
        var canEdit = true; /* просмотр — всем, правка внутри карточки только админу */
        var noAssignees = !((state.tasks.find(function(x) { return x.id === id; }) || {}).assignees || []).length;
        if (noAssignees) item.classList.add('task-card--no-assignees');
        if (canEdit) {
            item.classList.add('task-card-clickable');
            item.addEventListener('click', function(e) {
                if (e.target.closest('.dict-action-btn')) return;
                if (e.target.closest('a')) return;
                var t = state.tasks.find(function(x) { return x.id === id; });
                if (t) trkOpenTaskSmart(t);
            });
        }
    });
}
function _taskMatchesDept(t, deptId) {
    if (!deptId) return true;
    var ids = t.department_ids || [];
    if (ids.indexOf(deptId) !== -1) return true;
    if (!ids.length) {
        var deps = (t.assignees || []).map(function(aid) {
            var e = state.employees.find(function(x) { return x.id === aid; });
            return e ? e.department_id : '';
        });
        return deps.indexOf(deptId) !== -1;
    }
    return false;
}
function _teamEmpIds(teamId) {
    if (!teamId) return null;
    var tm = (state.teams || []).find(function(x) { return x.id === teamId; });
    if (!tm) return new Set();
    var s = new Set();
    if (tm.manager_id) s.add(tm.manager_id);
    (tm.member_ids || []).forEach(function(m) { if (m) s.add(m); });
    return s;
}
function _taskMatchesTeam(t, teamId) {
    if (!teamId) return true;
    var ids = _teamEmpIds(teamId);
    if (!ids) return true;
    return (t.assignees || []).some(function(a) { return ids.has(a); });
}
function renderTasks() {
    var list = $('tasksList'), cnt = $('tasksCount');
    var archList = $('tasksArchivedList'), archCnt = $('tasksArchivedCount');
    if (!list) {
        // PATCH 1.0.10: задач в справочниках больше нет — плитку всё равно перерисуем
        try { renderTasksFull(); if (typeof renderCompletedFull === 'function') renderCompletedFull(); } catch (e) { console.error('[renderTasks]', e); }
        return;
    }
    var active = [], archived = [];
    state.tasks.forEach(function(t) {
        if (t.status === 'archived' || t.status === 'done') archived.push(t);
        else active.push(t);
    });
    if (cnt) cnt.textContent = active.length;
    if (archCnt) archCnt.textContent = archived.length;

    function fill(el, arr, emptyMsg) {
        if (!el) return;
        if (!arr.length) { el.innerHTML = '<div class="dict-empty">' + emptyMsg + '</div>'; return; }
        var html = '';
        arr.forEach(function(t) { html += taskCardRow(t); });
        el.innerHTML = html;
        bindTaskCardActions(el, '.dict-item');
    }
    fill(list, active, 'Пока нет активных задач');
    fill(archList, archived, 'Пока нет архива');
    renderTasksFull();
}
function _highlightInCard(card, query) {
    if (!card) return;
    var nameEl = card.querySelector('.task-card-title');
    if (!nameEl) return;
    if (!card._origTitleHtml) card._origTitleHtml = nameEl.innerHTML;
    if (!query) {
        if (nameEl.innerHTML !== card._origTitleHtml) nameEl.innerHTML = card._origTitleHtml;
        return;
    }
    var txt = nameEl.textContent || '';
    var rx = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    var out = txt.replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    }).replace(rx, '<mark>$1</mark>');
    if (nameEl.innerHTML !== out) nameEl.innerHTML = out;
}

function _tskDirMark() {
    var seg = document.getElementById('tskDirSeg'); if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('button[data-v]'), function(b) {
        var on = b.getAttribute('data-v') === (state.tskDir || '');
        b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}
function renderTasksFull() {
    var list = $('tasksFullList'); if (!list) return;
    // PATCH v1.0.12: восстанавливаем колонки из localStorage до рендера
    try {
        var _savedCols = parseInt(localStorage.getItem('tracker_tsk_cols'), 10);
        if (_savedCols >= 1 && _savedCols <= 5) state.tskGridCols = _savedCols;
    } catch (e) {}
    var dept = $('tskDeptFilter') ? ($('tskDeptFilter').value || '') : '';
    var curator = $('tskCuratorFilter') ? ($('tskCuratorFilter').value || '') : '';
    var sort = $('tskSortSelect') ? ($('tskSortSelect').value || 'deadline_asc') : 'deadline_asc';
    var mode = state.tskViewMode || 'all';

    var tasks = state.tasks.slice();
    if (dept) tasks = tasks.filter(function(t) { return _taskMatchesDept(t, dept); });
    if (curator) {
        tasks = tasks.filter(function(t) {
            var tc = (t.curator || 'нет');
            return tc === curator;
        });
    }

    // Направление (розница / корпоратив), выбор хранится в браузере
    if (state.tskDir == null) { try { state.tskDir = localStorage.getItem('tracker_tsk_dir') || ''; } catch (e) { state.tskDir = ''; } }
    if (state.tskDir) tasks = tasks.filter(function(t) { return (t.task_type || '') === state.tskDir; });
    _tskDirMark();

    // 13.11: фильтр «Карман» — варианты из проверок выбранного направления
    var _pf = $('tskPocketFilter'), pocket = _pf ? (_pf.value || '') : '';
    if (_pf) {
        var _pSeen = {}, _pOpts = [];
        (state.tasks || []).forEach(function(t) {
            if (state.tskDir && (t.task_type || '') !== state.tskDir) return;
            var p = String(t.pocket || '').trim();
            if (p && !_pSeen[p]) { _pSeen[p] = 1; _pOpts.push(p); }
        });
        _pOpts.sort(function(a, b) { return a.toLowerCase().localeCompare(b.toLowerCase(), 'ru'); });
        if (pocket && pocket !== '__none__' && !_pSeen[pocket]) _pOpts.unshift(pocket);
        var _pKey = _pOpts.join('\u0001');
        if (_pf._optsKey !== _pKey) {
            _pf._optsKey = _pKey;
            var _ph = '<option value="">Карман</option>';
            _pOpts.forEach(function(p) { _ph += '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>'; });
            _ph += '<option value="__none__">— без кармана</option>';
            _pf.innerHTML = _ph;
            _pf.value = pocket;
        }
    }
    if (pocket === '__none__') tasks = tasks.filter(function(t) { return !String(t.pocket || '').trim(); });
    else if (pocket) tasks = tasks.filter(function(t) { return String(t.pocket || '').trim() === pocket; });

    if (mode === 'planning') tasks = tasks.filter(function(t) { return t.status === 'planning'; });
    else if (mode === 'approved') tasks = tasks.filter(function(t) { return t.status === 'approved'; });
    else if (mode === 'active') tasks = tasks.filter(function(t) { return t.status === 'active'; });
    else if (mode === 'done') tasks = tasks.filter(function(t) { return t.status === 'done'; });
    else if (mode === 'cancelled') tasks = tasks.filter(function(t) { return t.status === 'cancelled'; });
    else if (mode === 'attention') {
        var _ac = (typeof window.__trkAttentionCount === 'function') ? window.__trkAttentionCount() : { byId: {} };
        tasks = tasks.filter(function(t) { return !!_ac.byId[t.id]; });
    }

    function statusRank(t) {
        if (t.status === 'cancelled') return 5;
        if (t.status === 'done') return 4;
        if (t.status === 'planning') return 3;
        if (t.status === 'approved') return 2;
        return 1;
    }
    tasks.sort(function(a, b) {
        switch (sort) {
            case 'deadline_asc':  return (a.deadline || '9999').localeCompare(b.deadline || '9999');
            case 'deadline_desc': return (b.deadline || '').localeCompare(a.deadline || '');
            case 'created_desc':  return (b.created_at || '').localeCompare(a.created_at || '');
            case 'created_asc':   return (a.created_at || '').localeCompare(b.created_at || '');
            case 'name_asc':      return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
            case 'name_desc':     return (b.name || '').toLowerCase().localeCompare((a.name || '').toLowerCase());
            case 'status':        return statusRank(a) - statusRank(b);
            case 'overdue_first':
                if (a.overdue && !b.overdue) return -1;
                if (!a.overdue && b.overdue) return 1;
                return (a.deadline || '').localeCompare(b.deadline || '');
        }
        return 0;
    });

    if (!tasks.length) { list.innerHTML = '<div class="dict-empty trk-empty">Нет проверок по фильтру · <a href="#" class="trk-empty-reset">сбросить фильтры</a></div>'; return; }
    var html = '';
    tasks.forEach(function(t) { html += taskCardRowGrid(t); });
    // PATCH 1.0.9: три режима — плитка / компактно / список
    var _view = state.tskView || 'list';
    var _cols = parseInt(state.tskGridCols, 10) || 3;
    if (_cols < 1) _cols = 1;
    if (_cols > 5) _cols = 5;

    if (_view === 'list') {
        // Список: dict-item как на Справочниках, но в N колонках
        var _listHtml = trkMapTableHtml(tasks);
        list.className = 'dict-list tasks-list-view kp-wrap';
        list.removeAttribute('data-cols');
        list.removeAttribute('data-auto-cols');
        list.style.removeProperty('grid-template-columns');
        list.removeAttribute('data-compact');
        list.removeAttribute('data-view');
        list.style.maxHeight = 'none';
        list.style.display = 'block';
        list.innerHTML = _listHtml;
        bindTaskCardActions(list, '.dict-item');
        try {
            var _sInpL = $('tskSearchInput');
            if (_sInpL && (_sInpL.value || '').trim()) {
                var _qL = _sInpL.value.trim();
                list.querySelectorAll('.dict-item').forEach(function(card) {
                    var nameEl = card.querySelector('.dict-item-name');
                    if (!nameEl) return;
                    if (!card._origTitleHtml) card._origTitleHtml = nameEl.innerHTML;
                    var txt = nameEl.textContent || '';
                    var rx = new RegExp('(' + _qL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
                    var out = txt.replace(/[&<>"']/g, function(c) {
                        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
                    }).replace(rx, '<mark>$1</mark>');
                    if (nameEl.innerHTML !== out) nameEl.innerHTML = out;
                });
            }
        } catch (e) { console.error('[list-highlight]', e); }
        return;
    }

    list.className = 'tasks-grid tsk-auto-cols';
    list.removeAttribute('data-cols');
    list.style.maxHeight = 'none';
    list.style.display = 'grid';
    // PATCH v1.0.12: компактный режим (data-compact=1)
    list.setAttribute('data-compact', '1');
    list.innerHTML = html;
    window.trkApplyAutoCols(list);
    bindTaskCardActions(list, '.task-card');
    // PATCH v1.0.12: если поиск активен — сразу подсветить совпадения
    try {
        var _sInp = $('tskSearchInput');
        if (_sInp && (_sInp.value || '').trim()) {
            var _q = _sInp.value.trim();
            list.querySelectorAll('.task-card').forEach(function(card) {
                _highlightInCard(card, _q);
            });
        }
    } catch (e) { console.error('[highlight]', e); }
}

function renderCompletedFull() {
    /* Вкладка в разработке: только список завершённых проверок и дата завершения */
    var list = $('completedFullList'); if (!list) return;
    var tasks = (state.tasks || []).filter(function(t) { return t.status === 'done'; });
    tasks.sort(function(a, b) {
        var da = a.completed_at || '', db = b.completed_at || '';
        if (da !== db) return da < db ? 1 : -1;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });
    if (!tasks.length) { list.innerHTML = '<div class="dict-empty">Завершённых проверок нет</div>'; return; }
    /* Баллы по банкам — ДЕМО: псевдослучайное 1–5, стабильное для пары (проверка, банк). Логики нет. */
    function demoScore(tid, bid) {
        var s = String(tid) + '|' + String(bid), h = 2166136261;
        for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        return 1 + ((h >>> 0) % 5);
    }
    var deps = state.departments || [];
    var depName = function(id) { var x = deps.find(function(d) { return d.id === id; }); return x ? x.name : id; };
    var used = {};
    tasks.forEach(function(t) { (t.department_ids || []).forEach(function(b) { if (b) used[b] = true; }); });
    var banks = Object.keys(used).sort(function(a, b) { return String(depName(a)).localeCompare(String(depName(b)), 'ru'); });
    var html = '<table class="cmp-table"><thead><tr><th class="cmp-th-name">Проверка</th><th class="cmp-th-date">Завершена</th>';
    banks.forEach(function(b) { html += '<th class="cmp-th-bank" title="' + escapeHtml(depName(b)) + '">' + escapeHtml(depName(b)) + '</th>'; });
    html += '</tr></thead><tbody>';
    tasks.forEach(function(t) {
        var d = t.completed_at ? String(t.completed_at).slice(0, 10).split('-').reverse().join('.') : '—';
        var tb = t.department_ids || [];
        html += '<tr><td class="cmp-td-name" title="' + escapeHtml(t.name || '') + '">' + escapeHtml(t.name || '') + '</td>'
            + '<td class="cmp-td-date">' + escapeHtml(d) + '</td>';
        banks.forEach(function(b) {
            if (tb.indexOf(b) < 0) { html += '<td class="cmp-td-sc cmp-sc-none">·</td>'; return; }
            var sc = demoScore(t.id, b), lead = (t.lead_department === b);
            html += '<td class="cmp-td-sc"><span class="cmp-sc cmp-sc-' + sc + '" title="Демо-балл' + (lead ? ' · банк-руководитель' : '') + '">' + sc + (lead ? '<sup>👑</sup>' : '') + '</span></td>';
        });
        html += '</tr>';
    });
    html += '</tbody></table><div class="cmp-demo-hint">Баллы 1–5 — демонстрационные (случайные), для наглядности. Логика выставления баллов появится позже.</div>';
    list.innerHTML = html;
}
window.renderCompletedFull = renderCompletedFull;

/* ============================================================
   ЭМОДЗИ / ПАЛИТРА
   ============================================================ */
function renderEmojiGrid() {
    var grid = $('emojiGrid'); if (!grid) return;
    var list = state.emoji.length ? state.emoji :
        ['🚀','📋','💼','📊','🎯','💡','📁','📌','🔖','📅','👥','💻'];
    grid.innerHTML = list.map(function(e) {
        return '<button type="button" class="emoji-btn" data-emoji="' + escapeHtml(e) + '">' + e + '</button>';
    }).join('');
    grid.querySelectorAll('.emoji-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var em = this.getAttribute('data-emoji') || '🚀';
            var ti = $('task_icon'); if (ti) ti.value = em;
            var prev = $('taskIconPreview'); if (prev) prev.textContent = em;
            var m = $('emojiModal'); if (m) m.classList.remove('active');
        });
    });
}
function renderPalette() {
    var wrap = $('empPalette'); if (!wrap) return;
    var colors = state.palette.length ? state.palette :
        ['#00897b','#ef6c00','#c62828','#0277bd','#2e7d32','#6d4c41'];
    wrap.innerHTML = colors.map(function(c) {
        return '<span class="palette-dot" style="background:' + c + ';" data-color="' + c + '" title="' + c + '"></span>';
    }).join('');
    wrap.querySelectorAll('.palette-dot').forEach(function(dot) {
        dot.addEventListener('click', function() {
            var c = this.getAttribute('data-color');
            var inp = $('emp_color'); if (inp) inp.value = c;
            wrap.querySelectorAll('.palette-dot').forEach(function(d) { d.classList.remove('active'); });
            this.classList.add('active');
        });
    });
}

/* ============================================================
   ФИЛЬТРЫ
   ============================================================ */
function fillDepartmentFilters() {
    // PATCH v1.0.12: сортировка по имени
    var deps = (state.departments || []).slice().sort(function(a, b) {
        return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase(), 'ru');
    });
    ['calDeptFilter','hmDeptFilter','sumDeptFilter','stDeptFilter','tskDeptFilter'].forEach(function(elId) {
        var sel = $(elId); if (!sel) return;
        var cur = sel.value;
        var defLbl = (elId === 'tskDeptFilter' || elId === 'cmpDeptFilter') ? 'Банки' : 'Отделы';
        sel.innerHTML = '<option value="">' + defLbl + '</option>'
            + deps.map(function(d) {
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
            }).join('');
        sel.value = cur;
    });
    var cal = $('calDeptFilter');
    if (cal && state.currentDepartment) cal.value = state.currentDepartment;
    if (typeof renderHmDeptPills === 'function') renderHmDeptPills();
}
function fillTeamFilters() {
    // PATCH v1.0.12: сортировка команд по имени
    var teams = (state.teams || []).slice().sort(function(a, b) {
        return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase(), 'ru');
    });
    ['calTeamFilter','hmTeamFilter','sumTeamFilter','stTeamFilter','tskTeamFilter'].forEach(function(elId) {
        var sel = $(elId); if (!sel) return;
        var cur = sel.value;
        sel.innerHTML = '<option value="">Команды</option>'
            + teams.map(function(t) {
                return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + '</option>';
            }).join('');
        sel.value = cur;
    });
    var cal = $('calTeamFilter');
    if (cal && state.currentTeam) cal.value = state.currentTeam;
}
(function(){
    try {
        var _saved = JSON.parse(localStorage.getItem('trk_hm_depts') || 'null');
        if (Array.isArray(_saved)) window.__trkHmDepts = _saved.filter(function(x) { return !!x; });
        else window.__trkHmDepts = window.__trkHmDepts || [];
    } catch (e) { window.__trkHmDepts = window.__trkHmDepts || []; }
})();
function _saveHmDepts() {
    try { localStorage.setItem('trk_hm_depts', JSON.stringify(window.__trkHmDepts || [])); } catch (e) {}
}
function renderHmDeptPills() {
    var wrap = $('hmDeptPills');
    if (!wrap) return;
    var deps = (state.departments || []).slice().sort(function(a, b) {
        return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase(), 'ru');
    });
    var validIds = {};
    deps.forEach(function(d) { validIds[d.id] = true; });
    var cur = (window.__trkHmDepts || []).filter(function(x) { return validIds[x]; });
    window.__trkHmDepts = cur;
    if (!deps.length) { wrap.innerHTML = '<span style="color:var(--trk-meta);font-size:0.72rem;">Нет отделов</span>'; return; }
    var html = '';
    deps.forEach(function(d) {
        var act = cur.indexOf(d.id) !== -1 ? ' active' : '';
        html += '<button type="button" class="tag-chip' + act + '" data-dept-id="' + escapeHtml(d.id) + '" title="' + escapeHtml(d.name) + '">' + escapeHtml(d.name) + '</button>';
    });
    if (cur.length) html += '<button type="button" class="tag-clear" title="Очистить">✕</button>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.tag-chip').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = this.getAttribute('data-dept-id');
            var arr = window.__trkHmDepts = window.__trkHmDepts || [];
            var i = arr.indexOf(id);
            if (i === -1) arr.push(id); else arr.splice(i, 1);
            _saveHmDepts();
            renderHmDeptPills();
            loadHeatmap();
        });
    });
    var clr = wrap.querySelector('.tag-clear');
    if (clr) clr.addEventListener('click', function(e) {
        e.stopPropagation();
        window.__trkHmDepts = [];
        _saveHmDepts();
        renderHmDeptPills();
        loadHeatmap();
    });
}

function fillEmployeeFilter() {
    var sel = $('calEmployeeFilter'); if (!sel) return;
    var cur = sel.value;
    var deptId = state.currentDepartment || '';
    var teamId = state.currentTeam || '';
    var teamIds = _teamEmpIds(teamId);
    var emps = state.employees;
    if (deptId) emps = emps.filter(function(e) { return e.department_id === deptId; });
    if (teamIds) emps = emps.filter(function(e) { return teamIds.has(e.id); });
    sel.innerHTML = '<option value="">Сотрудники</option>'
        + emps.map(function(e) {
            var name = maskName(e.name) + (e.fired ? ' 🚪' : '');
            return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(name) + '</option>';
        }).join('');
    sel.value = cur || state.currentEmployee || '';
}
function fillEmployeeSelect() {
    var sel = $('log_employee'); if (!sel) return;
    // PATCH v1.0.12: сортировка по ФИО
    var emps = (state.employees || []).slice().sort(function(a, b) {
        return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase(), 'ru');
    });
    sel.innerHTML = emps.map(function(e) {
        var name = maskName(e.name) + (e.fired ? ' 🚪' : '');
        return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(name) + '</option>';
    }).join('');
}
function fillTaskSelect() {
    var dl = $('log_task_list');
    if (!dl) return;
    var active = state.tasks.filter(function(t) { return t.status !== 'archived'; });
    dl.innerHTML = active.map(function(t) {
        var mark = t.overdue ? ' ⚠' : '';
        var suffix = (t.status === 'done' || t.status === 'archived') ? ' (архив)' : '';
        var label = (t.name || '') + suffix + mark;
        return '<option value="' + escapeHtml(label) + '" data-id="' + escapeHtml(t.id) + '"></option>';
    }).join('');
}
function fillSummaryFilters() {
    var selEmp = $('sumEmployeeFilter');
    if (selEmp) {
        var c1 = selEmp.value;
        selEmp.innerHTML = '<option value="">Сотрудники</option>'
            + state.employees.map(function(e) {
                var name = maskName(e.name) + (e.fired ? ' 🚪' : '');
                return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(name) + '</option>';
            }).join('');
        selEmp.value = c1;
    }
    var selTask = $('sumTaskFilter');
    if (selTask) {
        var c2 = selTask.value;
        selTask.innerHTML = '<option value="">Задачи</option>'
            + state.tasks.map(function(t) {
                var tagsTxt = (t.tags && t.tags.length) ? (' · ' + t.tags.map(function(x){return '#'+x;}).join(' ')) : '';
                return '<option value="' + escapeHtml(t.id) + '">'
                    + escapeHtml((t.icon || '📋') + ' ' + t.name + tagsTxt) + '</option>';
            }).join('');
        selTask.value = c2;
    }
    var stDept = $('stDeptFilter');
    if (stDept) {
        var sd = stDept.value;
        stDept.innerHTML = '<option value="">Отделы</option>'
            + (state.departments || []).map(function(d) {
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
            }).join('');
        stDept.value = sd;
    }
    var stEmp = $('stEmployeeFilter');
    if (stEmp) {
        var se = stEmp.value;
        stEmp.innerHTML = '<option value="">Сотрудники</option>'
            + state.employees.map(function(e) {
                var name = maskName(e.name) + (e.fired ? ' 🚪' : '');
                return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(name) + '</option>';
            }).join('');
        stEmp.value = se;
    }
    var tskEmp = $('tskEmployeeFilter');
    if (tskEmp) {
        var te = tskEmp.value;
        tskEmp.innerHTML = '<option value="">Сотрудники</option>'
            + state.employees.map(function(e) {
                var name = maskName(e.name) + (e.fired ? ' 🚪' : '');
                return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(name) + '</option>';
            }).join('');
        tskEmp.value = te;
    }
}
function fillTagFilters() {
    var tagsSet = {};
    state.tasks.forEach(function(t) {
        (t.tags || []).forEach(function(x) { tagsSet[x] = true; });
    });
    (state.allTags || []).forEach(function(x) { tagsSet[x] = true; });
    var tags = Object.keys(tagsSet).sort();
    window.__trkAllTags = {};
    tags.forEach(function(t) { window.__trkAllTags[t] = true; });
    if (window.__trkInitTagFilterUI) window.__trkInitTagFilterUI();
    if (window.__trkRenderTagPills) window.__trkRenderTagPills();
}
/* ============================================================
   КАЛЕНДАРЬ
   ============================================================ */
function loadCalendar() {
    var ym = state.currentYM || todayYM();
    state.currentYM = ym;
    var emp = state.currentEmployee || '';
    var dept = state.currentDepartment || '';
    var team = state.currentTeam || '';
    var url = '/api/tracker/calendar?ym=' + encodeURIComponent(ym)
        + '&employee=' + encodeURIComponent(emp)
        + '&department=' + encodeURIComponent(dept)
        + '&team=' + encodeURIComponent(team);
    return apiJson(url)
        .then(function(d) { 
            state.calendar = d; 
            renderCalendar(); 
            // PATCH v3: применяем штриховку будущих дней после перерисовки
            if (window.__trkDecorateFuture && window.__trkDecorateFuture.calendar) {
                setTimeout(window.__trkDecorateFuture.calendar, 50);
            }
        })
        .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function exportCalendarToExcel() {
    var month = state.calendar ? state.calendar.month : new Date().getMonth() + 1;
    var year = state.calendar ? state.calendar.year : new Date().getFullYear();
    var params = new URLSearchParams();
    params.set('month', month);
    params.set('year', year);
    var deptFilter = document.getElementById('calDeptFilter');
    if (deptFilter && deptFilter.value) params.set('department', deptFilter.value);
    var teamFilter = document.getElementById('calTeamFilter');
    if (teamFilter && teamFilter.value) params.set('team', teamFilter.value);
    var empFilter = document.getElementById('calEmployeeFilter');
    if (empFilter && empFilter.value) params.set('employee', empFilter.value);
    notify('📊 Генерируем Excel...', 'info');
    window.open('/api/tracker/calendar/export?' + params.toString(), '_blank');
}

(function(){
    function bindExportCalendar() {
        document.addEventListener('click', function(e) {
            var t = e.target && e.target.closest ? e.target.closest('#exportCalendarBtn') : null;
            if (t) exportCalendarToExcel();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindExportCalendar);
    else bindExportCalendar();
})();

// «Планирование → 📥 Экспорт»: один файл xlsx (Проверки, Карманы × план, По месяцам), без фильтров экрана.
function exportPlannedToExcel(btn) {
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    notify('📥 Готовим Excel по запланированным проверкам...', 'info');
    fetch('/api/tracker/export/planned', { credentials: 'same-origin' }).then(function(r) {
        var ct = r.headers.get('Content-Type') || '';
        if (!r.ok || ct.indexOf('spreadsheetml') < 0) {
            return r.text().then(function(txt) {
                var msg = 'HTTP ' + r.status;
                try { var j = JSON.parse(txt); if (j && j.error) msg = j.error; } catch (_) {}
                throw new Error(msg);
            });
        }
        var cd = r.headers.get('Content-Disposition') || '', m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
        var name = m ? decodeURIComponent(m[1]) : 'planned_audits.xlsx';
        return r.blob().then(function(bl) {
            var url = URL.createObjectURL(bl), a = document.createElement('a');
            a.href = url; a.download = name; document.body.appendChild(a); a.click();
            setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1500);
            notify('✅ Файл ' + name + ' скачан', 'success');
        });
    }).catch(function(e) {
        notify('Не удалось выгрузить Excel: ' + (e && e.message ? e.message : e), 'error');
    }).then(function() { if (btn) btn.disabled = false; });
}
window.exportPlannedToExcel = exportPlannedToExcel;
(function(){
    function bindExportPlanned() {
        document.addEventListener('click', function(e) {
            var t = e.target && e.target.closest ? e.target.closest('#exportPlannedBtn') : null;
            if (t) { e.preventDefault(); exportPlannedToExcel(t); }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindExportPlanned);
    else bindExportPlanned();
})();

function renderCalendar() {
    var cal = state.calendar; if (!cal) return;
    var titleEl = $('calMonthTitle');
    if (titleEl) titleEl.textContent = MONTHS_RU[cal.month - 1] + ' ' + cal.year;
    var grid = $('calGrid'); if (!grid) return;
    grid.setAttribute('data-expand', state.calExpandOnHover ? 'on' : 'off');
    grid.querySelectorAll('.cal-cell').forEach(function(c) { c.remove(); });
    var today = todayISO();
    cal.days.forEach(function(day) {
        var cell = document.createElement('div');
        cell.className = 'cal-cell';
        if (!day.in_month) cell.classList.add('out-month');
        if (day.date === today) cell.classList.add('today');
        if (day.is_weekend && !day.is_holiday) cell.classList.add('weekend');
        if (day.is_holiday) cell.classList.add('holiday');
        if (day.total_hours > 0) cell.classList.add(hoursClass(day.total_hours));
        if (day.missing && day.missing.length) cell.classList.add('missing');
        if (day.overdue_tasks && day.overdue_tasks.length) cell.classList.add('has-overdue');
        cell.setAttribute('data-date', day.date);
        if (day.is_holiday) cell.setAttribute('title', '🎉 ' + (day.holiday_name || 'Праздник'));
        var entriesHtml = '';
        var allEntries = day.entries;
        if (state.calViewMode === 'tasks') {
            allEntries.forEach(function(en) {
                entriesHtml += '<div class="cal-entry" title="' + escapeHtml(en.task_name + (en.comment ? ' — ' + en.comment : '')) + '">'
                    + '<span>' + escapeHtml(en.task_icon) + '</span>'
                    + '<span style="overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(en.task_name) + '</span>'
                    + '<span class="entry-hours">' + formatHours(en.hours) + '</span></div>';
            });
        } else {
            var tot = {}, colors = {}, names = {};
            allEntries.forEach(function(en) {
                tot[en.employee_id] = (tot[en.employee_id] || 0) + en.hours;
                colors[en.employee_id] = en.employee_color;
                names[en.employee_id] = en.employee_name;
            });
            var ids = Object.keys(tot).sort(function(a, b) { return tot[b] - tot[a]; });
            ids.forEach(function(eid) {
                entriesHtml += '<div class="cal-entry" title="' + escapeHtml(maskName(names[eid] || '?') + ' — ' + formatHours(tot[eid])) + '">'
                    + '<span class="cal-dot" style="background:' + escapeHtml(colors[eid]) + ';"></span>'
                    + '<span style="overflow:hidden;text-overflow:ellipsis;">' + escName(names[eid] || '?') + '</span>'
                    + '<span class="entry-hours">' + formatHours(tot[eid]) + '</span></div>';
            });
        }
        var more = '';
        if (allEntries.length > 3) {
            more = '<div class="cal-more">+' + (allEntries.length - 3) + ' ещё</div>';
        }
        // PATCH v1.0.11: счётчик отметившихся сотрудников в углу ячейки
        var _empSet = {};
        allEntries.forEach(function(en) { if (en.employee_id) _empSet[en.employee_id] = true; });
        var _empCount = Object.keys(_empSet).length;
        var _empBadge = '';
        if (state.calViewMode === 'tasks' && _empCount > 1) {
            _empBadge = '<span class="cal-badge-emps" title="Отметились: ' + _empCount + ' сотр.">👥 ' + _empCount + '</span>';
        }
        var warn = '';
        if (day.missing && day.missing.length) {
            warn = '<span class="cal-badge-warn" title="Не заполнено: '
                + day.missing.map(function(m) { return escapeHtml(maskName(m.name)); }).join(', ')
                + '">!' + day.missing.length + '</span>';
        }
        var vacBadge = '';
        if (day.vacation && day.vacation.length) {
            vacBadge = '<span class="cal-badge-vac" title="Отсутствуют: '
                + day.vacation.map(function(vid) {
                    var e = state.employees.find(function(x) { return x.id === vid; });
                    return escapeHtml(maskName(e ? e.name : '?'));
                }).join(', ') + '">🌞</span>';
        }
        var remBadge = '';
        if (day.remote && day.remote.length) {
            remBadge = '<span class="cal-badge-remote" title="На удаленке: '
                + day.remote.map(function(vid) {
                    var e = state.employees.find(function(x) { return x.id === vid; });
                    return escapeHtml(maskName(e ? e.name : '?'));
                }).join(', ') + '">🏠</span>';
        }
        cell.innerHTML = warn + vacBadge + remBadge + _empBadge
            + '<div class="cal-day-head"><span class="cal-day-num">' + parseInt(day.date.split('-')[2], 10) + '</span>'
            + (day.total_hours > 0 ? '<span class="cal-day-hours">' + formatHours(day.total_hours) + '</span>' : '')
            + '</div><div class="cal-day-entries">' + entriesHtml + more + '</div>';
        cell.addEventListener('click', function() { openDayModal(day.date); });
        grid.appendChild(cell);
    });
}
function shiftMonth(delta) {
    if (!state.currentYM) state.currentYM = todayYM();
    var p = state.currentYM.split('-'); var y = parseInt(p[0], 10), m = parseInt(p[1], 10);
    m += delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    state.currentYM = y + '-' + String(m).padStart(2, '0');
    loadCalendar();
}
on('calPrevBtn', 'click', function() { shiftMonth(-1); });
on('calNextBtn', 'click', function() { shiftMonth(1); });
on('calTodayBtn', 'click', function() { state.currentYM = todayYM(); loadCalendar(); });
on('calEmployeeFilter', 'change', function() {
    state.currentEmployee = this.value;
    loadCalendar();
});
on('calDeptFilter', 'change', function() {
    state.currentDepartment = this.value;
    try { localStorage.setItem('tracker_calDept', this.value); } catch (e) {}
    if (state.currentEmployee) {
        var emp = state.employees.find(function(e) { return e.id === state.currentEmployee; });
        if (emp && this.value && emp.department_id !== this.value) state.currentEmployee = '';
    }
    fillEmployeeFilter();
    loadCalendar();
});
on('calTeamFilter', 'change', function() {
    state.currentTeam = this.value;
    if (state.currentEmployee) {
        var ids = _teamEmpIds(this.value);
        if (ids && !ids.has(state.currentEmployee)) state.currentEmployee = '';
    }
    fillEmployeeFilter();
    loadCalendar();
});

/* ============================================================
   ДНЕВНОЙ МОДАЛ — сгруппированный
   ============================================================ */
function _entryIsMine(en) {
    if (!en) return false;
    var me = state.currentUser || {};
    if (!me.employee_id) return false;
    return en.employee_id === me.employee_id;
}
function canEditEntry(en) {
    if (hasPerm('action.log.edit.any')) return true;
    if (hasPerm('action.log.edit.own') && _entryIsMine(en)) return true;
    return false;
}
function canDeleteEntry(en) {
    if (hasPerm('action.log.delete.any')) return true;
    if (hasPerm('action.log.delete.own') && _entryIsMine(en)) return true;
    return false;
}
function bindDayEntryActions(container, entries) {
    if (!container) return;
    entries = entries || [];
    container.querySelectorAll('[data-id]').forEach(function(item) {
        var id = parseInt(item.getAttribute('data-id'), 10);
        if (isNaN(id)) return;
        var entry = entries.find(function(x) { return x.id === id; });
        if (!entry) return;
        var eb = item.querySelector('[data-act="edit"]');
        var db = item.querySelector('[data-act="delete"]');
        if (eb) eb.addEventListener('click', function(e) {
            e.stopPropagation();
            openLogModal(entry);
        });
        if (db) db.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!confirm('Удалить эту отметку?')) return;
            var _dayWasOpen = document.getElementById('dayModal') && document.getElementById('dayModal').classList.contains('active');
            apiJson('/api/tracker/log/delete', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id: id })
            }).then(function(d) {
                if (d && d.cancelled) return Promise.reject(new Error('cancelled'));
                notify('✅ Удалено');
                return trkRefreshAll();
            }).then(function() {
                if (_dayWasOpen && state.currentDay) openDayModal(state.currentDay);
            }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
        });
    });
}
function openDayModal(dateStr) {
    state.currentDay = dateStr;
    var dd = $('dayModalDate'); if (dd) dd.textContent = formatDateHuman(dateStr);
    var day = null;
    if (state.calendar) day = state.calendar.days.find(function(d) { return d.date === dateStr; });
    renderDayList(day ? day.entries : [], day ? day.total_hours : 0, day);
    var m = $('dayModal'); if (m) m.classList.add('active');
    var acts = $('dayModalLeftActions'); if (acts) acts.style.display = '';
    var clr = $('dayClearBtn'); if (clr) clr.style.display = '';
}
function renderDayList(entries, totalHours, day) {
    var list = $('dayList'); if (!list) return;
    // PATCH 1.0.12: обычный пользователь видит в карточке дня только свои задачи
    try {
        var _meId = (state.currentUser && state.currentUser.employee_id) || '';
        var _showAllDay = hasPerm('block.calendar.other_employees') || hasPerm('action.log.edit.any');
        if (!_showAllDay && _meId && state.dayViewMode !== 'employee') {
            entries = (entries || []).filter(function(en) { return en.employee_id === _meId; });
            var _sum = 0;
            entries.forEach(function(en) { _sum += Number(en.hours) || 0; });
            totalHours = Math.round(_sum * 4) / 4;
        }
    } catch (e) { console.error('[renderDayList] filter', e); }
    var extra = '';
    if (day && day.missing && day.missing.length) extra += ' · не заполнено: ' + day.missing.length;
    var dt = $('dayModalTotal');
    if (dt) dt.textContent = formatHours(totalHours) + ' · ' + entries.length + ' записей' + extra;
    var mb = $('dayMissingBlock');
    if (mb) {
        if (day && day.missing && day.missing.length) {
            mb.style.display = 'block';
            var items = day.missing.map(function(m) {
                return '<span class="dm-item">'
                    + '<span class="dm-dot" style="background:' + escapeHtml(m.color) + '; box-shadow:0 0 6px ' + escapeHtml(m.color) + ';"></span>'
                    + escName(m.name)
                    + (m.department ? ' <span style="opacity:0.7;font-size:0.72rem;">(' + escapeHtml(m.department) + ')</span>' : '')
                    + '</span>';
            }).join('');
            mb.innerHTML = '<div class="dm-title">⚠ Не заполнили день (' + day.missing.length + '):</div>'
                + '<div class="dm-list">' + items + '</div>';
        } else {
            mb.style.display = 'none';
            mb.innerHTML = '';
        }
    }
    if (!entries.length) {
        list.innerHTML = '<div class="day-empty">Пока пусто.</div>';
        return;
    }
    var byTask = {};
    entries.forEach(function(en) {
        var tid = en.task_id;
        if (!byTask[tid]) {
            byTask[tid] = {
                task_id: tid, task_name: en.task_name, task_icon: en.task_icon,
                deadline: en.task_deadline, start_date: en.task_start_date,
                overdue: en.overdue, statuses: {}, people: [], total: 0,
            };
        }
        byTask[tid].people.push(en);
        byTask[tid].total += Number(en.hours) || 0;
        if (en.status) byTask[tid].statuses[en.status] = true;
    });
    var priority = { done: 4, in_progress: 3, blocked: 2, planned: 1 };
    var groups = Object.keys(byTask).map(function(k) { return byTask[k]; });
    groups.forEach(function(g) {
        g.dom = 'planned';
        var best = 0;
        Object.keys(g.statuses).forEach(function(s) {
            var p = priority[s] || 0;
            if (p > best) { best = p; g.dom = s; }
        });
        g.total = Math.round(g.total * 4) / 4;
    });
    groups.sort(function(a, b) { return b.total - a.total; });

    var html = '';
    groups.forEach(function(g) {
        var stLbl = state.statusLabels[g.dom] || g.dom;
        html += '<div class="day-task-group ' + (g.overdue ? 'overdue' : '') + ' ' + g.dom + '">'
            + '<div class="day-task-group-head">'
            +   '<span class="day-task-group-title' + (g.overdue ? ' overdue' : '') + '">'
            +     escapeHtml(g.task_icon || '📋') + ' ' + escapeHtml(g.task_name || '')
            +   '</span>'
            +   '<span class="day-task-group-total">' + formatHours(g.total) + '</span>'
            +   '<span class="day-entry-status ' + statusClass(g.dom) + '">' + escapeHtml(stLbl) + '</span>'
            + '</div>'
            + '<div class="day-entry-meta">'
            +   (g.start_date ? '<span class="mi">🚀 ' + escapeHtml(formatDateHuman(g.start_date)) + '</span>' : '')
            +   (g.deadline ? '<span class="mi' + (g.deadline < todayISO() && g.dom !== 'done' ? ' danger' : '') + '">⏰ ' + escapeHtml(formatDateHuman(g.deadline)) + '</span>' : '')
            + '</div>'
            + '<div class="day-task-group-people">';
        g.people.sort(function(a, b) { return (b.hours || 0) - (a.hours || 0); });
        g.people.forEach(function(en) {
            html += '<div class="day-task-person" data-id="' + en.id + '">'
                + '<div class="dp-avatar" style="background:' + escapeHtml(en.employee_color) + ';">'
                +   escapeHtml(initials(en.employee_name)) + '</div>'
                + '<span class="dp-name">' + escName(en.employee_name) + '</span>'
                + (en.comment ? '<span class="dp-comment">' + escapeHtml(en.comment) + '</span>' : '')
                + '<span class="dp-hours">' + formatHours(en.hours) + '</span>'
                + (canEditEntry(en)
                    ? '<button class="dict-action-btn" data-act="edit" title="Ред.">✏️</button>' : '')
                + (canDeleteEntry(en)
                    ? '<button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button>' : '')
                + '</div>';
        });
        html += '</div></div>';
    });
    list.innerHTML = html;

    var allEntries = entries;
    var _dk = (day && day.date) || state.currentDay || '';
    allEntries.forEach(function(en) { if (!en.date) en.date = _dk; });
    bindDayEntryActions(list, allEntries);
}

/* ============================================================
   ДЕНЬ-КАРТОЧКА ОТМЕТКИ
   ============================================================ */
function dayEntryCard(en, compact) {
    var cls = 'day-entry';
    if (en.overdue) cls += ' overdue';
    if (en.status) cls += ' ' + en.status;
    var color = en.employee_color || '#888888';
    var statusLabel = en.status_label || (state.statusLabels[en.status] || '');
    var metaArr = [];
    if (en.task_start_date) metaArr.push('<span class="mi">🚀 ' + escapeHtml(formatDateHuman(en.task_start_date)) + '</span>');
    if (en.task_deadline) {
        var c = 'mi';
        if (en.task_deadline < todayISO() && en.status !== 'done') c += ' danger';
        metaArr.push('<span class="' + c + '">⏰ ' + escapeHtml(formatDateHuman(en.task_deadline)) + '</span>');
    }
    var comment = en.comment ? '<div class="day-entry-comment">' + escapeHtml(en.comment) + '</div>' : '';
    var link = en.link
        ? '<a class="day-entry-link" href="' + escapeHtml(en.link) + '" target="_blank" rel="noopener">🔗 ' + escapeHtml(en.link) + '</a>'
        : '';
    var compactCls = compact ? ' style="padding:8px 10px;"' : '';
    var canEdit = canEditEntry(en);
    var canDel = canDeleteEntry(en);
    return '<div class="' + cls + '" data-id="' + en.id + '"' + compactCls + '>'
        + '<div class="day-entry-avatar" style="background:' + escapeHtml(color) + '; box-shadow:0 0 10px ' + escapeHtml(color) + ';">'
        +     escapeHtml(initials(en.employee_name || '?')) + '</div>'
        + '<div class="day-entry-body">'
        +     '<div class="day-entry-head">'
        +         '<span class="day-entry-task' + (en.overdue ? ' overdue' : '') + '">'
        +             escapeHtml(en.task_icon || '📋') + ' ' + escapeHtml(en.task_name || '')
        +         '</span>'
        +         '<span class="day-entry-hours">' + formatHours(en.hours) + '</span>'
        +         (statusLabel ? '<span class="day-entry-status ' + statusClass(en.status) + '">' + escapeHtml(statusLabel) + '</span>' : '')
        +     '</div>'
        +     '<div class="day-entry-employee-row">'
        +         '<span class="emp-name">' + escName(en.employee_name || '') + '</span>'
        +         (en.employee_department ? '<span class="emp-dept">🏢 ' + escapeHtml(en.employee_department) + '</span>' : '')
        +     '</div>'
        +     (metaArr.length ? '<div class="day-entry-meta">' + metaArr.join('') + '</div>' : '')
        +     comment
        +     link
        + '</div>'
        + '<div class="day-entry-actions">'
        +     (canEdit ? '<button class="dict-action-btn" data-act="edit" title="Редактировать">✏️</button>' : '')
        +     (canDel ? '<button class="dict-action-btn danger" data-act="delete" title="Удалить">🗑</button>' : '')
        + '</div></div>';
}

on('dayAddBtn', 'click', function() { openLogModal(null); });
on('dayTodayBtn', 'click', function() {
    var dk = todayISO();
    state.currentDay = dk;
    var m = $('dayModal'); if (m) m.classList.remove('active');
    state.currentYM = todayYM();
    loadCalendar().then(function() { openDayModal(dk); });
});
function _doCopyPrevDay(empId) {
    if (!state.currentDay) return;
    var cur = new Date(state.currentDay + 'T00:00:00');
    var prev = new Date(cur.getTime() - 86400000);
    var srcISO = isoFromDate(prev);
    var who = empId;
    var empObj = state.employees.find(function(e) { return e.id === who; }) || {};
    var label = maskName(empObj.name || who);
    if (!confirm('Скопировать отметки за ' + formatDateHuman(srcISO) + ' в ' + formatDateHuman(state.currentDay) + ' для: ' + label + '?')) return;
    apiJson('/api/tracker/log/copy_day', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ source: srcISO, target: state.currentDay, employee: who })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        notify('✅ Скопировано: ' + d.copied);
        return loadCalendar();
    }).then(function() { openDayModal(state.currentDay); })
    .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('dayCopyPrevBtn', 'click', function() {
    if (!state.currentDay) return;
    var me = state.currentUser || {};
    var myEmp = (me.employee_id || '').trim();
    if (myEmp) { _doCopyPrevDay(myEmp); return; }
    if (me.role === 'admin') {
        var sel = $('copyDayEmpSelect');
        if (sel) {
            sel.innerHTML = '<option value="">— выберите сотрудника —</option>'
                + state.employees.map(function(e) {
                    return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(maskName(e.name)) + '</option>';
                }).join('');
        }
        var m = $('copyDayEmpModal'); if (m) m.classList.add('active');
        return;
    }
    notify('⚠ Ваша учётка не привязана к сотруднику. Обратитесь к администратору.', 'error');
});
on('copyDayEmpConfirm', 'click', function() {
    var sel = $('copyDayEmpSelect');
    var v = sel ? sel.value : '';
    if (!v) { notify('❌ Выберите сотрудника', 'error'); return; }
    var m = $('copyDayEmpModal'); if (m) m.classList.remove('active');
    _doCopyPrevDay(v);
});
on('dayClearBtn', 'click', function() {
    if (!state.currentDay) return;
    if (!confirm('Удалить ВСЕ отметки за ' + formatDateHuman(state.currentDay) + '?')) return;
    apiJson('/api/tracker/log/clear_day', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ date: state.currentDay, employee: state.currentEmployee || '' })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        notify('✅ Удалено: ' + d.deleted);
        return loadCalendar();
    }).then(function() { openDayModal(state.currentDay); })
    .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
});

/* ============================================================
   ОТМЕТКА
   ============================================================ */
function syncLogStatusFromTask() {
    var empSel = $('log_employee'), taskSel = $('log_task'), statusSel = $('log_status');
    if (!empSel || !taskSel || !statusSel) return;
    var empId = empSel.value, tid = taskSel.value;
    if (!empId || !tid) return;
    var last = null;
    (state.log || []).forEach(function(l) {
        if (l.employee_id !== empId || l.task_id !== tid) return;
        if (!last || (l.date || '') > (last.date || '')) last = l;
    });
    if (last && last.status) {
        statusSel.value = last.status;
        return;
    }
    var t = (state.tasks || []).find(function(x) { return x.id === tid; });
    if (t) {
        var map = {active: 'in_progress', done: 'done', cancelled: 'planned', planning: 'planned', approved: 'planned'};
        statusSel.value = map[t.status] || 'in_progress';
    }
}

function openLogModal(entry) {
    entry = entry || null;
    if (!state.employees.length) { notify('❌ Сначала добавьте сотрудника', 'error'); return; }
    if (!state.tasks.length) { notify('❌ Сначала добавьте задачу', 'error'); return; }
    var t = $('logModalTitle'); if (t) t.textContent = entry ? 'Редактировать отметку' : 'Новая отметка';
    var g = function(id, v) { var el = $(id); if (el) el.value = v; };
    g('log_id', entry ? entry.id : '');
    var dk = state.currentDay || todayISO();
    g('log_date', entry ? (entry.date || dk) : dk);

    var myEmp = (state.currentUser && state.currentUser.employee_id) || '';
    var defaultEmp = '';
    if (entry) defaultEmp = entry.employee_id;
    else if (myEmp && state.employees.some(function(e) { return e.id === myEmp; })) defaultEmp = myEmp;
    else defaultEmp = (state.employees[0] || {}).id || '';
    g('log_employee', defaultEmp);
    var _tid = entry ? entry.task_id : ((state.tasks[0] || {}).id || '');
    g('log_task', _tid);
    var _tin = $('log_task_input');
    if (_tin) {
        var _tobj = _tid ? state.tasks.find(function(x) { return x.id === _tid; }) : null;
        _tin.value = _tobj ? (_tobj.name + (_tobj.status === 'done' || _tobj.status === 'archived' ? ' (архив)' : '')) : '';
    }
    var _w = $('log_task_warn'); if (_w) _w.style.display = 'none';
    g('log_hours', entry ? entry.hours : 8);
    if (entry) {
        g('log_status', entry.status);
    } else {
        syncLogStatusFromTask();
    }
    g('log_comment', entry ? entry.comment : '');
    g('log_link', entry ? entry.link : '');

    _logExistingMode = 'me';
    _logExistingEmpId = defaultEmp;
    try { if (window.__trkRenderTagPills) window.__trkRenderTagPills(); } catch (e) {}
    _updateLogExistingTabsUI();

    updateDayHoursSummary();
    renderExistingDayEntries($('log_date') ? $('log_date').value : '', entry ? entry.id : null);
    var m = $('logModal'); if (m) m.classList.add('active');
    setTimeout(function() { var h = $('log_hours'); if (h) h.focus(); }, 50);
}
function updateDayHoursSummary() {
    var block = $('logDaySummary'); if (!block) return;
    var dt = $('log_date'); var emp = $('log_employee');
    var lid = $('log_id'); var hours = $('log_hours');
    if (!dt || !emp) return;
    var dk = dt.value, empId = emp.value;
    var curId = lid && lid.value ? parseInt(lid.value, 10) : null;
    if (!dk || !empId) { block.style.display = 'none'; return; }
    var total = 0, tasksList = [];
    if (state.calendar) {
        var day = state.calendar.days.find(function(d) { return d.date === dk; });
        if (day) {
            day.entries.forEach(function(en) {
                if (en.employee_id !== empId) return;
                if (curId && en.id === curId) return;
                total += en.hours;
                tasksList.push(en.task_icon + ' ' + en.task_name + ' (' + en.hours + 'ч)');
            });
        }
    }
    var planned = hours ? (parseFloat(hours.value) || 0) : 0;
    var willBe = total + planned;
    var empObj = state.employees.find(function(e) { return e.id === empId; }) || {};
    var empName = maskName(empObj.name || '');
    block.style.display = 'flex';
    block.className = 'log-day-summary';
    var txt = 'За ' + formatDateHuman(dk) + ' у ' + empName + ': уже <b>' + total + ' ч</b>';
    if (planned > 0) txt += ' + ' + planned + ' ч';
    txt += ' = <b>' + willBe + ' ч</b>';
    if (tasksList.length) txt += '<div style="font-size:0.72rem;opacity:0.75;margin-top:3px;">' + tasksList.join(' · ') + '</div>';
    if (willBe > 24) { block.classList.add('danger'); txt = '⚠ Превышение 24 ч! ' + txt; }
    else if (willBe > 8) { block.classList.add('warn'); txt = '⚠ Больше 8 ч. ' + txt; }
    else if (willBe === 8) { block.classList.add('ok'); txt = '✓ Ровно 8 ч. ' + txt; }
    else { block.classList.add('warn'); }
    block.innerHTML = '<span class="lbl">' + txt + '</span>';
}
function renderExistingDayEntries(dateStr, excludeId) {
    var wrap = $('logDayExisting'), list = $('logDayExistingList');
    if (!wrap || !list) return;
    var tabs = $('logExistingTabs');

    var entries = [];
    if (state.calendar) {
        var day = state.calendar.days.find(function(d) { return d.date === dateStr; });
        if (day) entries = day.entries;
    }
    entries = entries.filter(function(en) { return en.id !== excludeId; });

    var visible = entries;
    if (_logExistingMode === 'me' && _logExistingEmpId) {
        visible = entries.filter(function(en) { return en.employee_id === _logExistingEmpId; });
    }

    if (!entries.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    if (tabs) tabs.style.display = entries.length > 1 ? '' : 'none';
    _updateLogExistingTabsUI();

    if (!visible.length) {
        list.innerHTML = '<div class="day-empty">У выбранного сотрудника за этот день отметок нет.</div>';
        return;
    }
    var html = '';
    visible.forEach(function(en) {
        if (!en.date) en.date = dateStr;
        html += dayEntryCard(en, true);
    });
    list.innerHTML = html;
    bindDayEntryActions(list, visible);
}
function _updateLogExistingTabsUI() {
    var tabs = $('logExistingTabs');
    if (!tabs) return;
    tabs.querySelectorAll('.log-existing-tab').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === _logExistingMode);
    });
}
function saveLog() {
    var payload = {
        id: $('log_id') ? ($('log_id').value || null) : null,
        employee_id: $('log_employee') ? $('log_employee').value : '',
        task_id: $('log_task') ? $('log_task').value : '',
        date: $('log_date') ? $('log_date').value : '',
        hours: parseFloat($('log_hours') ? $('log_hours').value : 0) || 0,
        status: $('log_status') ? $('log_status').value : 'in_progress',
        comment: $('log_comment') ? $('log_comment').value.trim() : '',
        link: $('log_link') ? $('log_link').value.trim() : '',
    };
    if (!payload.employee_id) { notify('❌ Выберите сотрудника', 'error'); return; }
    if (!payload.task_id) { notify('❌ Выберите задачу из списка или создайте новую', 'error'); return; }
    if (!payload.date) { notify('❌ Некорректная дата', 'error'); return; }
    var _dayWasOpen = document.getElementById('dayModal') && document.getElementById('dayModal').classList.contains('active');
    apiJson('/api/tracker/log/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        notify('✅ Сохранено');
        var m = $('logModal'); if (m) m.classList.remove('active');
        return trkRefreshAll();
    }).then(function() { if (_dayWasOpen && state.currentDay) openDayModal(state.currentDay); })
    .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('log_date', 'change', function() {
    updateDayHoursSummary();
    renderExistingDayEntries(this.value, $('log_id') && $('log_id').value ? parseInt($('log_id').value, 10) : null);
});
on('log_employee', 'change', function() {
    _logExistingEmpId = this.value;
    updateDayHoursSummary();
    if (_logExistingMode === 'me') {
        renderExistingDayEntries(
            $('log_date') ? $('log_date').value : '',
            $('log_id') && $('log_id').value ? parseInt($('log_id').value, 10) : null
        );
    }
});
on('log_hours', 'input', updateDayHoursSummary);
on('log_task', 'change', syncLogStatusFromTask);
on('log_employee', 'change', syncLogStatusFromTask);
on('saveLogBtn', 'click', saveLog);
on('log_comment', 'keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveLog(); }
});
on('logExistingTabs', 'click', function(e) {
    var t = e.target.closest('.log-existing-tab');
    if (!t) return;
    _logExistingMode = t.getAttribute('data-mode');
    _updateLogExistingTabsUI();
    renderExistingDayEntries(
        $('log_date') ? $('log_date').value : '',
        $('log_id') && $('log_id').value ? parseInt($('log_id').value, 10) : null
    );
});

/* ============================================================
   ОТДЕЛЫ CRUD
   ============================================================ */
function openDepartmentModal(dep) {
    dep = dep || null;
    var t = $('departmentModalTitle'); if (t) t.textContent = dep ? 'Редактировать банк' : 'Новый банк';
    var g = function(id, v) { var el = $(id); if (el) el.value = v; };
    g('dep_id', dep ? dep.id : '');
    g('dep_name', dep ? dep.name : '');
    g('dep_color', (dep && dep.color) || '#00897b');
    g('dep_headcount_retail', (dep && dep.headcount_retail !== null && dep.headcount_retail !== undefined) ? dep.headcount_retail : '');
    g('dep_headcount_corp', (dep && dep.headcount_corp !== null && dep.headcount_corp !== undefined) ? dep.headcount_corp : '');
    g('dep_short_name', (dep && dep.short_name) || '');
    var headSel = $('dep_head');
    if (headSel) {
        headSel.innerHTML = '<option value="">— не указан —</option>'
            + state.employees.filter(function(e) { return !e.fired; }).map(function(e) {
                return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(maskName(e.name))
                    + (e.department_id ? ' (' + escapeHtml(e.department || '') + ')' : '') + '</option>';
            }).join('');
        headSel.value = (dep && dep.head_employee_id) || '';
    }
    var m = $('departmentModal'); if (m) m.classList.add('active');
    setTimeout(function() { var n = $('dep_name'); if (n) n.focus(); }, 50);
}
function saveDepartment() {
    var name = $('dep_name') ? $('dep_name').value.trim() : '';
    if (!name) { notify('❌ Укажите название', 'error'); return; }
    var _hr = ($('dep_headcount_retail') && $('dep_headcount_retail').value !== '') ? parseFloat($('dep_headcount_retail').value) : null;
    var _hc = ($('dep_headcount_corp') && $('dep_headcount_corp').value !== '') ? parseFloat($('dep_headcount_corp').value) : null;
    if (_hr !== null || _hc !== null) {
        var _tot = (_hr || 0) + (_hc || 0);
        if (Math.abs(_tot - Math.round(_tot)) > 1e-9) {
            notify('❌ Общая численность штата не может быть дробным числом', 'error');
            return;
        }
    }
    var payload = {
        id: $('dep_id') ? ($('dep_id').value || '') : '',
        name: name,
        color: $('dep_color') ? $('dep_color').value : '#00897b',
        head_employee_id: $('dep_head') ? ($('dep_head').value || '') : '',
        headcount_retail: _hr,
        headcount_corp: _hc,
        short_name: $('dep_short_name') ? $('dep_short_name').value.trim() : '',
    };
    apiJson('/api/tracker/department/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        notify('✅ Сохранено');
        var m = $('departmentModal'); if (m) m.classList.remove('active');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function deleteDepartment(id) {
    var dep = (state.departments || []).find(function(x) { return x.id === id; });
    if (!dep) return;
    if (!confirm('Удалить отдел «' + dep.name + '»?')) return;
    apiJson('/api/tracker/department/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: id })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        notify('✅ Удалено');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('saveDepartmentBtn', 'click', saveDepartment);
on('addDepartmentBtn', 'click', function() { openDepartmentModal(null); });

/* ============================================================
   СОТРУДНИКИ CRUD
   ============================================================ */
var _vacDraftEmpId = null;
function openEmployeeModal(emp, readonlyCard) {
    emp = emp || null;
    var readonly = !!readonlyCard;
    _vacDraftEmpId = emp ? emp.id : null;
    var t = $('employeeModalTitle'); if (t) t.textContent = emp ? 'Редактировать сотрудника' : 'Новый сотрудник';
    var g = function(id, v) { var el = $(id); if (el) el.value = v; };
    g('emp_id', emp ? emp.id : '');
    g('emp_name', emp ? emp.name : '');
    var color = (emp && emp.color) || '#00897b';
    g('emp_color', color);
    g('emp_role', (emp && emp.role) || '');
    var deptSel = $('emp_department_select');
    if (deptSel) {
        deptSel.innerHTML = '<option value="">— не указан —</option>'
            + (state.departments || []).map(function(d) {
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
            }).join('');
        deptSel.value = (emp && emp.department_id) || '';
    }
    var hiredDate = $('emp_hired_date');
    if (hiredDate) hiredDate.value = (emp && emp.hired_date) || '';
    var dirSel = $('emp_direction');
    if (dirSel) {
        var dc = emp ? Number(emp.dir_corp) : null;
        var dr = emp ? Number(emp.dir_retail) : null;
        var dirCode = '';
        if (emp && !isNaN(dc) && !isNaN(dr)) {
            if (dc >= 0.99) dirCode = 'corp';
            else if (dr >= 0.99) dirCode = 'retail';
            else if (dc > 0 && dr > 0) dirCode = 'mixed';
        }
        dirSel.value = dirCode;
    }
    var firedCb = $('emp_fired');
    var firedDate = $('emp_fired_date');
    if (firedCb) firedCb.checked = !!(emp && emp.fired);
    if (firedDate) {
        firedDate.value = (emp && emp.fired_date) || '';
        firedDate.disabled = !(firedCb && firedCb.checked);
    }
    var pal = $('empPalette');
    if (pal) pal.querySelectorAll('.palette-dot').forEach(function(d) {
        d.classList.toggle('active', d.getAttribute('data-color') === color);
    });
    renderVacations(emp);
    var title = $('employeeModalTitle');
    if (title && readonly && emp) title.textContent = 'Карточка сотрудника';
    ['emp_name','emp_role','emp_color','emp_direction','emp_department_select','emp_hired_date','emp_fired','emp_fired_date'].forEach(function(id){
        var el = $(id); if (el) el.disabled = readonly;
    });
    var saveBtn = $('empSaveBtn');
    if (saveBtn) saveBtn.style.display = readonly ? 'none' : '';
    var m = $('employeeModal'); if (m) m.classList.add('active');
    setTimeout(function() { var n = $('emp_name'); if (n && !readonly) n.focus(); }, 50);
}
on('emp_fired', 'change', function() {
    var cb = $('emp_fired'), fd = $('emp_fired_date');
    if (!cb || !fd) return;
    fd.disabled = !cb.checked;
    if (!cb.checked) fd.value = '';
});
function renderVacations(emp) {
    var list = $('vacList'); if (!list) return;
    var vac = (emp && emp.vacations) || [];
    if (!vac.length) { list.innerHTML = '<div class="vac-empty">Пока нет периодов отсутствия</div>'; return; }
    var html = '';
    vac.forEach(function(v) {
        var vt = v.type || 'vacation';
        html += '<div class="vac-item type-' + vt + '"><div class="vac-item-body">'
            + '<div class="vac-item-dates">' + absenceIcon(vt) + ' ' + escapeHtml(absenceLabel(vt)) + ': '
            + escapeHtml(formatDateHuman(v.from || '')) + ' — ' + escapeHtml(formatDateHuman(v.to || '')) + '</div>'
            + (v.comment ? '<div class="vac-item-comment">' + escapeHtml(v.comment) + '</div>' : '')
            + '</div></div>';
    });
    list.innerHTML = html;
}
on('vacAddBtn', 'click', function() {
    if (!_vacDraftEmpId) return;
    var from = $('vac_from') ? $('vac_from').value : '';
    var to = $('vac_to') ? $('vac_to').value : '';
    var comment = $('vac_comment') ? $('vac_comment').value.trim() : '';
    var vtype = $('vac_type') ? ($('vac_type').value || 'vacation') : 'vacation';
    if (!from || !to) { notify('❌ Укажите даты', 'error'); return; }
    apiJson('/api/tracker/employee/vacation/add', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ employee_id: _vacDraftEmpId, from: from, to: to, type: vtype, comment: comment })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        var g = function(id) { var el = $(id); if (el) el.value = ''; };
        g('vac_from'); g('vac_to'); g('vac_comment');
        return loadState();
    }).then(function() {
        var emp2 = state.employees.find(function(x) { return x.id === _vacDraftEmpId; });
        renderVacations(emp2);
        renderEmployees();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
});
function saveEmployee() {
    var name = $('emp_name') ? $('emp_name').value.trim() : '';
    if (!name) { notify('❌ Укажите имя', 'error'); return; }
    var deptSel = $('emp_department_select');
    var fired = $('emp_fired') ? $('emp_fired').checked : false;
    var firedDate = $('emp_fired_date') ? $('emp_fired_date').value : '';
    if (fired && !firedDate) { notify('❌ Укажите дату увольнения', 'error'); return; }
    var dirSel = $('emp_direction');
    var dirCode = dirSel ? (dirSel.value || '') : '';
    var dirMap = { corp: [1, 0], retail: [0, 1], mixed: [0.5, 0.5] };
    if (!dirMap[dirCode]) { notify('❌ Укажите направление сотрудника', 'error'); return; }
    var payload = {
        id: $('emp_id') ? ($('emp_id').value || '') : '',
        name: name,
        color: $('emp_color') ? $('emp_color').value : '#00897b',
        role: $('emp_role') ? $('emp_role').value.trim() : '',
        department_id: deptSel ? (deptSel.value || '') : '',
        fired: fired,
        fired_date: fired ? firedDate : '',
        hired_date: $('emp_hired_date') ? ($('emp_hired_date').value || '') : '',
        dir_corp: dirMap[dirCode][0],
        dir_retail: dirMap[dirCode][1],
    };
    apiJson('/api/tracker/employee/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        var m = $('employeeModal'); if (m) m.classList.remove('active');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function deleteEmployee(id) {
    var emp = state.employees.find(function(x) { return x.id === id; });
    if (!emp) return;
    if (!confirm('Удалить сотрудника «' + emp.name + '»?')) return;
    apiJson('/api/tracker/employee/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: id })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('saveEmployeeBtn', 'click', saveEmployee);
on('addEmployeeBtn', 'click', function() { openEmployeeModal(null); });

/* ============================================================
   КОМАНДЫ CRUD
   ============================================================ */
function openTeamModal(tm) {
    tm = tm || null;
    var t = $('teamModalTitle'); if (t) t.textContent = tm ? 'Редактировать команду' : 'Новая команда';
    var g = function(id, v) { var el = $(id); if (el) el.value = v; };
    g('team_id', tm ? tm.id : '');
    g('team_name', tm ? tm.name : '');
    var deptSel = $('team_department');
    if (deptSel) {
        deptSel.innerHTML = '<option value="">— выберите отдел —</option>'
            + (state.departments || []).map(function(d) {
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
            }).join('');
        deptSel.value = (tm && tm.department_id) || '';
    }
    _renderTeamManagers((tm && tm.department_id) || '', (tm && tm.manager_id) || '');
    _renderTeamMembers((tm && tm.department_id) || '', (tm && tm.member_ids) || []);
    var m = $('teamModal'); if (m) m.classList.add('active');
    setTimeout(function() { var n = $('team_name'); if (n) n.focus(); }, 50);
}
function _renderTeamManagers(deptId, selected) {
    var sel = $('team_manager'); if (!sel) return;
    var emps = state.employees;
    if (deptId) emps = emps.filter(function(e) { return e.department_id === deptId; });
    sel.innerHTML = '<option value="">— не указан —</option>'
        + emps.map(function(e) {
            return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(maskName(e.name)) + (e.fired ? ' 🚪' : '') + '</option>';
        }).join('');
    sel.value = selected || '';
}
function _renderTeamMembers(deptId, selectedIds) {
    var list = $('teamMembersList'); if (!list) return;
    var hint = $('teamMembersHint');
    selectedIds = selectedIds || [];
    var emps = state.employees;
    if (deptId) emps = emps.filter(function(e) { return e.department_id === deptId; });
    if (!emps.length) {
        list.innerHTML = '<div class="dict-empty" style="padding:10px;">' + (deptId ? 'В отделе нет сотрудников' : 'Выберите отдел') + '</div>';
        if (hint) hint.textContent = '';
        return;
    }
    if (hint) hint.textContent = 'Отметьте сотрудников команды';

    var headSet = {};
    (state.departments || []).forEach(function(d) {
        if (d.head_employee_id) headSet[d.head_employee_id] = true;
    });

    var heads = [], others = [];
    emps.forEach(function(e) {
        if (headSet[e.id]) heads.push(e);
        else others.push(e);
    });

    function _itm(e, badge) {
        var checked = selectedIds.indexOf(e.id) !== -1 ? ' checked' : '';
        return '<label class="assignees-item">'
            + '<input type="checkbox" value="' + escapeHtml(e.id) + '"' + checked + '>'
            + '<span class="assignees-dot" style="background:' + escapeHtml(e.color || '#888') + ';"></span>'
            + '<span class="assignees-name">' + escName(e.name) + (e.fired ? ' 🚪' : '') + '</span>'
            + (badge ? '<span class="assignees-badge">' + badge + '</span>' : '')
            + '</label>';
    }
    function _grp(icon, title, arr, badge, cls) {
        if (!arr.length) return '';
        return '<div class="assignees-group ' + cls + '">'
            + '<div class="assignees-group-title">'
            +   '<span class="assignees-group-icon">' + icon + '</span>'
            +   '<span class="assignees-group-name">' + title + '</span>'
            +   '<span class="assignees-group-count">' + arr.length + '</span>'
            + '</div>'
            + arr.map(function(e) { return _itm(e, badge); }).join('')
            + '</div>';
    }

    list.innerHTML =
        _grp('👑', 'Руководители отделов', heads, 'Нач. отдела', 'asg-heads') +
        _grp('👤', 'Сотрудники', others, '', 'asg-others');
}
on('team_department', 'change', function() {
    _renderTeamManagers(this.value, '');
    _renderTeamMembers(this.value, []);
});
function saveTeam() {
    var name = $('team_name') ? $('team_name').value.trim() : '';
    if (!name) { notify('❌ Укажите название', 'error'); return; }
    var deptId = $('team_department') ? $('team_department').value : '';
    if (!deptId) { notify('❌ Выберите отдел', 'error'); return; }
    var managerId = $('team_manager') ? $('team_manager').value : '';
    var members = [];
    var ml = $('teamMembersList');
    if (ml) ml.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) {
        members.push(cb.value);
    });
    if (managerId && members.indexOf(managerId) === -1) members.push(managerId);
    var payload = {
        id: $('team_id') ? ($('team_id').value || '') : '',
        name: name,
        department_id: deptId,
        manager_id: managerId,
        member_ids: members,
    };
    apiJson('/api/tracker/team/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        var m = $('teamModal'); if (m) m.classList.remove('active');
        notify('✅ Сохранено');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function deleteTeam(id) {
    var tm = state.teams.find(function(x) { return x.id === id; });
    if (!tm) return;
    if (!confirm('Удалить команду «' + tm.name + '»?')) return;
    apiJson('/api/tracker/team/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: id })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('saveTeamBtn', 'click', saveTeam);
on('addTeamBtn', 'click', function() { openTeamModal(null); });

/* ============================================================
   ЗАДАЧИ CRUD + ТЕГИ
   ============================================================ */
function renderTaskDepartmentsList(selectedIds) {
    var list = $('taskDepartmentsList'); if (!list) return;
    selectedIds = selectedIds || [];
    var deps = state.departments || [];
    if (!deps.length) {
        list.innerHTML = '<div class="dict-empty" style="padding:10px;">Нет отделов</div>';
        return;
    }
    list.innerHTML = deps.map(function(d) {
        var checked = selectedIds.indexOf(d.id) !== -1 ? ' checked' : '';
        return '<label class="dept-multi-item"><input type="checkbox" value="' + escapeHtml(d.id) + '"' + checked + '>'
            + '<span class="dept-multi-dot" style="background:' + escapeHtml(d.color || '#7a9ab5') + ';"></span>'
            + '<span>' + escapeHtml(d.name) + '</span></label>';
    }).join('');
    list.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
        cb.addEventListener('change', function() {
            renderAssigneesList(getSelectedAssignees(), getSelectedTaskDepartments());
            renderTaskLead();
        });
    });
}
function getSelectedTaskDepartments() {
    var list = $('taskDepartmentsList'); if (!list) return [];
    var out = [];
    list.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) { out.push(cb.value); });
    return out;
}
function renderAssigneesList(selectedIds, deptIds) {
    var list = $('taskAssigneesList'); if (!list) return;
    var hint = $('taskAssigneesHint');
    if (!state.employees.length) {
        list.innerHTML = '<div class="dict-empty" style="padding:10px;">Сначала добавьте сотрудников</div>';
        if (hint) hint.textContent = '';
        return;
    }
    selectedIds = selectedIds || [];
    deptIds = deptIds || [];
    var emps = state.employees;
    if (deptIds.length) {
        emps = emps.filter(function(e) { return deptIds.indexOf(e.department_id) !== -1; });
        if (hint) hint.textContent = 'Показаны сотрудники из выбранных отделов (' + deptIds.length + ')';
    } else {
        if (hint) hint.textContent = 'Отметьте отделы выше, чтобы сузить список';
    }
    if (!emps.length) {
        list.innerHTML = '<div class="dict-empty" style="padding:10px;">В выбранных отделах нет сотрудников</div>';
        return;
    }

    var headSet = {};
    (state.departments || []).forEach(function(d) {
        if (d.head_employee_id) headSet[d.head_employee_id] = true;
    });
    var mgrSet = {};
    (state.teams || []).forEach(function(t) {
        if (t.manager_id && !headSet[t.manager_id]) mgrSet[t.manager_id] = true;
    });

    var heads = [], managers = [], others = [];
    emps.forEach(function(e) {
        if (headSet[e.id]) heads.push(e);
        else if (mgrSet[e.id]) managers.push(e);
        else others.push(e);
    });

    function _deptName(e) {
        var d = (state.departments || []).find(function(x) { return x.id === e.department_id; });
        return d ? d.name : '';
    }
    function _item(e, badge) {
        var checked = selectedIds.indexOf(e.id) !== -1 ? ' checked' : '';
        var dn = _deptName(e);
        return '<label class="assignees-item">'
            + '<input type="checkbox" value="' + escapeHtml(e.id) + '"' + checked + '>'
            + '<span class="assignees-dot" style="background:' + escapeHtml(e.color || '#888') + ';"></span>'
            + '<span class="assignees-name">' + escName(e.name) + (e.fired ? ' 🚪' : '') + '</span>'
            + (badge ? '<span class="assignees-badge">' + badge + '</span>' : '')
            + (dn && !deptIds.length ? '<span class="assignees-dept">' + escapeHtml(dn) + '</span>' : '')
            + '</label>';
    }
    function _group(icon, title, arr, badge, cls) {
        if (!arr.length) return '';
        return '<div class="assignees-group ' + cls + '">'
            + '<div class="assignees-group-title">'
            +   '<span class="assignees-group-icon">' + icon + '</span>'
            +   '<span class="assignees-group-name">' + title + '</span>'
            +   '<span class="assignees-group-count">' + arr.length + '</span>'
            + '</div>'
            + arr.map(function(e) { return _item(e, badge); }).join('')
            + '</div>';
    }

    list.innerHTML =
        _group('👑', 'Руководители отделов', heads, 'Нач. отдела', 'asg-heads') +
        _group('⭐', 'Руководители команд', managers, 'Менеджер', 'asg-managers') +
        _group('👤', 'Сотрудники', others, '', 'asg-others');
}
/* PATCH tasks-lead: руководитель проверки (банк из участников + сотрудник из банка) */
function renderTaskLead(selDep, selEmp) {
    var depSel = $('task_lead_department');
    var empSel = $('task_lead_employee');
    if (!depSel || !empSel) return;
    var chosen = getSelectedTaskDepartments();           // выбранные банки-участники
    var deps = (state.departments || []).filter(function(d){ return chosen.indexOf(d.id) !== -1; });
    // банк-руководитель
    var curDep = (typeof selDep !== 'undefined' && selDep !== null) ? selDep : depSel.value;
    if (chosen.indexOf(curDep) === -1) curDep = '';
    if (!deps.length) {
        depSel.innerHTML = '<option value="">— сначала выберите банки-участники —</option>';
        depSel.value = ''; depSel.disabled = true;
    } else {
        depSel.disabled = false;
        depSel.innerHTML = '<option value="">— выберите банк —</option>'
            + deps.map(function(d){
                return '<option value="' + escapeHtml(d.id) + '">' + escapeHtml(d.name) + '</option>';
              }).join('');
        depSel.value = curDep || '';
    }
    depSel.classList.remove('lead-invalid');
    // сотрудник-руководитель: из выбранного банка-руководителя
    renderTaskLeadEmployees((typeof selEmp !== 'undefined') ? selEmp : empSel.value);
}
function renderTaskLeadEmployees(selEmp) {
    var depSel = $('task_lead_department');
    var empSel = $('task_lead_employee');
    if (!depSel || !empSel) return;
    var dep = depSel.value;
    if (!dep) {
        empSel.innerHTML = '<option value="">— сначала выберите банк —</option>';
        empSel.value = ''; empSel.disabled = true;
        return;
    }
    var emps = (state.employees || []).filter(function(e){ return e.department_id === dep; });
    empSel.disabled = false;
    empSel.innerHTML = '<option value="">— не назначен —</option>'
        + emps.map(function(e){
            return '<option value="' + escapeHtml(e.id) + '">' + escName(e.name) + (e.fired ? ' 🚪' : '') + '</option>';
          }).join('');
    empSel.value = (selEmp && emps.some(function(e){return e.id===selEmp;})) ? selEmp : '';
}
on('task_lead_department', 'change', function(){ renderTaskLeadEmployees(''); this.classList.remove('lead-invalid'); });

function getSelectedAssignees() {
    var list = $('taskAssigneesList'); if (!list) return [];
    var out = [];
    list.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb) { out.push(cb.value); });
    return out;
}
function renderTagPills() {
    var box = $('taskTagsBox'); if (!box) return;
    var input = $('task_tags_input');
    box.querySelectorAll('.tag-pill').forEach(function(p) { p.remove(); });
    _tagDraft.forEach(function(tag, i) {
        var pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.innerHTML = '#' + escapeHtml(tag) + '<button type="button" class="tag-x" data-i="' + i + '">×</button>';
        box.insertBefore(pill, input);
    });
    box.querySelectorAll('.tag-x').forEach(function(b) {
        b.addEventListener('click', function() {
            var idx = parseInt(this.getAttribute('data-i'), 10);
            _tagDraft.splice(idx, 1);
            renderTagPills();
        });
    });
    if (input) {
        box.onclick = function(e) { if (e.target === box) input.focus(); };
    }
}
function addTag(tag) {
    tag = String(tag || '').trim().replace(/^#+/, '').replace(/\s+/g, '_').toLowerCase();
    if (!tag) return;
    if (tag.length > 32) tag = tag.slice(0, 32);
    if (_tagDraft.indexOf(tag) !== -1) return;
    if (_tagDraft.length >= 15) return;
    _tagDraft.push(tag);
    renderTagPills();
}
on('task_tags_input', 'keydown', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTag(this.value);
        this.value = '';
    } else if (e.key === 'Backspace' && !this.value && _tagDraft.length) {
        _tagDraft.pop();
        renderTagPills();
    }
});
on('tagPresets', 'click', function(e) {
    var b = e.target.closest('.tag-preset-btn');
    if (!b) return;
    addTag(b.getAttribute('data-tag'));
});
function syncTaskCompletedAt() {
    var st = $('task_status'); if (!st) return;
    var field = $('task_completed_at');
    var hint = $('taskCompletionHint');
    if (!field) return;
    var enabled = (st.value === 'done' || st.value === 'archived');
    field.disabled = !enabled;
    // PATCH v1.0.14: при переходе в done/archived, если поле пустое,
    // подставляем сегодня. Админ может очистить — тогда задача
    // закроется без даты (бэкенд значение не перезапишет).
    if (enabled && !field.value) {
        var _d = new Date();
        var _y = _d.getFullYear();
        var _m = String(_d.getMonth() + 1).padStart(2, '0');
        var _dd = String(_d.getDate()).padStart(2, '0');
        field.value = _y + '-' + _m + '-' + _dd;
    }
    if (hint) {
        hint.textContent = enabled
            ? 'Дата админ-закрытия. Оставьте пустой, чтобы закрыть задачу без даты. Снимает просрочку со всех исполнителей.'
            : 'Доступно при статусе «Выполнена» / «Архив».';
    }
    if (!enabled) field.value = '';
}
// === Этапы задачи (зеркало backend db.py TASK_STAGE_*) ===============
var TASK_STAGE_ORDER = [
    'подготовка','проверка_нжя','проверка_соглЦА','ос_проф',
    'реализация_возражения','реализация_согласования','запас','оценка_тб'
];
var TASK_STAGE_LABELS = {
    'подготовка':'Подготовка','проверка_нжя':'Проверка НЖЯ',
    'проверка_соглЦА':'Проверка согл. ЦА','ос_проф':'ОС проф.',
    'реализация_возражения':'Реализация возражения',
    'реализация_согласования':'Реализация согласования',
    'запас':'Запас','оценка_тб':'Оценка ТБ'
};
var TASK_STAGE_COLORS = {
    'подготовка':'#5dade2','проверка_нжя':'#48c9b0','проверка_соглЦА':'#58d68d',
    'ос_проф':'#f4d03f','реализация_возражения':'#eb984e',
    'реализация_согласования':'#e59866','запас':'#af7ac5','оценка_тб':'#ec7063'
};
var _taskStagesDraft = {};

function _stageDayShift(ds, delta) {
    if (!ds) return '';
    var d = new Date(ds + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + delta);
    var mm = ('0' + (d.getMonth()+1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
}
function _stageEnd(idx) {
    var startKey = TASK_STAGE_ORDER[idx];
    if (!_taskStagesDraft[startKey]) return '';
    for (var j = idx + 1; j < TASK_STAGE_ORDER.length; j++) {
        if (_taskStagesDraft[TASK_STAGE_ORDER[j]]) {
            return _stageDayShift(_taskStagesDraft[TASK_STAGE_ORDER[j]], -1);
        }
    }
    var dl = $('task_deadline') ? $('task_deadline').value.trim() : '';
    return dl || '';
}
function _fillPocketOptions() {
    var sel = $('task_pocket');
    if (!sel || sel.tagName !== 'SELECT') return;
    var dir = $('task_type') ? $('task_type').value : '';
    var cur = sel.getAttribute('data-cur');
    if (cur === null) cur = sel.value || '';
    var _py = (($('task_start_date') && $('task_start_date').value) || '').slice(0, 4) || String(new Date().getFullYear());
    var list = window.trkPocketsFor ? window.trkPocketsFor(dir, _py) : (window.__trkPocketList || state.pockets || []).filter(function(p) { return p.direction === dir && p.is_active; });
    var h = '<option value="">— вне кармана —</option>', found = !cur;
    list.forEach(function(p) { if (p.name === cur) found = true; h += '<option value="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</option>'; });
    // Старое значение проверки, которого нет в справочнике, показываем, чтобы не потерять его молча
    if (!found) h += '<option value="' + escapeHtml(cur) + '">' + escapeHtml(cur) + ' (нет в справочнике)</option>';
    sel.innerHTML = h;
    sel.value = cur;
    sel.removeAttribute('data-cur');
    sel.disabled = !dir || !!($('task_type') && $('task_type').disabled);
    var hint = $('taskPocketHint');
    if (hint) hint.textContent = !dir ? 'Сначала выберите направление.'
        : (list.length ? 'Открытые карманы направления «' + dir + '» на ' + _py + ' год (по дате начала). Новые задаются в «🗂 Карманы → 📋 Справочник и планы».'
                       : 'На ' + _py + ' год для направления «' + dir + '» карманов нет — добавьте их в «🗂 Карманы → 📋 Справочник и планы».');
}
window.trkFillPocketOptions = _fillPocketOptions;
document.addEventListener('change', function(e) { if (e.target && e.target.id === 'task_start_date') { _fillPocketOptions(); return; } if (e.target && e.target.id === 'task_type') { var s = $('task_pocket'); if (s) s.setAttribute('data-cur', ''); _fillPocketOptions(); } });

// Нижняя граница для начала этапа idx: начало ближайшего ЗАПОЛНЕННОГО
// предыдущего этапа (этап не может идти раньше предшественника),
// иначе — дата начала задачи.
function _stageMinStart(idx) {
    for (var j = idx - 1; j >= 0; j--) {
        if (_taskStagesDraft[TASK_STAGE_ORDER[j]]) {
            return _stageDayShift(_taskStagesDraft[TASK_STAGE_ORDER[j]], 1);
        }
    }
    var sd = $('task_start_date') ? $('task_start_date').value.trim() : '';
    return sd || '';
}
// Верхняя граница для начала этапа idx: начало ближайшего ЗАПОЛНЕННОГО
// следующего этапа минус 1 день (нельзя наехать), иначе — дедлайн задачи.
function _stageMaxStart(idx) {
    for (var j = idx + 1; j < TASK_STAGE_ORDER.length; j++) {
        if (_taskStagesDraft[TASK_STAGE_ORDER[j]]) {
            return _stageDayShift(_taskStagesDraft[TASK_STAGE_ORDER[j]], -1);
        }
    }
    var dl = $('task_deadline') ? $('task_deadline').value.trim() : '';
    return dl || '';
}
// Проверка пересечений/нарушения порядка по текущему черновику.
// Возвращает массив индексов конфликтных этапов (пусто = всё ок).
function _taskStagesConflicts() {
    var bad = {};
    var prevIdx = -1;
    for (var i = 0; i < TASK_STAGE_ORDER.length; i++) {
        var s = _taskStagesDraft[TASK_STAGE_ORDER[i]];
        if (!s) continue;
        if (prevIdx >= 0) {
            var ps = _taskStagesDraft[TASK_STAGE_ORDER[prevIdx]];
            // следующий заполненный этап обязан начинаться ПОЗЖE предыдущего
            if (s <= ps) { bad[i] = 1; bad[prevIdx] = 1; }
        }
        prevIdx = i;
    }
    return Object.keys(bad).map(function(k){ return parseInt(k,10); });
}
function renderTaskStages() {
    var box = $('taskStagesList');
    if (!box) return;
    var conflicts = {};
    _taskStagesConflicts().forEach(function(i){ conflicts[i] = 1; });
    var html = '';
    TASK_STAGE_ORDER.forEach(function(key, idx) {
        var start = _taskStagesDraft[key] || '';
        var end = _stageEnd(idx);
        var col = TASK_STAGE_COLORS[key] || '#888';
        var isLast = (idx === TASK_STAGE_ORDER.length - 1);
        var minS = _stageMinStart(idx);
        var maxS = _stageMaxStart(idx);
        var minAttr = minS ? ' min="' + minS + '"' : '';
        var maxAttr = maxS ? ' max="' + maxS + '"' : '';
        var rowCls = 'task-stage-row' + (conflicts[idx] ? ' task-stage-conflict' : '');
        var checked = (start !== '' || (idx===1 && !start && !_taskStagesDraft[key])) ? ' checked' : ''; // default проверка_нжя
        html += '<div class="' + rowCls + '">';
        html +=   '<label class="task-stage-check"><input type="checkbox" class="task-stage-active" data-stage="' + key + '"' + checked + '></label>';
        html +=   '<span class="task-stage-chip" style="background:' + col + '"></span>';
        html +=   '<span class="task-stage-name">' + escapeHtml(TASK_STAGE_LABELS[key] || key) + '</span>';
        html +=   '<label class="task-stage-f">\u043d\u0430\u0447. <input type="date" class="task-stage-start" data-stage="' + key + '" data-stage-idx="' + idx + '" value="' + start + '"' + minAttr + maxAttr + '></label>';
        var endMin = start ? ' min="' + _stageDayShift(start, 1) + '"' : '';
        var endMax = maxS ? ' max="' + _stageDayShift(maxS, 1) + '"' : '';
        html +=   '<label class="task-stage-f">\u043a\u043e\u043d. <input type="date" class="task-stage-end" data-stage-idx="' + idx + '" value="' + end + '"' + (isLast ? ' disabled' : endMin + endMax) + '></label>';
        html += '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.task-stage-active').forEach(function(cb) {
        var row = cb.closest('.task-stage-row');
        if (!cb.checked) row.classList.add('task-stage-disabled');
        cb.addEventListener('change', function() {
            var key = this.getAttribute('data-stage');
            if (this.checked) {
                // Инициализация при включении (базовая заглушка, чтобы появился start, если пусто)
                _taskStagesDraft[key] = $('task_start_date') ? $('task_start_date').value || todayISO() : todayISO();
            } else {
                _taskStagesDraft[key] = ''; // отключаем этап = нет старта
            }
            renderTaskStages();
        });
    });
    box.querySelectorAll('.task-stage-start').forEach(function(inp){
        inp.addEventListener('change', function(){
            var key = this.getAttribute('data-stage');
            var idx = parseInt(this.getAttribute('data-stage-idx'), 10);
            var val = this.value || '';
            // клип-защита от ручного ввода мимо границ календаря
            if (val) {
                var lo = _stageMinStart(idx), hi = _stageMaxStart(idx);
                if (lo && val < lo) val = lo;
                if (hi && val > hi) val = hi;
            }
            _taskStagesDraft[key] = val;
            renderTaskStages();
        });
    });
    box.querySelectorAll('.task-stage-end').forEach(function(inp){
        inp.addEventListener('change', function(){
            var idx = parseInt(this.getAttribute('data-stage-idx'), 10);
            var nextKey = TASK_STAGE_ORDER[idx+1];
            if (!nextKey) return;
            // правка конца = начало следующего этапа (конец + 1 день), с клипом
            var ns = this.value ? _stageDayShift(this.value, 1) : '';
            if (ns) {
                var hi = _stageMaxStart(idx+1);
                var lo = _stageMinStart(idx+1);
                if (hi && ns > hi) ns = hi;
                if (lo && ns < lo) ns = lo;
            }
            _taskStagesDraft[nextKey] = ns;
            renderTaskStages();
        });
    });
}

function openTaskKindChooser() {
    if (!(state.currentUser && state.currentUser.role === 'admin')) { notify('Создание задач доступно только администратору', 'error'); return; }
    var m = $('taskKindModal'); if (!m) return;
    var main = m.querySelector('.task-kind-choices'), sub = $('taskKindOtherBox');
    if (main) main.style.display = 'flex';
    if (sub) sub.style.display = 'none';
    m.classList.add('active');
}
/* ---- Ретро-данные: предупреждение при правке прошлых дат ---- */
window.trkRetroConfirm = function(dates) {
    var today = (state && state.today) || todayISO();
    var past = (dates || []).filter(function(d) { return d && String(d).slice(0, 10) < today; });
    if (!past.length) return true;
    return window.confirm('В проверках не предусмотрена правка ретро-данных. Уверены, что хотите продолжить?');
};
/* Даты, которые меняются при сохранении (и старое, и новое значение) */
window.trkChangedDates = function(orig, next) {
    var out = [];
    function cmp(a, b) { a = a || ''; b = b || ''; if (a !== b) { if (a) out.push(a); if (b) out.push(b); } }
    orig = orig || {};
    cmp(orig.start_date, next.start_date);
    cmp(orig.deadline, next.deadline);
    var os = {};
    (Array.isArray(orig.stages) ? orig.stages : []).forEach(function(x) { if (x && x.key) os[x.key] = x.start || ''; });
    if (orig.stages && !Array.isArray(orig.stages)) os = orig.stages;
    var ns = next.stages || {};
    if (Array.isArray(ns)) { var o2 = {}; ns.forEach(function(x) { if (x && x.key) o2[x.key] = x.start || ''; }); ns = o2; }
    Object.keys(Object.assign({}, os, ns)).forEach(function(k) { cmp(os[k], ns[k]); });
    var op = JSON.stringify(_trkTaskPeriods(orig)), np = JSON.stringify(next.periods || []);
    if (next.periods && op !== np) {
        _trkTaskPeriods(orig).concat(next.periods).forEach(function(p) { out.push(p.start); out.push(p.end); });
    }
    if (!orig.id) {  // новая задача: любые даты в прошлом
        out = [next.start_date, next.deadline].concat(Object.keys(ns).map(function(k) { return ns[k]; }));
        (next.periods || []).forEach(function(p) { out.push(p.start); });
    }
    return out;
};
function _trkTaskPeriods(t) {
    if (!t) return [];
    if (Array.isArray(t.periods)) return t.periods;
    try { var v = JSON.parse(t.periods_json || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
window._trkTaskPeriods = _trkTaskPeriods;
window.openTaskKindChooser = function() { return openTaskKindChooser(); };
window.__trkPeriodsApi = { get: function() { return _taskPeriodsDraft; }, set: function(v) { _taskPeriodsDraft = v; renderTaskPeriods(); } };
window.__trkOpenTaskModal = function(t, k) { return openTaskModal(t, k); };
/* ---- «Другое»: подвиды и периоды ---- */
var _taskPeriodsDraft = [];
var TRK_OTHER_SUB = { audit_extra: '🧩 Доп. задача в проверке', ck: '🎯 Задача по ЦК', other: '📌 Другое' };
function renderTaskPeriods() {
    var box = $('taskPeriodsList'); if (!box) return;
    if (!_taskPeriodsDraft.length) _taskPeriodsDraft = [{ start: '', end: '' }];
    box.innerHTML = _taskPeriodsDraft.map(function(p, i) {
        return '<div class="tk-period-row" data-i="' + i + '">'
            + '<span class="tk-period-n">' + (i + 1) + '</span>'
            + '<input type="date" data-k="start" value="' + escapeHtml(p.start || '') + '">'
            + '<span class="tk-period-dash">—</span>'
            + '<input type="date" data-k="end" value="' + escapeHtml(p.end || '') + '">'
            + (_taskPeriodsDraft.length > 1 ? '<button type="button" class="tk-period-del" title="Удалить период">✕</button>' : '')
            + '</div>';
    }).join('');
    box.querySelectorAll('input').forEach(function(inp) {
        inp.addEventListener('change', function() {
            var i = +this.closest('.tk-period-row').getAttribute('data-i');
            _taskPeriodsDraft[i][this.getAttribute('data-k')] = this.value;
        });
    });
    box.querySelectorAll('.tk-period-del').forEach(function(b) {
        b.addEventListener('click', function() {
            _taskPeriodsDraft.splice(+this.closest('.tk-period-row').getAttribute('data-i'), 1);
            renderTaskPeriods();
        });
    });
}
function _collectTaskPeriods() {
    var out = [], err = '';
    _taskPeriodsDraft.forEach(function(p, i) {
        if (!p.start && !p.end) return;
        var a = p.start || p.end, b = p.end || p.start;
        if (b < a) err = 'Период ' + (i + 1) + ': конец раньше начала';
        out.push({ start: a, end: b });
    });
    out.sort(function(x, y) { return x.start < y.start ? -1 : 1; });
    for (var i = 1; i < out.length; i++) if (out[i].start <= out[i - 1].end) err = 'Периоды пересекаются';
    return { periods: out, error: err };
}
function _applyOtherSubUI(sub, parentId) {
    var hs = $('task_other_subkind'); if (hs) hs.value = sub || '';
    var hp = $('task_parent_id'); if (hp) hp.value = parentId || '';
    var info = $('taskOtherInfo');
    if (info) {
        var par = parentId ? (state.tasks || []).find(function(x) { return x.id === parentId; }) : null;
        info.innerHTML = '<b>' + escapeHtml(TRK_OTHER_SUB[sub] || TRK_OTHER_SUB.other) + '</b>'
            + (sub === 'audit_extra' ? ' · проверка: <b>' + escapeHtml(par ? par.name : '— не выбрана —') + '</b>'
              + '<br><span class="assignees-hint">Нагрузка добавляется банкам проверки (можно оставить часть банков). Этапов нет — нагрузку в неделю задаёт пользователь.</span>' : '');
    }
}
/* Показ/скрытие полей карточки по виду задачи: 'audit' | 'other'. */
function applyTaskKindUI(kind) {
    var isOther = (kind === 'other');
    var _tm = document.getElementById('taskModal'); if (_tm) _tm.classList.toggle('tk-kind-other', isOther);
    document.querySelectorAll('#taskModal .tk-audit-only').forEach(function(el) {
        el.style.display = isOther ? 'none' : '';
    });
    document.querySelectorAll('#taskModal .tk-other-only').forEach(function(el) {
        el.style.display = isOther ? '' : 'none';
    });
    /* Straховка от кеша/рассинхрона разметки: для 'other' принудительно
       прячем и обнуляем поля, которых у этого вида задач нет -
       срочность, тип задачи, карман. */
    ['task_start_date', 'task_deadline'].forEach(function(id) {
        var el = document.getElementById(id), w = el && el.closest('.form-group');
        if (w) w.style.display = isOther ? 'none' : '';
    });
    var hideById = ['task_is_urgent', 'task_type', 'task_pocket'];
    hideById.forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var wrap = el.closest('.form-row') || el.closest('.task-urgent-row') || el.closest('.form-group');
        if (wrap) wrap.style.display = isOther ? 'none' : '';
        if (isOther) {
            if (el.type === 'checkbox') el.checked = false;
            else el.value = '';
        }
    });
}
/* Открывает карточку проверки по id (сводка, колокольчик). Окно «Карточка (статистика)» больше не используется. */
window.openTaskModal = function(t, k) { return openTaskModal(t, k); };
window.trkOpenTaskById = function(id) {
    var t = (state.tasks || []).find(function(x) { return String(x.id) === String(id); });
    if (!t) { notify('Задача не найдена', 'error'); return; }

    trkOpenTaskSmart(t);
};
function openTaskModal(task, forceKind) {
    task = task || null;
    var kind = forceKind || (task && task.task_kind) || 'audit';
    if (kind !== 'other') kind = 'audit';
    var _kindEl = $('task_kind'); if (_kindEl) _kindEl.value = kind;
    var titleTxt = task
        ? (kind === 'other' ? 'Редактировать задачу' : 'Карточка аудиторской проверки')
        : (kind === 'other' ? 'Новая задача' : 'Карточка аудиторской проверки');
    var t = $('taskModalTitle'); if (t) t.textContent = titleTxt;
    var g = function(id, v) { var el = $(id); if (el) el.value = v; };
    g('task_id', task ? task.id : '');
    g('task_load_coef', (task && task.load_coef) ? task.load_coef : '');
    applyTaskKindUI(kind);
    var iconVal = window.trkQuarterValue(task && task.icon);
    window.trkEnsureQuarterOption(iconVal);
    g('task_icon', iconVal);
    var prev = $('taskIconPreview'); if (prev) prev.textContent = iconVal;
    g('task_name', task ? task.name : '');
    g('task_description', (task && task.description) || '');
    g('task_status', (task && task.status) || 'planning');
    g('task_start_date', (task && task.start_date) || '');
    g('task_deadline', (task && task.deadline) || '');
    g('task_completed_at', (task && task.completed_at) || '');
    g('task_folder', (task && task.folder) || '');
    g('task_order_ref', (task && task.order_ref) || '');
    g('task_curator', (task && task.curator) || '');
    var _curEl0 = $('task_curator');
    if (_curEl0) _curEl0.classList.remove('lead-invalid');
    if (typeof window.__trkFillTaskModalAll === 'function' && (!task || !task.id)) {
        try { window.__trkFillTaskModalAll(task || { status: 'planning', curator: '' }); } catch (e) {}
    }
    // PATCH v1.0.18: чекбокс «очень срочная»
    var _urgCb = $('task_is_urgent');
    if (_urgCb) _urgCb.checked = !!(task && task.is_urgent);
    // PATCH v1.0.19: список ссылок
    _taskLinksDraft = (task && Array.isArray(task.links)) ? task.links.slice() : [];
    renderTaskLinksDraft();
    // PATCH v1.0.32: список приказов
    _taskOrdersDraft = (task && Array.isArray(task.orders)) ? task.orders.slice() : [];
    renderTaskOrdersDraft();
    // PATCH tasks-stages: тип задачи, карман, этапы
    g('task_type', (task && task.task_type) || '');
    var _pkSel = $('task_pocket'); if (_pkSel) _pkSel.setAttribute('data-cur', (task && task.pocket) || '');
    _fillPocketOptions();
    _taskStagesDraft = {};
    if (task && Array.isArray(task.stages)) {
        task.stages.forEach(function(s){
            if (s && s.key) _taskStagesDraft[s.key] = s.start || '';
        });
    } else if (task) {
        TASK_STAGE_ORDER.forEach(function(k){
            var v = task['stage_' + k + '_start'];
            if (v) _taskStagesDraft[k] = v;
        });
    }
    renderTaskStages();

    _tagDraft = (task && task.tags) ? task.tags.slice() : [];
    var ti = $('task_tags_input'); if (ti) ti.value = '';
    renderTagPills();

    var depIds = (task && task.department_ids) ? task.department_ids.slice() : [];
    renderTaskDepartmentsList(depIds);
    renderAssigneesList((task && task.assignees) || [], depIds);
    // PATCH tasks-lead: руководитель проверки
    renderTaskLead((task && task.lead_department) || '', (task && task.lead_employee) || '');
    syncTaskCompletedAt();
    if (kind === 'other') {
        var _pre = window.__trkOtherPreset || null; window.__trkOtherPreset = null;
        var _sub = (task && task.other_subkind) || (_pre && _pre.sub) || 'other';
        var _par = (task && task.parent_task_id) || (_pre && _pre.parent) || '';
        _applyOtherSubUI(_sub, _par);
        _taskPeriodsDraft = _trkTaskPeriods(task).map(function(x) { return { start: x.start, end: x.end }; });
        if (!_taskPeriodsDraft.length && task && (task.start_date || task.deadline)) _taskPeriodsDraft = [{ start: task.start_date || '', end: task.deadline || '' }];
        renderTaskPeriods();
        if (!task && _sub === 'audit_extra' && _par) {
            var _pt = (state.tasks || []).find(function(x) { return x.id === _par; });
            if (_pt) {
                renderTaskDepartmentsList((_pt.department_ids || []).slice());
                renderAssigneesList([], (_pt.department_ids || []).slice());
                g('task_curator', _pt.curator || '');
                var _nm = $('task_name'); if (_nm && !_nm.value) _nm.value = 'Доп. задача: ' + _pt.name;
            }
        }
        var _ttl = $('taskModalTitle');
        if (_ttl && !task) _ttl.textContent = 'Новая задача · ' + (TRK_OTHER_SUB[_sub] || '').replace(/^\S+\s/, '');
    } else { _applyOtherSubUI('', ''); }
    var m = $('taskModal'); if (m) m.classList.add('active');
    setTimeout(function() { var n = $('task_name'); if (n) n.focus(); }, 50);
    if (typeof window.trkApplyTaskLockState === 'function') window.trkApplyTaskLockState(task);
}
/* PATCH task-summary: клик по проверке. «Планирование» (и новая) — сразу карточка редактирования,
   иначе — краткая сводка с карандашом. Полное редактирование вне «Планирования» — только админ. */
window.__trkTaskEditOverride = '';
function _tsumIsAdmin() {
    return !!(state.currentUser && state.currentUser.role === 'admin');
}
function trkOpenTaskSmart(task) {
    window.__trkTaskEditOverride = '';
    var _adm = !!(state.currentUser && state.currentUser.role === 'admin');
    if (!_adm) { if (task && task.id) openTaskSummary(task); else notify('Создание задач доступно только администратору', 'error'); return; }
    if (!task || !task.id || !task.status || task.status === 'planning') { openTaskModal(task); return; }
    openTaskSummary(task);
}
window.trkOpenTaskSmart = trkOpenTaskSmart;
function _tsumDate(iso) { return iso ? escapeHtml(formatDateHuman(iso)) : '—'; }
function _tsumAddDays(iso, n) {
    var p = (iso || '').split('-'); if (p.length !== 3) return '';
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
}
function _tsumEmpName(id) {
    var e = (state.employees || []).find(function(x) { return x.id === id; });
    return e ? escName(e.name) + (e.fired ? ' 🚪' : '') : escapeHtml(id || '');
}
function _tsumDepName(id) {
    var d = (state.departments || []).find(function(x) { return x.id === id; });
    return escapeHtml(d ? d.name : (id || ''));
}
function _tsumStages(task) {
    var map = {};
    if (Array.isArray(task.stages)) task.stages.forEach(function(s) { if (s && s.key && s.start) map[s.key] = s.start; });
    else TASK_STAGE_ORDER.forEach(function(k) { var v = task['stage_' + k + '_start']; if (v) map[k] = v; });
    var keys = TASK_STAGE_ORDER.filter(function(k) { return map[k]; });
    return keys.map(function(k, i) {
        var end = (i < keys.length - 1) ? _tsumAddDays(map[keys[i + 1]], -1) : (task.deadline || '');
        return { key: k, start: map[k], end: end };
    });
}
function _tsumRow(label, valueHtml, empty) {
    return '<div class="tsum-row' + (empty ? ' tsum-row--empty' : '') + '"><div class="tsum-lbl">' + label + '</div><div class="tsum-val">' + valueHtml + '</div></div>';
}
function _tsumSyncActions(task) {
    var hasId = !!(task && task.id);
    var isAdmin = _tsumIsAdmin();
    var isActive = !!(task && task.status === 'active');
    var editBtn = $('tsumEditBtn');
    var extBtn = $('tsumExtendBtn');
    var histBtn = $('tsumHistoryBtn');
    if (editBtn) editBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (extBtn) {
        extBtn.style.display = hasId ? 'inline-flex' : 'none';
        extBtn.disabled = !isActive;
        extBtn.title = isActive ? 'Продлить проверку' : 'Продлить можно только проверку в статусе «Активна»';
    }
    if (histBtn) {
        histBtn.style.display = hasId ? 'inline-flex' : 'none';
        histBtn.disabled = !hasId;
    }
}
function openTaskSummary(task) {
    var m = $('taskSummaryModal'); if (!m || !task) return;
    m.setAttribute('data-task-id', task.id);
    _tsumSyncActions(task);
    _tsumConfirmShow(false);
    $('tsumTitle').textContent = task.name || '—';
    var stLbl = (state.taskStatusLabels && state.taskStatusLabels[task.status]) || task.status || '';
    var q = window.trkQuarterValue ? window.trkQuarterValue(task.icon) : '';
    $('tsumMeta').innerHTML = '<span class="tsum-status tsum-status--' + escapeHtml(task.status || '') + '">' + escapeHtml(stLbl) + '</span>'
        + (q ? '<span class="tsum-quarter">' + escapeHtml(q) + '</span>' : '');
    var isAudit = (task.task_kind || 'audit') !== 'other';
    var h = '';
    // Руководитель и куратор — всегда, даже если не указаны
    if (isAudit) {
        var lead = task.lead_department
            ? _tsumDepName(task.lead_department) + (task.lead_employee ? ' · ' + _tsumEmpName(task.lead_employee) : '')
            : '<span class="tsum-missing">не указан</span>';
        h += _tsumRow('👑 Руководитель', lead, !task.lead_department);
    }
    var cur = (task.curator && task.curator !== 'нет') ? escapeHtml(task.curator) : '<span class="tsum-missing">не указан</span>';
    h += _tsumRow('👤 Куратор ЦА', cur, !(task.curator && task.curator !== 'нет'));
    // Остальное — только непустое
    if (task.task_type) h += _tsumRow('🧭 Направление', escapeHtml(task.task_type.charAt(0).toUpperCase() + task.task_type.slice(1)));
    if (task.pocket) h += _tsumRow('👝 Карман', (task.task_type === 'корпоративная' ? '🏢 ' : task.task_type === 'розничная' ? '👥 ' : '') + escapeHtml(task.pocket));
    var deps = task.department_ids || [];
    if (deps.length) h += _tsumRow('🏦 Банки', '<ul class="tsum-list">' + deps.map(function(d) {
        return '<li>' + _tsumDepName(d) + (d === task.lead_department ? ' <span class="tsum-lead-mark" title="Банк-руководитель">👑</span>' : '') + '</li>';
    }).join('') + '</ul>');
    var asg = task.assignees || [];
    if (asg.length) h += _tsumRow('👥 Участники', '<ul class="tsum-list">' + asg.map(function(a) { return '<li>' + _tsumEmpName(a) + '</li>'; }).join('') + '</ul>');
    // Сроки и этапы — внизу компактно
    var dl = _tsumDate(task.deadline);
    if (task.initial_deadline && task.initial_deadline !== task.deadline) dl += '<div class="tsum-initial">изначальный срок: ' + _tsumDate(task.initial_deadline) + '</div>';
    var dates = '<div class="tsum-dates"><div class="tsum-dates-main">🚀 ' + _tsumDate(task.start_date) + ' → ⏰ ' + dl + '</div>';
    var stg = isAudit ? _tsumStages(task) : [];
    if (stg.length) {
        dates += '<table class="tsum-stages">' + stg.map(function(s) {
            return '<tr><td><span class="tsum-stage-dot" style="background:' + (TASK_STAGE_COLORS[s.key] || '#999') + '"></span>' + escapeHtml(TASK_STAGE_LABELS[s.key] || s.key)
                + '</td><td>' + escapeHtml(formatDateShort(s.start)) + ' – ' + (s.end ? escapeHtml(formatDateShort(s.end)) : '—') + '</td></tr>';
        }).join('') + '</table>';
    }
    dates += '</div>';
    h += '<div class="tsum-section-sep"></div>' + _tsumRow('📅 Сроки', dates);
    $('tsumBody').innerHTML = h;
    m.classList.add('active');
}
window.openTaskSummary = openTaskSummary;
function _tsumCurrentTask() {
    var m = $('taskSummaryModal'); var id = m && m.getAttribute('data-task-id');
    return (state.tasks || []).find(function(x) { return String(x.id) === String(id); }) || null;
}
function _tsumConfirmShow(on) {
    var cf = $('tsumConfirm'); if (!cf) return;
    cf.classList.toggle('active', !!on);
    if (document.body) document.body.classList.toggle('tsum-confirm-open', !!on);
    if (on) { var y = $('tsumConfirmYes'); if (y) setTimeout(function() { try { y.focus(); } catch (e) {} }, 0); }
}
on('tsumEditBtn', 'click', function() { if (!_tsumIsAdmin()) return; _tsumConfirmShow(true); });
on('tsumConfirm', 'click', function(e) { if (e.target === this) _tsumConfirmShow(false); });
document.addEventListener('keydown', function(e) {
    var cf = $('tsumConfirm');
    if (e.key === 'Escape' && cf && cf.classList.contains('active')) { e.stopPropagation(); _tsumConfirmShow(false); }
}, true);
/* PATCH task-history: хронология проверки (статусы, продления, изменения полей) */
var _TH_STATUS = { planning: 'Планирование', approved: 'Утверждена', active: 'Активна', done: 'Завершена', cancelled: 'Отменена', archived: 'Завершена' };
function _thStatus(s) { return (state.taskStatusLabels && state.taskStatusLabels[s]) || _TH_STATUS[s] || s || '—'; }
var _TH_FIELDS = { name: 'Название', status: 'Статус', curator: 'Куратор ЦА', lead_department: 'Банк-руководитель', lead_employee: 'Руководитель (сотрудник)', task_type: 'Направление', pocket: 'Карман', task_kind: 'Вид задачи', icon: 'Завершение', start_date: 'Дата начала', deadline: 'Дедлайн', is_urgent: 'Срочность', load_coef: 'Коэффициент нагрузки', description: 'Описание', department_ids: 'Банки', assignees: 'Участники' };
function _thTs(ts) {
    if (!ts) return '';
    var m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] + (m[4] ? ' ' + m[4] + ':' + m[5] : '') : escapeHtml(ts);
}
function _thVal(field, v) {
    var EMPTY = '<span class="th-empty">—</span>';
    if (v === null || v === undefined || v === '') return EMPTY;
    if (field === 'status') return escapeHtml(_thStatus(v));
    if (field === 'lead_department') return _tsumDepName(v);
    if (field === 'lead_employee') return _tsumEmpName(v);
    if (field === 'start_date' || field === 'deadline' || field === 'stage') return escapeHtml(formatDateShort(v));
    if (field === 'icon') { var q = window.trkQuarterValue ? window.trkQuarterValue(v) : v; return q ? escapeHtml(q) : EMPTY; }
    if (field === 'is_urgent') return (['1', 'true', 'True'].indexOf(String(v)) >= 0) ? 'да' : 'нет';
    if (field === 'task_kind') return v === 'other' ? 'Другое' : 'Аудиторская проверка';
    if (field === 'curator' && v === 'нет') return EMPTY;
    if (field === 'task_type') return escapeHtml(String(v).charAt(0).toUpperCase() + String(v).slice(1));
    return escapeHtml(String(v));
}
function _thChange(c) {
    if (c.field === 'department_ids' || c.field === 'assignees') {
        var nm = c.field === 'department_ids' ? _tsumDepName : _tsumEmpName;
        var parts = [];
        if ((c.added || []).length) parts.push('добавлено: ' + c.added.map(function(x) { return nm(x); }).join(', '));
        if ((c.removed || []).length) parts.push('удалено: ' + c.removed.map(function(x) { return nm(x); }).join(', '));
        return '<b>' + _TH_FIELDS[c.field] + '</b>: ' + parts.join('; ');
    }
    var label = c.field === 'stage'
        ? 'Этап «' + escapeHtml((typeof TASK_STAGE_LABELS !== 'undefined' && TASK_STAGE_LABELS[c.stage]) || c.stage) + '»'
        : escapeHtml(_TH_FIELDS[c.field] || c.field);
    if (c.field === 'description') return '<b>' + label + '</b> изменено';
    return '<b>' + label + '</b>: ' + _thVal(c.field, c.from) + ' → ' + _thVal(c.field, c.to);
}
function _thEvent(e) {
    var d = e.details || {}, icon = '✏️', title = 'Изменена карточка', lines = [], cls = '';
    if (e.kind === 'create') {
        icon = '🆕'; title = 'Проверка создана'; cls = 'th-create';
        if (d.status) lines.push('Статус: ' + _thVal('status', d.status));
        if (d.inferred) lines.push('<span class="th-empty">время из карточки, автор не записан</span>');
    } else if (e.kind === 'extend') {
        icon = '⏳'; title = 'Продление на ' + (parseInt(d.days, 10) || 0) + ' дн.'; cls = 'th-extend';
        lines.push('Дедлайн: ' + _thVal('deadline', d.prev_deadline) + ' → ' + _thVal('deadline', d.new_deadline));
        if (d.comment) lines.push('Комментарий: ' + escapeHtml(d.comment));
    } else if (e.kind === 'task_auto_activate') {
        icon = '▶️'; title = 'Автоматически переведена в «' + escapeHtml(_thStatus('active')) + '»'; cls = 'th-status';
        lines.push('наступила дата начала');
    } else if (e.kind === 'load_override') {
        icon = '✎'; title = 'Нагрузка задана вручную («Текущая загрузка»)'; cls = 'th-extend';
        (d.items || []).forEach(function(it) {
            var fmt = function(v) { return v == null ? 'расчёт' : String(v).replace('.', ','); };
            lines.push(escapeHtml(it.bank_name || it.bank || '') + ', неделя с ' + _thVal('deadline', it.week) + ': ' + fmt(it.from) + ' → ' + fmt(it.to));
        });
    } else if (e.kind === 'merge') {
        icon = '🔗'; title = 'Объединена с другими задачами';
        if ((d.merged_ids || []).length) lines.push('Присоединено задач: ' + d.merged_ids.length);
    } else if (e.kind === 'update' && d.action === 'auto_reopen') {
        icon = '🔄'; title = 'Автоматически возвращена в «' + escapeHtml(_thStatus('active')) + '»'; cls = 'th-status';
        lines.push('исполнитель отменил закрытие');
    } else if (e.kind === 'update') {
        var ch = d.changes;
        if (!Array.isArray(ch)) lines.push('<span class="th-empty">подробности изменений не сохранялись</span>');
        else if (!ch.length) return '';
        else {
            var st = ch.filter(function(c) { return c.field === 'status'; })[0];
            if (st) {
                var ST_ICON = { approved: '✅', active: '▶️', done: '🏁', cancelled: '⛔', planning: '📝' };
                icon = ST_ICON[st.to] || '🔁'; title = 'Статус: ' + escapeHtml(_thStatus(st.to)); cls = 'th-status';
            }
            ch.forEach(function(c) { lines.push(_thChange(c)); });
        }
    } else {
        title = escapeHtml(e.kind || 'событие');
    }
    return '<li class="th-item ' + cls + '"><div class="th-dot">' + icon + '</div><div class="th-main">'
        + '<div class="th-head"><span class="th-title">' + title + '</span><span class="th-ts">' + _thTs(e.ts) + (e.who ? ' · ' + escapeHtml(e.who) : '') + '</span></div>'
        + (lines.length ? '<ul class="th-lines">' + lines.map(function(l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' : '')
        + '</div></li>';
}
function loadTaskDateHistory(taskId) {
    if (!taskId) return;
    var body = $('taskDatesBody'), m = $('taskDatesModal');
    if (!body || !m) return;
    body.innerHTML = '<div class="assignees-hint">Загрузка…</div>';
    m.setAttribute('data-task-id', taskId);
    m.classList.add('active');
    fetch('/api/tracker/task/history?id=' + encodeURIComponent(taskId), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d || !d.success) {
                body.innerHTML = '<div class="assignees-hint">Не удалось загрузить историю' + (d && d.error ? ': ' + escapeHtml(d.error) : '') + '</div>';
                return;
            }
            var t = d.task || {};
            var head = '<div class="th-summary"><b>' + escapeHtml(t.name || '') + '</b><div>🚀 ' + _thVal('start_date', t.start_date) + ' → ⏰ ' + _thVal('deadline', t.deadline)
                + (t.initial_deadline && t.initial_deadline !== t.deadline ? ' <span class="th-empty">(изначально ' + _thVal('deadline', t.initial_deadline) + ')</span>' : '')
                + '</div></div>';
            var items = (d.events || []).map(_thEvent).filter(Boolean);
            body.innerHTML = head + (items.length ? '<ol class="th-list">' + items.join('') + '</ol>' : '<div class="assignees-hint">Событий пока нет.</div>');
        })
        .catch(function() { body.innerHTML = '<div class="assignees-hint">Ошибка сети при загрузке истории</div>'; });
}
window.loadTaskDateHistory = loadTaskDateHistory;
window.trkApiJson = apiJson;
window.trkNotify = notify;
/* Сообщение по центру экрана (поверх всех окон), исчезает само или по клику */
window.trkShowCenterMsg = function(text, ms) {
    var el = document.getElementById('trkCenterMsg');
    if (!el) {
        el = document.createElement('div');
        el.id = 'trkCenterMsg'; el.className = 'trk-center-msg'; el.setAttribute('role', 'status');
        el.addEventListener('click', function() { el.classList.remove('active'); });
        document.body.appendChild(el);
    }
    el.innerHTML = '<div class="trk-center-msg-box">' + escapeHtml(text) + '</div>';
    el.classList.add('active');
    clearTimeout(window.__trkCenterMsgT);
    window.__trkCenterMsgT = setTimeout(function() { el.classList.remove('active'); }, ms || 2200);
};
window.trkReopenTaskSummary = function(id) {
    var t = (state.tasks || []).find(function(x) { return String(x.id) === String(id); });
    if (t) openTaskSummary(t);
};
on('tsumHistoryBtn', 'click', function() {
    var t = _tsumCurrentTask();
    if (!t || !t.id) return;
    if (typeof loadTaskDateHistory === 'function') loadTaskDateHistory(t.id);
});
on('tsumExtendBtn', 'click', function() {
    var t = _tsumCurrentTask();
    if (!t || !t.id || t.status !== 'active') return;
    var em = $('extendTaskModal');
    if (em) em.setAttribute('data-task-id', t.id);
    var days = $('extendDays'); if (days) days.value = 7;
    var comment = $('extendComment'); if (comment) comment.value = '';
    if (typeof openModal === 'function') openModal('extendTaskModal');
    else if (em) em.classList.add('active');
    if (document && document.body) document.body.classList.add('trk-side-panel-open');
});
on('tsumConfirmNo', 'click', function() { _tsumConfirmShow(false); });
on('tsumConfirmYes', 'click', function() {
    var t = _tsumCurrentTask();
    _tsumConfirmShow(false);
    var m = $('taskSummaryModal'); if (m) m.classList.remove('active');
    if (!t) return;
    if (_tsumIsAdmin()) {
        window.__trkTaskEditOverride = String(t.id);
    } else {
        window.__trkTaskEditOverride = '';
        notify('Редактировать проверку вне статуса «Планирование» может только администратор. Карточка открыта в режиме просмотра.', 'info');
    }
    openTaskModal(t);
});
function saveTask() {
    var name = $('task_name') ? $('task_name').value.trim() : '';
    if (!name) { notify('❌ Укажите название', 'error'); return; }
    var _curatorEl = $('task_curator');
    var _curator = _curatorEl ? (_curatorEl.value || '').trim() : '';
    if (!_curator) {
        notify('❌ Укажите ответственного (куратора ЦА)', 'error');
        if (_curatorEl) { _curatorEl.classList.add('lead-invalid'); _curatorEl.focus(); }
        return;
    }
    if (_curatorEl) _curatorEl.classList.remove('lead-invalid');
    var _taskKind = $('task_kind') ? ($('task_kind').value || 'audit') : 'audit';
    var _isOther = (_taskKind === 'other');
    var _leadDep = '';
    var _loadCoef = 0;
    if (_isOther) {
        // «Другое»: этапы/руководитель не нужны; обязателен коэффициент нагрузки.
        var _lcEl = $('task_load_coef');
        var _lcRaw = _lcEl ? (_lcEl.value || '').trim().replace(',', '.') : '';
        _loadCoef = parseFloat(_lcRaw);
        if (!_lcRaw || isNaN(_loadCoef) || _loadCoef <= 0) {
            notify('❌ Укажите коэффициент нагрузки (число больше нуля)', 'error');
            if (_lcEl) { _lcEl.classList.add('lead-invalid'); _lcEl.focus(); }
            return;
        }
        // Задача «Другое» обязана иметь хотя бы одного сотрудника
        // (её коэффициент нагрузки привязан к назначенным людям).
        var _subk = $('task_other_subkind') ? $('task_other_subkind').value : '';
        if (_subk === 'audit_extra' && !($('task_parent_id') && $('task_parent_id').value)) {
            notify('❌ Выберите проверку, к которой относится задача', 'error'); return;
        }
        var _pc = _collectTaskPeriods();
        if (_pc.error) { notify('❌ ' + _pc.error, 'error'); return; }
        if (!_pc.periods.length) { notify('❌ Укажите хотя бы один период', 'error'); return; }
        if (_subk !== 'audit_extra' && !getSelectedAssignees().length) {
            notify('❌ Назначьте хотя бы одного сотрудника', 'error');
            return;
        }
    } else {
        // PATCH tasks-stages: запрет пересечения этапов
        var _stConf = _taskStagesConflicts();
        if (_stConf.length) {
            var _names = _stConf.sort(function(a,b){return a-b;}).map(function(i){
                return TASK_STAGE_LABELS[TASK_STAGE_ORDER[i]] || TASK_STAGE_ORDER[i];
            });
            notify('❌ Этапы пересекаются: ' + _names.join(', ') + '. Начало каждого следующего этапа должно быть позже предыдущего.', 'error');
            renderTaskStages();
            return;
        }
        // PATCH tasks-lead: банк-руководитель обязателен
        var _leadDepEl = $('task_lead_department');
        _leadDep = _leadDepEl ? _leadDepEl.value : '';
        if (!_leadDep) {
            notify('❌ Укажите банк-руководитель проверки', 'error');
            if (_leadDepEl) _leadDepEl.classList.add('lead-invalid');
            return;
        }
    }
    var status = $('task_status') ? $('task_status').value : 'active';
    var completed = $('task_completed_at') ? $('task_completed_at').value.trim() : '';
    var payload = {
        id: $('task_id') ? ($('task_id').value || '') : '',
        name: name,
        icon: $('task_icon') ? $('task_icon').value.trim() : '',
        description: $('task_description') ? $('task_description').value.trim() : '',
        status: status,
        start_date: $('task_start_date') ? $('task_start_date').value.trim() : '',
        deadline: $('task_deadline') ? $('task_deadline').value.trim() : '',
        completed_at: (status === 'done' || status === 'archived') ? completed : '',
        folder: $('task_folder') ? $('task_folder').value.trim() : '',
        order_ref: $('task_order_ref') ? $('task_order_ref').value.trim() : '',
        tags: (_tagDraft || []).slice(),
        assignees: getSelectedAssignees(),
        department_ids: getSelectedTaskDepartments(),
        task_kind: _taskKind,
        load_coef: _isOther ? _loadCoef : 0,
        lead_department: _isOther ? '' : ($('task_lead_department') ? $('task_lead_department').value : ''),
        lead_employee: _isOther ? '' : ($('task_lead_employee') ? $('task_lead_employee').value : ''),
        is_urgent: $('task_is_urgent') ? !!$('task_is_urgent').checked : false,
        links: (_taskLinksDraft || []).slice(),
        orders: (_taskOrdersDraft || []).slice(),
        task_type: $('task_type') ? $('task_type').value : '',
        pocket: $('task_pocket') ? $('task_pocket').value.trim() : '',
        curator: _curator,
        department_shares: window.__taskDepSharesDraft || {},
        stages: (function(){ var o = {}; TASK_STAGE_ORDER.forEach(function(k){ o[k] = _taskStagesDraft[k] || ''; }); return o; })(),
    };
    if (_isOther) {
        var _pcs = _collectTaskPeriods().periods;
        payload.periods = _pcs;
        payload.other_subkind = $('task_other_subkind') ? ($('task_other_subkind').value || 'other') : 'other';
        payload.parent_task_id = $('task_parent_id') ? $('task_parent_id').value : '';
        if (_pcs.length) { payload.start_date = _pcs[0].start; payload.deadline = _pcs.reduce(function(m, x) { return x.end > m ? x.end : m; }, ''); }
        payload.stages = {};
    }
    var _origT = payload.id ? ((state.tasks || []).find(function(x) { return x.id === payload.id; }) || null) : null;
    if (!window.trkRetroConfirm(window.trkChangedDates(_origT || {}, payload))) return;
    // PATCH v1.0.15: закрываем карточку СРАЗУ — пользователь видит
    // лоадер («Загрузка…»), а не пустую модалку. При ошибке вернём.
    var _taskModal = $('taskModal');
    var _wasActive = !!(_taskModal && _taskModal.classList.contains('active'));
    if (_wasActive) _taskModal.classList.remove('active');
    apiJson('/api/tracker/task/save', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        return trkRefreshAll();
    }).catch(function(err) {
        var _msg = (err && err.message) || '';
        // На ошибке или отмене дубликата возвращаем модалку,
        // чтобы пользователь не потерял введённые данные.
        if (_wasActive && _taskModal) _taskModal.classList.add('active');
        if (_msg.indexOf('cancelled') !== -1) return;
        notify('❌ ' + (_msg || 'Ошибка'), 'error');
    });
}
function deleteTask(id) {
    var task = state.tasks.find(function(x) { return x.id === id; });
    if (!task) return;
    if (!confirm('Удалить задачу «' + task.name + '»?')) return;
    apiJson('/api/tracker/task/delete', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: id })
    }).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        return trkRefreshAll();
    }).catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
on('saveTaskBtn', 'click', saveTask);
on('addTaskBtn', 'click', function() { openTaskKindChooser(); });
on('addTaskBtn2', 'click', function() { openTaskKindChooser(); });
on('taskKindAudit', 'click', function() {
    var m = $('taskKindModal'); if (m) m.classList.remove('active');
    openTaskModal(null, 'audit');
});
on('taskKindOther', 'click', function() {
    var m = $('taskKindModal'); if (!m) return;
    var main = m.querySelector('.task-kind-choices'), sub = $('taskKindOtherBox');
    if (main) main.style.display = 'none';
    if (sub) sub.style.display = 'flex';
    var sel = $('taskKindParentSel');
    if (sel) {
        var lbl = { planning: 'Планирование', approved: 'Утверждена', active: 'Активна' };
        var aud = (state.tasks || []).filter(function(t) { return (t.task_kind || 'audit') === 'audit' && lbl[t.status]; })
            .sort(function(a, b) { return String(a.name).localeCompare(String(b.name), 'ru'); });
        sel.innerHTML = '<option value="">— выберите проверку —</option>' + aud.map(function(t) {
            return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.name) + ' · ' + lbl[t.status] + '</option>';
        }).join('');
    }
    var pr = $('taskKindParentRow'); if (pr) pr.style.display = 'none';
});
document.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('[data-other-sub]') : null;
    if (!b) return;
    var sub = b.getAttribute('data-other-sub');
    if (sub === 'back') { openTaskKindChooser(); return; }
    if (sub === 'audit_extra') { var pr = $('taskKindParentRow'); if (pr) pr.style.display = 'flex'; return; }
    var parent = '';
    if (sub === 'audit_extra_go') {
        parent = $('taskKindParentSel') ? $('taskKindParentSel').value : '';
        if (!parent) { notify('Выберите проверку', 'error'); return; }
        sub = 'audit_extra';
    }
    var m = $('taskKindModal'); if (m) m.classList.remove('active');
    window.__trkOtherPreset = { sub: sub, parent: parent };
    openTaskModal(null, 'other');
});
on('taskPeriodAddBtn', 'click', function() {
    var last = _taskPeriodsDraft[_taskPeriodsDraft.length - 1] || {};
    _taskPeriodsDraft.push({ start: last.end ? addDaysISO_trk(last.end, 1) : '', end: '' });
    renderTaskPeriods();
});
function addDaysISO_trk(iso, n) { var p = iso.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
on('taskIconPickBtn', 'click', function() {
    var m = $('emojiModal'); if (m) m.classList.add('active');
});
on('task_status', 'change', syncTaskCompletedAt);

/* ============================================================
   СВОД
   ============================================================ */
function updateSumRowToggle() {
    var el = $('sumTaskRowMode');
    if (!el) return;
    el.style.display = state.summaryIsGrid ? '' : 'none';
}

function loadSummary() {
    /* «Свод» по проверкам (plugins/svod.py) вместо свода часов */
    if (typeof window.__svodLoad === 'function' && document.getElementById('svodRoot')) {
        window.__svodLoad();
        return Promise.resolve();
    }
    var from = $('sumDateFrom') ? $('sumDateFrom').value : '';
    var to = $('sumDateTo') ? $('sumDateTo').value : '';
    if (!from) { from = firstOfMonthISO(todayYM()); if ($('sumDateFrom')) $('sumDateFrom').value = from; }
    if (!to) { to = todayISO(); if ($('sumDateTo')) $('sumDateTo').value = to; }
    var emp = $('sumEmployeeFilter') ? ($('sumEmployeeFilter').value || '') : '';
    var task = $('sumTaskFilter') ? ($('sumTaskFilter').value || '') : '';
    var dept = $('sumDeptFilter') ? ($('sumDeptFilter').value || '') : '';
    var team = $('sumTeamFilter') ? ($('sumTeamFilter').value || '') : '';
    var tagArr = (window.__trkSelectedTags && window.__trkSelectedTags.sumTagFilter) || [];
    var tag = tagArr.join(',');
    var sumTagMode = (window.__trkTagMode && window.__trkTagMode.sumTagFilter) || 'any';
    var view = state.sumViewMode || 'grid';
    var wrap = $('sumWrap');
    if (wrap) wrap.innerHTML = '<div class="sum-empty">Загрузка...</div>';
    var qs = '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)
        + '&employee=' + encodeURIComponent(emp) + '&task=' + encodeURIComponent(task)
        + '&department=' + encodeURIComponent(dept) + '&team=' + encodeURIComponent(team)
        + '&tag=' + encodeURIComponent(tag) + '&tag_mode=' + encodeURIComponent(sumTagMode);
    var url = (view === 'grid')
        ? ('/api/tracker/summary_grid' + qs)
        : ('/api/tracker/summary' + qs + '&view=' + encodeURIComponent(view));
    apiJson(url).then(function(d) {
        state.summary = d;
        state.summaryIsGrid = (view === 'grid');
        if (view === 'grid') renderSummaryGrid();
        else renderSummary();
        updateSumRowToggle();
    }).catch(function(err) {
        if (wrap) wrap.innerHTML = '<div class="sum-empty" style="color:#e74c3c;">❌ ' + escapeHtml(err.message || 'Ошибка') + '</div>';
    });
}
function _summaryLegendHtml() {
    return '<div class="grid-legend">'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background:rgba(46,204,113,0.24);"></span>✅ Готово</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background:rgba(52,152,219,0.24);"></span>🔵 В работе</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background:rgba(149,165,166,0.24);"></span>📝 Запланировано</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background:rgba(231,76,60,0.24);"></span>🔴 Заблокировано</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background: repeating-linear-gradient(45deg,rgba(52,152,219,0.15) 0,rgba(52,152,219,0.15) 4px,rgba(52,152,219,0.30) 4px,rgba(52,152,219,0.30) 8px);"></span>🌞 Отпуск</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background: repeating-linear-gradient(45deg,rgba(243,156,18,0.15) 0,rgba(243,156,18,0.15) 4px,rgba(243,156,18,0.30) 4px,rgba(243,156,18,0.30) 8px);"></span>🤒 Больничный</span>'
        + '<span class="grid-legend-item"><span class="grid-legend-swatch" style="background: repeating-linear-gradient(45deg,rgba(155,89,182,0.15) 0,rgba(155,89,182,0.15) 4px,rgba(155,89,182,0.30) 4px,rgba(155,89,182,0.30) 8px);"></span>✈️ Командировка</span>'
        + '</div>';
}
function _absenceBadgeForRow(r) {
    var days = r.absence_days || {};
    var cnt = { vacation: 0, sick_leave: 0, business_trip: 0, remote: 0 };
    Object.keys(days).forEach(function(k) { cnt[days[k]] = (cnt[days[k]] || 0) + 1; });
    var out = '';
    if (cnt.vacation) out += ' <span class="emp-vac-badge">🌞 ' + cnt.vacation + '</span>';
    if (cnt.sick_leave) out += ' <span class="emp-sick-badge">🤒 ' + cnt.sick_leave + '</span>';
    if (cnt.business_trip) out += ' <span class="emp-trip-badge">✈️ ' + cnt.business_trip + '</span>';
    if (cnt.remote) out += ' <span class="emp-remote-badge">🏠 ' + cnt.remote + '</span>';
    return out;
}
function _summaryExtrasHtml(d) {
    var top = '', vac = '';
    if (d.top_tasks && d.top_tasks.length) {
        top = '<div class="sum-extra-block"><div class="sum-extra-title">🏆 Топ задач за период</div>';
        d.top_tasks.forEach(function(t) {
            top += '<div class="sum-top-task">'
                + '<span>' + escapeHtml(t.task_icon) + '</span>'
                + '<span class="name">' + escapeHtml(t.task_name) + '</span>'
                + '<span class="hours">' + formatHours(t.hours) + '</span></div>';
        });
        top += '</div>';
    }
    if (d.vacations && d.vacations.length) {
        vac = '<div class="sum-extra-block"><div class="sum-extra-title">🌞 Отсутствия в периоде</div>';
        d.vacations.forEach(function(v) {
            var vt = v.type || 'vacation';
            var lbl = v.type_label || absenceLabel(vt);
            vac += '<div class="sum-vac-row">'
                + '<span class="vtype-badge ' + vt + '">' + escapeHtml(lbl) + '</span>'
                + '<span class="emp-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + escapeHtml(v.employee_color) + ';box-shadow:0 0 6px ' + escapeHtml(v.employee_color) + ';"></span>'
                + '<span style="flex:1;">' + escName(v.employee_name) + '</span>'
                + '<span class="dates">' + escapeHtml(formatDateShort(v.from)) + ' — ' + escapeHtml(formatDateShort(v.to)) + '</span></div>';
        });
        vac += '</div>';
    }
    if (!top && !vac) return '';
    return '<div class="sum-extra-section">'
        + '<div class="sum-extra-section-title"><span>📌</span><span>Дополнительная статистика</span></div>'
        + '<div class="sum-extras">'
        + (top || '<div></div>') + (vac || '<div></div>')
        + '</div></div>';
}
function applySummaryColWidths() {
    var empW = parseInt(localStorage.getItem('sum_emp_w'), 10);
    if (!isFinite(empW) || empW < 60 || empW > 600) empW = 140;
    var taskW = parseInt(localStorage.getItem('sum_task_w'), 10);
    if (!isFinite(taskW) || taskW < 100 || taskW > 1200) taskW = 280;
    document.documentElement.style.setProperty('--sum-emp-w', empW + 'px');
    document.documentElement.style.setProperty('--sum-task-w', taskW + 'px');
}

function _attachColResizer(th, storageKey, cssVar, minW, maxW) {
    if (!th || th.querySelector('.col-resizer')) return;
    var h = document.createElement('div');
    h.className = 'col-resizer';
    h.title = 'Потяните, чтобы изменить ширину';
    th.appendChild(h);
    h.addEventListener('mousedown', function(e) {
        e.preventDefault();
        e.stopPropagation();
        h.classList.add('dragging');
        var startX = e.clientX;
        var cur = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
        var startW = parseInt(cur, 10) || th.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(ev) {
            var w = Math.max(minW, Math.min(maxW, startW + ev.clientX - startX));
            document.documentElement.style.setProperty(cssVar, w + 'px');
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            h.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            var cur2 = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
            var w2 = parseInt(cur2, 10);
            if (isFinite(w2)) try { localStorage.setItem(storageKey, String(w2)); } catch (er) {}
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function initSummaryResizers() {
    applySummaryColWidths();
    var wrap = $('sumWrap');
    if (!wrap) return;
    var thEmp = wrap.querySelector('thead th.emp-col');
    _attachColResizer(thEmp, 'sum_emp_w', '--sum-emp-w', 80, 600);
}

function renderSummaryGrid() {
    var d = state.summary;
    var wrap = $('sumWrap'), extras = $('sumExtras');
    if (!wrap) return;
    if (!d || !d.rows.length) {
        wrap.innerHTML = '<div class="sum-empty">Нет данных за выбранный период.</div>';
        if (extras) extras.innerHTML = '';
        return;
    }

    if (state.sumTaskSort === undefined) {
        try { state.sumTaskSort = localStorage.getItem('sum_task_sort') || 'default'; }
        catch (e) { state.sumTaskSort = 'default'; }
    }
    if (state.sumTotalSort === undefined) {
        try { state.sumTotalSort = localStorage.getItem('sum_total_sort') || 'default'; }
        catch (e) { state.sumTotalSort = 'default'; }
    }
    if (!state.sumCollapsed) state.sumCollapsed = {};

    var days = d.days, dm = d.day_meta || {}, today = todayISO();
    var showTotals = state.sumShowDayTotals !== false;
    var taskSort = state.sumTaskSort || 'default';
    var totalSort = state.sumTotalSort || 'default';
    var collapsed = state.sumCollapsed;

    var rowsSorted = d.rows.slice();
    if (totalSort === 'hours_desc') rowsSorted.sort(function(a, b) { return (b.total_hours || 0) - (a.total_hours || 0); });
    else if (totalSort === 'hours_asc') rowsSorted.sort(function(a, b) { return (a.total_hours || 0) - (b.total_hours || 0); });

    var workdays = 0;
    days.forEach(function(dk) { if ((dm[dk] || {}).is_workday) workdays++; });
    var normHours = workdays * 8;

    var taskSortMark = taskSort === 'name_asc' ? ' ↑' : (taskSort === 'name_desc' ? ' ↓' : '');
    var totalSortMark = totalSort === 'hours_desc' ? ' ↓' : (totalSort === 'hours_asc' ? ' ↑' : '');

    var head = '<tr><th class="emp-col">Сотрудник</th>'
        + '<th class="task-col sortable" data-sort="task" title="Клик — сортировка задач">Задача' + taskSortMark + '</th>';
    days.forEach(function(dk) {
        var m = dm[dk] || {}, cls = [];
        if (m.is_weekend) cls.push('weekend-col');
        if (m.is_holiday) cls.push('holiday-col');
        if (m.is_today || dk === today) cls.push('today-col');
        head += '<th' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + ' title="' + escapeHtml(dk) + '">'
            + escapeHtml(formatDateShort(dk)) + '</th>';
    });
    if (showTotals) {
        head += '<th class="total-col sortable" data-sort="total" title="Клик — сортировка сотрудников">Итого' + totalSortMark + '</th>';
    }
    head += '</tr>';

    var head2 = '';
    if (showTotals) {
        head2 = '<tr class="day-totals-head">'
            + '<td class="emp-cell" colspan="2"><div class="emp-cell-name" style="font-size:0.72rem;color:var(--trk-meta);font-weight:700;">Итого за день</div></td>';
        days.forEach(function(dk) {
            var v = d.day_totals[dk] || 0, m = dm[dk] || {}, cls = ['day-cell'];
            if (m.is_holiday) cls.push('holiday-day');
            else if (m.is_weekend) cls.push('weekend-day');
            head2 += '<td class="' + cls.join(' ') + '" style="font-weight:700;color:var(--trk-accent);text-align:center;">' + (v > 0 ? shortHours(v) : '—') + '</td>';
        });
        head2 += '<td class="total-cell" style="text-align:center;">' + formatHours(d.grand_total) + '</td></tr>';
    }

    var body = '';
    rowsSorted.forEach(function(r, ri) {
        var allTasks = (r.tasks || []).slice();
        if (taskSort === 'name_asc') allTasks.sort(function(a, b) { return (a.task_name || '').toLowerCase().localeCompare((b.task_name || '').toLowerCase()); });
        else if (taskSort === 'name_desc') allTasks.sort(function(a, b) { return (b.task_name || '').toLowerCase().localeCompare((a.task_name || '').toLowerCase()); });
        else allTasks.sort(function(a, b) {
            var ta = (a.task_tags && a.task_tags[0]) || 'zzz';
            var tb = (b.task_tags && b.task_tags[0]) || 'zzz';
            if (ta !== tb) return ta < tb ? -1 : 1;
            return (b.total_hours || 0) - (a.total_hours || 0);
        });

        var isCollapsed = !!collapsed[r.employee_id];
        var tasks;
        if (isCollapsed && allTasks.length) {
            var _aggCells = {};
            var _statusRank = { done: 4, in_progress: 3, blocked: 2, planned: 1 };
            allTasks.forEach(function(_t) {
                var _tCells = _t.cells || {};
                Object.keys(_tCells).forEach(function(_dk) {
                    var _c = _tCells[_dk];
                    if (!_c || !_c.hours) return;
                    var _a = _aggCells[_dk];
                    if (!_a) {
                        _aggCells[_dk] = {
                            hours: _c.hours,
                            status: _c.status || 'done',
                            entries: (_c.entries || []).slice()
                        };
                    } else {
                        _a.hours += _c.hours;
                        if ((_statusRank[_c.status] || 0) > (_statusRank[_a.status] || 0)) _a.status = _c.status;
                        if (_c.entries && _c.entries.length) _a.entries = _a.entries.concat(_c.entries);
                    }
                });
            });
            var _lbls = (typeof state !== 'undefined' && state.statusLabels) || {};
            Object.keys(_aggCells).forEach(function(_dk) {
                _aggCells[_dk].hours = Math.round(_aggCells[_dk].hours * 4) / 4;
                _aggCells[_dk].status_label = _lbls[_aggCells[_dk].status] || _aggCells[_dk].status;
            });
            tasks = [{
                task_id: '__collapsed__',
                task_name: '📦 ' + allTasks.length + ' задач свёрнуто · ' + formatHours(r.total_hours),
                task_icon: '',
                task_status: 'active',
                task_tags: [],
                overdue: false,
                cells: _aggCells,
                total_hours: r.total_hours,
                start_date: '',
                deadline: '',
                emp_completed_at: '',
                is_collapsed: true
            }];
        } else {
            tasks = allTasks;
        }

        var absMap = r.absence_days || {};
        var empExtra = _absenceBadgeForRow(r);

        var loadPct = normHours > 0 ? Math.round((r.total_hours / normHours) * 100) : 0;
        var loadCls = loadPct > 105 ? 'load-over' : (loadPct > 85 ? 'load-high' : (loadPct < 50 ? 'load-low' : 'load-ok'));
        var loadBar = '<div class="emp-load ' + loadCls + '" title="Загрузка: ' + loadPct + '% от нормы (' + workdays + '×8 = ' + normHours + 'ч)">'
            + '<div class="emp-load-fill" style="width:' + Math.min(loadPct, 100) + '%"></div>'
            + '</div>';

        var collapseBtn = allTasks.length > 1
            ? '<button class="emp-collapse-btn" data-emp="' + escapeHtml(r.employee_id) + '" title="' + (isCollapsed ? 'Развернуть' : 'Свернуть') + '" type="button">' + (isCollapsed ? '▶' : '▼') + '</button>'
            : '';

        var dept = r.employee_department ? '<div class="emp-dept">🏢 ' + escapeHtml(r.employee_department) + '</div>' : '';

        if (!tasks.length) {
            body += '<tr>'
                + '<td class="emp-cell" data-emp="' + escapeHtml(r.employee_id) + '">'
                + '<div class="emp-cell-inner">'
                +   '<div class="emp-cell-name">'
                +     '<span class="emp-dot" style="background:' + escapeHtml(r.employee_color) + ';box-shadow:0 0 6px ' + escapeHtml(r.employee_color) + ';"></span>'
                +     escName(r.employee_name) + collapseBtn
                +   '</div>'
                +   '<div class="emp-cell-stats">0 задач · 0 ч' + empExtra + '</div>'
                +   loadBar + dept
                + '</div></td>'
                + '<td class="task-cell empty">— нет задач —</td>'
                + days.map(function(dk) {
                    var m = dm[dk] || {}, abs = absMap[dk], cls = ['empty-cell'], content = '·';
                    if (abs) { cls.push('absence-' + abs); content = absenceIcon(abs); }
                    else if (m.is_holiday) cls.push('holiday-day');
                    else if (m.is_weekend) cls.push('weekend-day');
                    return '<td class="' + cls.join(' ') + '" title="' + escapeHtml(dk) + '">' + content + '</td>';
                }).join('')
                + (showTotals ? '<td class="total-cell">0 ч</td>' : '')
                + '</tr>';
            return;
        }

        var runningCount = 0;
        tasks.forEach(function(tt) {
            var st = (tt.task_status || 'active');
            if (st === 'active' || st === 'paused') runningCount++;
        });

        tasks.forEach(function(t, ti) {
            body += '<tr>';
            if (ti === 0) {
                body += '<td class="emp-cell" rowspan="' + tasks.length + '" data-emp="' + escapeHtml(r.employee_id) + '">'
                    + '<div class="emp-cell-inner">'
                    +   '<div class="emp-cell-name">'
                    +     '<span class="emp-dot" style="background:' + escapeHtml(r.employee_color) + ';box-shadow:0 0 6px ' + escapeHtml(r.employee_color) + ';"></span>'
                    +     escName(r.employee_name) + collapseBtn
                    +   '</div>'
                    +   '<div class="emp-cell-stats">'
                    +     '<span class="ecs-num">' + runningCount + '</span> в работе · '
                    +     '<span class="ecs-num">' + formatHours(r.total_hours) + '</span>'
                    +     empExtra
                    +   '</div>'
                    +   loadBar + dept
                    + '</div></td>';
            }
            var rowMode = state.sumTaskRowMode || 'full';
            var statusCls = 'st-' + (t.task_status || 'active');
            var dot = '<span class="task-status-dot" title="' + escapeHtml(t.task_status || 'active') + '"></span>';
            var period = '';
            if (t.start_date || t.deadline || t.emp_completed_at) {
                period = '<span class="task-period">'
                    + (t.start_date ? '🚀 ' + escapeHtml(formatDateShort(t.start_date)) : '')
                    + (t.start_date && t.deadline ? ' — ' : '')
                    + (t.deadline ? '⏰ ' + escapeHtml(formatDateShort(t.deadline)) : '')
                    + (t.emp_completed_at ? ' · ✅ ' + escapeHtml(formatDateShort(t.emp_completed_at)) : '')
                    + (t.overdue ? ' ⚠' : '') + '</span>';
            }
            var tagsChips = (t.task_tags && t.task_tags.length)
                ? t.task_tags.slice(0, 4).map(function(x) { return '<span class="task-tag-chip">#' + escapeHtml(x) + '</span>'; }).join('')
                : '';
            if (rowMode === 'compact') {
                body += '<td class="task-cell task-cell-compact ' + statusCls + (t.overdue ? ' overdue' : '') + '" data-task="' + escapeHtml(t.task_id) + '">'
                    + dot
                    + '<span class="task-ico">' + escapeHtml(t.task_icon) + '</span>'
                    + '<span class="task-name-str' + (t.overdue ? ' overdue' : '') + '" title="' + escapeHtml(t.task_name) + '">' + escapeHtml(t.task_name) + (t.overdue ? ' ⚠' : '') + '</span>'
                    + '</td>';
            } else {
                body += '<td class="task-cell task-cell-full ' + statusCls + (t.overdue ? ' overdue' : '') + '" data-task="' + escapeHtml(t.task_id) + '">'
                    + '<div class="task-cell-row1">' + dot
                    +   '<span class="task-ico">' + escapeHtml(t.task_icon) + '</span>'
                    +   '<span class="task-name-str' + (t.overdue ? ' overdue' : '') + '" title="' + escapeHtml(t.task_name) + '">' + escapeHtml(t.task_name) + (t.overdue ? ' ⚠' : '') + '</span>'
                    + '</div>'
                    + '<div class="task-cell-row2">'
                    +   '<span class="task-cell-dates">' + period + '</span>'
                    +   '<span class="task-cell-tags">' + tagsChips + '</span>'
                    + '</div>'
                    + '</td>';
            }
            days.forEach(function(dk) {
                var m = dm[dk] || {}, cell = t.cells[dk], abs = absMap[dk];
                if (!cell || !cell.hours) {
                    var cls = [], content = '·';
                    if (abs) { cls.push('absence-' + abs); content = absenceIcon(abs); }
                    else if (m.is_holiday) cls.push('holiday-day');
                    else if (m.is_weekend) cls.push('weekend-day');
                    else cls.push('empty-cell');
                    body += '<td class="day-cell ' + cls.join(' ') + '" title="' + escapeHtml(dk) + '">' + content + '</td>';
                    return;
                }
                var extraCls = '';
                if (abs && abs !== 'remote') extraCls = ' absence-' + abs;
                else if (m.is_holiday) extraCls = ' holiday-day';
                else if (m.is_weekend) extraCls = ' weekend-day';
                if (abs === 'remote') extraCls += ' has-remote';
                body += '<td class="day-cell status-' + escapeHtml(cell.status) + extraCls + '" '
                    + 'data-emp="' + escapeHtml(r.employee_id) + '" data-task="' + escapeHtml(t.task_id) + '" data-date="' + escapeHtml(dk) + '" '
                    + 'title="' + escapeHtml(formatHours(cell.hours) + ' · ' + (cell.status_label || '')) + '">'
                    + shortHours(cell.hours) + '</td>';
            });
            if (showTotals) {
                body += '<td class="total-cell">' + (t.total_hours ? formatHours(t.total_hours) : '—') + '</td>';
            }
            body += '</tr>';
        });
        if (ri < rowsSorted.length - 1) {
            body += '<tr class="emp-sep"><td colspan="' + (2 + days.length + (showTotals ? 1 : 0)) + '"></td></tr>';
        }
    });

    wrap.innerHTML = '<table class="sum-table grid-table"><thead>' + head + head2 + '</thead><tbody>' + body + '</tbody></table>';

    wrap.querySelectorAll('td.day-cell[data-emp]').forEach(function(td) {
        td.addEventListener('click', function(e) {
            e.stopPropagation();
            if (this.getAttribute('data-task') === '__collapsed__') {
                openEmpDayModal(this.getAttribute('data-emp'), this.getAttribute('data-date'));
                return;
            }
            openGridCellDetails(this.getAttribute('data-emp'), this.getAttribute('data-task'), this.getAttribute('data-date'));
        });
    });
    wrap.querySelectorAll('td.task-cell[data-task]').forEach(function(td) {
        td.style.cursor = 'pointer';
        td.addEventListener('click', function() { var _tid = this.getAttribute('data-task'); if (_tid === '__collapsed__') return; if (typeof window.trkOpenTaskById === 'function') window.trkOpenTaskById(_tid); });
    });
    wrap.querySelectorAll('td.emp-cell[data-emp]').forEach(function(td) {
        td.style.cursor = 'pointer';
        td.addEventListener('click', function(e) {
            if (e.target.closest('.emp-collapse-btn')) return;
            openEmpCardModal(this.getAttribute('data-emp'));
        });
    });

    wrap.querySelectorAll('th.sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var kind = this.getAttribute('data-sort');
            if (kind === 'task') {
                var cur = state.sumTaskSort || 'default';
                state.sumTaskSort = cur === 'name_asc' ? 'name_desc' : 'name_asc';
                try { localStorage.setItem('sum_task_sort', state.sumTaskSort); } catch (e) {}
            } else if (kind === 'total') {
                var cur2 = state.sumTotalSort || 'default';
                state.sumTotalSort = cur2 === 'hours_desc' ? 'hours_asc' : 'hours_desc';
                try { localStorage.setItem('sum_total_sort', state.sumTotalSort); } catch (e) {}
            }
            renderSummaryGrid();
        });
    });

    wrap.querySelectorAll('.emp-collapse-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var empId = this.getAttribute('data-emp');
            state.sumCollapsed = state.sumCollapsed || {};
            state.sumCollapsed[empId] = !state.sumCollapsed[empId];
            renderSummaryGrid();
        });
    });

    if (extras) extras.innerHTML = _summaryLegendHtml() + _summaryExtrasHtml(d);
    initSummaryResizers();
}

function openGridCellDetails(empId, taskId, dateStr) {
    var d = state.summary; if (!d || !d.rows) return;
    var row = d.rows.find(function(r) { return r.employee_id === empId; }); if (!row) return;
    var t = (row.tasks || []).find(function(x) { return x.task_id === taskId; }); if (!t) return;
    var cell = t.cells[dateStr]; if (!cell) return;
    var dd = $('dayModalDate'); if (dd) dd.textContent = formatDateHuman(dateStr) + ' — ' + maskName(row.employee_name);
    var dt = $('dayModalTotal'); if (dt) dt.textContent = formatHours(cell.hours) + ' · ' + (cell.status_label || '');
    var html = '';
    var full = [];
    cell.entries.forEach(function(e) {
        var f = {
            id: e.id, task_id: taskId, task_name: t.task_name, task_icon: t.task_icon,
            employee_id: row.employee_id,
            hours: e.hours, comment: e.comment, status: e.status, status_label: e.status_label,
            link: e.link, employee_name: row.employee_name, employee_color: row.employee_color,
            employee_department: row.employee_department || '', date: dateStr,
            task_start_date: t.start_date || '', task_deadline: t.deadline || '',
            overdue: t.overdue,
        };
        full.push(f);
        html += dayEntryCard(f, false);
    });
    var list = $('dayList'); if (list) list.innerHTML = html;
    bindDayEntryActions(list, full);
    var a = $('dayModalLeftActions'); if (a) a.style.display = 'none';
    var clr = $('dayClearBtn'); if (clr) clr.style.display = 'none';
    var m = $('dayModal'); if (m) m.classList.add('active');
}
function renderSummary() {
    var d = state.summary;
    var wrap = $('sumWrap'), extras = $('sumExtras');
    if (!wrap) return;
    if (!d || !d.rows.length) {
        wrap.innerHTML = '<div class="sum-empty">Нет данных за выбранный период.</div>';
        if (extras) extras.innerHTML = '';
        return;
    }
    var days = d.days, dm = d.day_meta || {}, today = todayISO();
    var view = state.sumViewMode || 'compact';
    var cls2 = view === 'full' ? 'sum-cell-full' : 'sum-cell-compact';
    var head = '<tr><th class="emp-col">Сотрудник</th>';
    days.forEach(function(dk) {
        var m = dm[dk] || {}, cls = [];
        if (m.is_weekend) cls.push('weekend-col');
        if (m.is_holiday) cls.push('holiday-col');
        if (m.is_today || dk === today) cls.push('today-col');
        head += '<th' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + escapeHtml(formatDateShort(dk)) + '</th>';
    });
    head += '<th class="total-col">Итого</th></tr>';
    var body = '';
    d.rows.forEach(function(r) {
        body += '<tr><td class="emp-cell">'
            + '<div class="emp-cell-inner">'
            +   '<div class="emp-cell-name">'
            +     '<span class="emp-dot" style="background:' + escapeHtml(r.employee_color) + ';box-shadow:0 0 6px ' + escapeHtml(r.employee_color) + ';"></span>'
            +     escName(r.employee_name)
            +   '</div>'
            +   '<div class="emp-cell-stats"><span class="ecs-num">' + formatHours(r.total_hours) + '</span></div>'
            + '</div></td>';
        days.forEach(function(dk) {
            var cell = r.cells[dk], m = dm[dk] || {}, extra = '';
            if (m.is_holiday) extra = ' holiday-day';
            else if (m.is_weekend) extra = ' weekend-day';
            if (!cell || !cell.hours) { body += '<td class="empty-cell' + extra + '">—</td>'; return; }
            var inner = '';
            if (view === 'full') {
                inner += '<div class="sum-hours-main">' + formatHours(cell.hours) + '</div>';
                cell.tasks.forEach(function(t) {
                    var stCls = t.entries.length ? t.entries[0].status : 'done';
                    inner += '<div class="sum-task-row ' + stCls + (t.overdue ? ' overdue' : '') + '">'
                        + '<span class="status-dot"></span><span>' + escapeHtml(t.task_icon) + '</span>'
                        + '<span class="task-name">' + escapeHtml(t.task_name) + '</span>'
                        + '<span class="task-hours">' + t.hours + '</span></div>';
                });
            } else {
                inner += '<div class="sum-hours-main">' + formatHours(cell.hours) + '</div>';
                inner += '<div class="sum-tasks-count">' + cell.tasks.length + ' задач</div>';
            }
            body += '<td class="has-data ' + cls2 + extra + '" data-emp="' + escapeHtml(r.employee_id) + '" data-date="' + escapeHtml(dk) + '">' + inner + '</td>';
        });
        body += '<td class="total-cell">' + formatHours(r.total_hours) + '</td></tr>';
    });
    var totalsRow = '<tr class="day-totals-row"><td class="emp-cell"><div class="emp-cell-name">Итого за день</div></td>';
    days.forEach(function(dk) {
        var v = d.day_totals[dk] || 0, m = dm[dk] || {}, cls = [];
        if (m.is_holiday) cls.push('holiday-day');
        else if (m.is_weekend) cls.push('weekend-day');
        totalsRow += '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + (v > 0 ? formatHours(v) : '—') + '</td>';
    });
    totalsRow += '<td class="total-cell">' + formatHours(d.grand_total) + '</td></tr>';
    wrap.innerHTML = '<table class="sum-table"><thead>' + head + '</thead><tbody>' + body + totalsRow + '</tbody></table>';
    wrap.querySelectorAll('td.has-data').forEach(function(td) {
        td.addEventListener('click', function() { openSummaryCell(this.getAttribute('data-emp'), this.getAttribute('data-date')); });
    });
    if (extras) extras.innerHTML = _summaryLegendHtml() + _summaryExtrasHtml(d);
    initSummaryResizers();
}
function openSummaryCell(empId, dateStr) {
    var d = state.summary; if (!d) return;
    var row = d.rows.find(function(r) { return r.employee_id === empId; }); if (!row) return;
    var cell = row.cells[dateStr]; if (!cell) return;
    var dd = $('dayModalDate'); if (dd) dd.textContent = formatDateHuman(dateStr) + ' — ' + maskName(row.employee_name);
    var dt = $('dayModalTotal'); if (dt) dt.textContent = formatHours(cell.hours) + ' · ' + cell.tasks.length + ' задач';
    var html = '';
    var full = [];
    cell.tasks.forEach(function(t) {
        t.entries.forEach(function(e) {
            var f = {
                id: e.id, task_id: t.task_id, task_name: t.task_name, task_icon: t.task_icon,
                employee_id: row.employee_id,
                hours: e.hours, comment: e.comment, status: e.status, status_label: e.status_label,
                link: e.link, employee_name: row.employee_name, employee_color: row.employee_color,
                employee_department: row.employee_department || '', date: dateStr,
                task_start_date: '', task_deadline: '', overdue: t.overdue,
            };
            full.push(f);
            html += dayEntryCard(f, false);
        });
    });
    var list = $('dayList'); if (list) list.innerHTML = html;
    bindDayEntryActions(list, full);
    var a = $('dayModalLeftActions'); if (a) a.style.display = 'none';
    var clr = $('dayClearBtn'); if (clr) clr.style.display = 'none';
    var m = $('dayModal'); if (m) m.classList.add('active');
}
on('sumApplyBtn', 'click', loadSummary);
on('sumWeekBtn', 'click', function() { setDefaultWeekRange(); loadSummary(); });
on('sumMonthBtn', 'click', function() { setMonthRange(); loadSummary(); });
on('sumPrevWeekBtn', 'click', function() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    var from = (a && a.value) || getMondayISO();
    var to = (b && b.value) || getSundayISO();
    if (a) a.value = addDaysISO(from, -7);
    if (b) b.value = addDaysISO(to, -7);
    loadSummary();
});
on('sumNextWeekBtn', 'click', function() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    var from = (a && a.value) || getMondayISO();
    var to = (b && b.value) || getSundayISO();
    if (a) a.value = addDaysISO(from, 7);
    if (b) b.value = addDaysISO(to, 7);
    loadSummary();
});
on('sumPrevDayBtn', 'click', function() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    var from = (a && a.value) || getMondayISO();
    var to = (b && b.value) || getSundayISO();
    if (a) a.value = addDaysISO(from, -1);
    if (b) b.value = addDaysISO(to, -1);
    loadSummary();
});
on('sumNextDayBtn', 'click', function() {
    var a = $('sumDateFrom'), b = $('sumDateTo');
    var from = (a && a.value) || getMondayISO();
    var to = (b && b.value) || getSundayISO();
    if (a) a.value = addDaysISO(from, 1);
    if (b) b.value = addDaysISO(to, 1);
    loadSummary();
});
on('sumEmployeeFilter', 'change', loadSummary);
on('sumTaskFilter', 'change', loadSummary);
on('sumDeptFilter', 'change', loadSummary);
on('sumTeamFilter', 'change', loadSummary);
on('sumTagFilter', 'change', loadSummary);
(function() {
    var sdt = $('sumShowDayTotals');
    if (!sdt) return;
    sdt.checked = state.sumShowDayTotals;
    sdt.addEventListener('change', function() {
        state.sumShowDayTotals = this.checked;
        if (state.summary) {
            if (state.summaryIsGrid) renderSummaryGrid();
            else renderSummary();
        }
    });
})();

/* ============================================================
   КАРТОЧКА СОТРУДНИКА
   ============================================================ */
function openEmpCardModal(empId) {
    var from = $('sumDateFrom') ? $('sumDateFrom').value : '';
    var to = $('sumDateTo') ? $('sumDateTo').value : '';
    if (!from || !to) {
        var t = new Date();
        from = firstOfMonthISOFromDate(t);
        to = todayISO();
    }
    var qs = '?employee=' + encodeURIComponent(empId)
        + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    apiJson('/api/tracker/employee/card' + qs)
        .then(function(d) {
            if (!d.success) throw new Error(d.error || 'Ошибка');
            renderEmpCardModal(d);
            var m = $('empCardModal'); if (m) m.classList.add('active');
        })
        .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function _coverageBar(cov) {
    var cls = 'err';
    if (cov >= 70) cls = 'ok';
    else if (cov >= 40) cls = 'warn';
    var w = Math.max(0, Math.min(cov, 100));
    return '<div class="coverage-bar"><span class="coverage-bar-label">📊 Покрытие:</span>'
        + '<div class="coverage-bar-track"><div class="coverage-bar-fill ' + cls + '" style="width:' + w + '%;"></div></div>'
        + '<span class="coverage-bar-label">' + cov + '%</span></div>';
}
function renderEmpCardModal(d) {
    var emp = d.employee || {};
    var color = emp.color || '#00897b';
    var period = d.from ? (formatDateHuman(d.from) + ' — ' + formatDateHuman(d.to)) : '';
    var dept = emp.department ? ' · 🏢 ' + escapeHtml(emp.department) : '';
    var fired = emp.fired ? ' · 🚪 уволен ' + escapeHtml(emp.fired_date || '') : '';
    var head = $('empCardHead');
    if (head) head.innerHTML = '<div class="emp-day-avatar" style="background:' + escapeHtml(color) + ';box-shadow:0 0 12px ' + escapeHtml(color) + ';">'
        + escapeHtml(initials(emp.name)) + '</div>'
        + '<div class="emp-day-info"><div class="emp-day-name">' + escName(emp.name || '—') + '</div>'
        + '<div class="emp-day-role">' + escapeHtml(emp.role || '') + dept + fired + ' · ' + escapeHtml(period) + '</div></div>'
        + '<div class="emp-day-stats">'
        + '<div class="emp-day-stat"><span class="val">' + formatHours(d.total_hours) + '</span><span class="lbl">часов</span></div>'
        + '<div class="emp-day-stat"><span class="val">' + d.tasks.length + '</span><span class="lbl">задач</span></div>'
        + '</div>';
    var hm = $('empCardHeatmap'); if (hm) hm.innerHTML = renderMiniCells(d.cells);
    var list = $('empCardTasks');
    if (!list) return;
    if (!d.tasks.length) { list.innerHTML = '<div class="day-empty">За этот период отметок нет.</div>'; return; }
    var html = '';
    d.tasks.forEach(function(t) {
        var stLbl = state.taskStatusLabels[t.status] || t.status || '';
        var badge = '';
        if (t.completion_kind) {
            var cls = t.completion_kind;
            var txt = cls === 'early' ? '✅ Досрочно' : (cls === 'late' ? '⏰ С опозданием' : '✅ В срок');
            if (typeof t.days_delta === 'number') {
                if (t.days_delta < 0) txt += ' (' + Math.abs(t.days_delta) + ' дн. раньше)';
                else if (t.days_delta > 0) txt += ' (' + t.days_delta + ' дн. позже)';
            }
            if (t.completed_at) txt += ' · ' + t.completed_at;
            badge = '<div class="task-completion-badge ' + cls + '">' + escapeHtml(txt) + '</div>';
        }
        var rowCls = 'task-card-row';
        if (t.overdue) rowCls += ' overdue';
        else if (t.completion_kind === 'early') rowCls += ' early';
        else if (t.completion_kind === 'late') rowCls += ' late';
        html += '<div class="' + rowCls + '">'
            + '<div class="task-card-row-head">'
            +   '<span class="task-card-row-title' + (t.overdue ? ' overdue' : '') + '">'
            +     escapeHtml(t.task_icon) + ' ' + escapeHtml(t.task_name) + '</span>'
            +   '<span class="day-entry-hours">' + formatHours(t.total_hours) + '</span>'
            +   (stLbl ? '<span class="day-entry-status status-' + escapeHtml(t.status) + '">' + escapeHtml(stLbl) + '</span>' : '')
            + '</div>'
            + (t.task_tags && t.task_tags.length ? '<div style="margin-top:2px;">' + t.task_tags.map(function(x){return '<span class="task-tag-chip">#'+escapeHtml(x)+'</span>';}).join('') + '</div>' : '')
            + '<div class="task-card-row-meta">'
            +   (t.start_date ? '<span>🚀 ' + escapeHtml(formatDateHuman(t.start_date)) + '</span>' : '')
            +   (t.deadline ? '<span>⏰ ' + escapeHtml(formatDateHuman(t.deadline)) + '</span>' : '')
            +   '<span>📅 ' + t.active_days + ' из ' + t.possible_days + ' раб. дней</span>'
            + '</div>'
            + (badge ? '<div style="margin-top:4px;">' + badge + '</div>' : '')
            + _coverageBar(t.coverage)
            + '<div class="mini-heatmap">' + renderMiniCells(t.cells) + '</div></div>';
    });
    list.innerHTML = html;
}
function renderMiniCells(cells) {
    if (!cells || !cells.length) return '';
    var out = '';
    cells.forEach(function(c) {
        var cls = 'mini-cell', title = c.date, content = '';
        var abs = c.absence_type || (c.is_vacation ? 'vacation' : '');
        if (abs) {
            cls += ' ' + absenceClass(abs);
            content = absenceIcon(abs);
            title += ' — ' + absenceLabel(abs);
        } else if (c.hours > 0) {
            var col = cellLightGreen(c.hours);
            content = '<span class="mini-h">' + shortHours(c.hours) + '</span>';
            title += ' — ' + formatHours(c.hours);
            if (c.is_today) cls += ' today';
            out += '<div class="' + cls + '" style="background:' + col + ';color:#1a9c52;" title="' + escapeHtml(title) + '">' + content + '</div>';
            return;
        } else if (c.is_holiday) { cls += ' holiday'; content = '🎉'; title += ' — праздник'; }
        else if (c.is_weekend) { cls += ' weekend'; title += ' — выходной'; }
        else if (c.missing) { cls += ' missing'; content = '!'; title += ' — не заполнено'; }
        else if (c.is_workday) { cls += ' workday'; title += ' — не заполнено'; }
        if (c.is_today) cls += ' today';
        out += '<div class="' + cls + '" title="' + escapeHtml(title) + '">' + content + '</div>';
    });
    return out;
}

/* ============================================================
   КАРТОЧКА ЗАДАЧИ
   ============================================================ */
function openTaskCardModal(taskId) {
    var from = $('sumDateFrom') ? $('sumDateFrom').value : '';
    var to = $('sumDateTo') ? $('sumDateTo').value : '';
    if (!from || !to) {
        var t = new Date();
        from = firstOfMonthISOFromDate(t);
        to = todayISO();
    }
    var qs = '?task=' + encodeURIComponent(taskId)
        + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    apiJson('/api/tracker/task/card' + qs)
        .then(function(d) {
            if (!d.success) throw new Error(d.error || 'Ошибка');
            // PATCH: сохраняем для PATCH 26/29
            state.__lastTaskCardData = d;
            renderTaskCardModal(d);
            if (window.__trkTaskFeedRender) { try { window.__trkTaskFeedRender(d); } catch(e){} }
            if (window.__trkRenderTaskCardEmployees) { try { window.__trkRenderTaskCardEmployees(d); } catch(e){} }
            if (window.__trkInjectTaskSummary) { setTimeout(function() { try { window.__trkInjectTaskSummary(); } catch(e){} }, 80); }
            var m = $('taskCardModal'); if (m) m.classList.add('active');
        })
        .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function renderTaskCardModal(d) {
    var task = d.task || {};
    var period = d.from ? (formatDateHuman(d.from) + ' — ' + formatDateHuman(d.to)) : '';
    var badge = '';
    if (task.completion_kind) {
        var cls = task.completion_kind;
        var txt = cls === 'early' ? '✅ Админ-досрочно' : (cls === 'late' ? '⏰ Админ-с опозданием' : '✅ Админ-в срок');
        if (typeof task.days_delta === 'number') {
            if (task.days_delta < 0) txt += ' (' + Math.abs(task.days_delta) + ' дн. раньше)';
            else if (task.days_delta > 0) txt += ' (' + task.days_delta + ' дн. позже)';
        }
        if (task.completed_at) txt += ' · ' + task.completed_at;
        // PATCH v1.0.9: показываем точное время автозакрытия
        if (task.auto_closed_at) txt += ' · 🤖 автозакрытие ' + task.auto_closed_at;
        badge = '<div class="task-completion-badge ' + cls + '" style="margin-top:6px;">' + escapeHtml(txt) + '</div>';
    }
    var tagsHtml = '';
    if (task.tags && task.tags.length) {
        tagsHtml = '<div style="margin-top:6px;">'
            + task.tags.map(function(x) { return '<span class="task-tag-chip">#' + escapeHtml(x) + '</span>'; }).join('')
            + '</div>';
    }
    var head = $('taskCardHead');
    if (head) head.innerHTML = '<div class="emp-day-avatar" style="background:var(--trk-filter-active-bg);font-size:1.6rem;">'
        + escapeHtml(task.icon || '📋') + '</div>'
        + '<div class="emp-day-info"><div class="emp-day-name' + (task.overdue ? ' overdue' : '') + '">'
        + escapeHtml(task.name || '—') + (task.overdue ? ' ⚠' : '') + '</div>'
        + '<div class="emp-day-role">' + escapeHtml(period)
        + (task.start_date ? ' · 🚀 ' + escapeHtml(formatDateHuman(task.start_date)) : '')
        + (task.deadline ? ' · ⏰ ' + escapeHtml(formatDateHuman(task.deadline)) : '') + '</div>'
        + tagsHtml
        + badge + '</div>'
        + '<div class="emp-day-stats">'
        + '<div class="emp-day-stat"><span class="val">' + formatHours(d.total_hours) + '</span><span class="lbl">часов</span></div>'
        + '<div class="emp-day-stat"><span class="val">' + d.active_days + ' / ' + (d.possible_days || 0) + '</span><span class="lbl">дней</span></div>'
        + '</div>';
    var hm = $('taskCardHeatmap'); if (hm) hm.innerHTML = renderMiniCells(d.cells);
    var cov = (typeof d.coverage === 'number') ? _coverageBar(d.coverage) : '';
    var list = $('taskCardEmployees');
    if (!list) return;
    if (!d.employees.length) { list.innerHTML = cov + '<div class="day-empty">За этот период отметок нет.</div>'; return; }
    var html = cov;
    d.employees.forEach(function(e) {
        var extra = '';
        if (e.emp_completion_kind) {
            var cls = e.emp_completion_kind;
            var t2 = cls === 'early' ? '✅ Досрочно' : (cls === 'late' ? '⏰ Позже' : '✅ В срок');
            if (e.emp_completed_at) t2 += ' ' + e.emp_completed_at;
            extra = '<span class="task-completion-badge ' + cls + '" style="margin-left:6px;">' + escapeHtml(t2) + '</span>';
        } else if (e.overdue) {
            extra = '<span class="task-completion-badge late" style="margin-left:6px;">⚠ не закрыл</span>';
        }
        var empMini = '';
        if (e.cells && e.cells.length) {
            empMini = '<div class="mini-heatmap" style="margin-top:6px;">' + renderMiniCells(e.cells) + '</div>';
        }
        html += '<div class="day-entry' + (e.overdue ? ' overdue' : '') + '">'
            + '<div class="day-entry-avatar" style="background:' + escapeHtml(e.employee_color) + ';box-shadow:0 0 10px ' + escapeHtml(e.employee_color) + ';">'
            + escapeHtml(initials(e.employee_name)) + '</div>'
            + '<div class="day-entry-body"><div class="day-entry-head">'
            + '<span class="day-entry-task">' + escName(e.employee_name) + '</span>'
            + '<span class="day-entry-hours">' + formatHours(e.total_hours) + '</span>'
            + '<span class="day-entry-status status-in_progress">' + e.active_days + ' дн.</span>'
            + extra + '</div>'
            + '<div class="day-entry-employee-row">'
            + (e.employee_department ? '<span class="emp-dept">🏢 ' + escapeHtml(e.employee_department) + '</span>' : '')
            + '</div>'
            + empMini
            + '</div></div>';
    });
    list.innerHTML = html;
}

/* ============================================================
   СТАТИСТИКА
   ============================================================ */
function loadStats() {
    var from = $('stDateFrom') ? $('stDateFrom').value : '';
    var to = $('stDateTo') ? $('stDateTo').value : '';
    if (!from) { from = firstOfMonthISO(todayYM()); if ($('stDateFrom')) $('stDateFrom').value = from; }
    if (!to) { to = todayISO(); if ($('stDateTo')) $('stDateTo').value = to; }
    var emp = $('stEmployeeFilter') ? ($('stEmployeeFilter').value || '') : '';
    var dept = $('stDeptFilter') ? ($('stDeptFilter').value || '') : '';
    var team = $('stTeamFilter') ? ($('stTeamFilter').value || '') : '';
    var tagArr2 = (window.__trkSelectedTags && window.__trkSelectedTags.stTagFilter) || [];
    var tag = tagArr2.join(',');
    var stTagMode = (window.__trkTagMode && window.__trkTagMode.stTagFilter) || 'any';
    var qs = '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)
        + '&employee=' + encodeURIComponent(emp) + '&department=' + encodeURIComponent(dept)
        + '&team=' + encodeURIComponent(team) + '&tag=' + encodeURIComponent(tag)
        + '&tag_mode=' + encodeURIComponent(stTagMode);
    apiJson('/api/tracker/stats' + qs).then(function(d) {
        if (!d.success) throw new Error(d.error || 'Ошибка');
        renderStats(d);
    }).catch(function(err) {
        var ov = $('stOverall');
        if (ov) ov.innerHTML = '<div class="sum-empty" style="color:#e74c3c;">❌ ' + escapeHtml(err.message || 'Ошибка') + '</div>';
        var ex = $('stExtras'); if (ex) ex.innerHTML = '';
    });
}

function _buildBarChart(title, series, labelKey, valueKey, color) {
    var box = document.createElement('div');
    box.className = 'chart-block';
    if (!series || !series.length) {
        box.innerHTML = '<div class="chart-title">' + escapeHtml(title) + '</div>'
            + '<div class="dict-empty">Нет данных</div>';
        return box;
    }
    var maxV = 0;
    series.forEach(function(p) { maxV = Math.max(maxV, Number(p[valueKey]) || 0); });
    maxV = maxV || 1;
    var W = 560, H = 180, PAD = 28;
    var n = series.length;
    var stepX = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
    var labelEvery = Math.max(1, Math.floor(n / 8));
    var bars = '';
    series.forEach(function(p, i) {
        var x = PAD + i * stepX;
        var v = Number(p[valueKey]) || 0;
        var h = (v / maxV) * (H - PAD * 2);
        var y = H - PAD - h;
        var bw = n > 1 ? Math.max(2, stepX * 0.7) : 20;
        bars += '<rect class="chart-bar" data-date="' + escapeHtml(p[labelKey]) + '" '
             + 'x="' + (x - bw / 2) + '" y="' + y
             + '" width="' + bw + '" height="' + Math.max(0, h)
             + '" rx="3" fill="' + color + '">'
             + '<title>' + escapeHtml(p[labelKey]) + ': ' + v + ' ч · клик → фильтр по этой дате</title></rect>';
        if (i % labelEvery === 0) {
            bars += '<text class="chart-label" x="' + x + '" y="' + (H - 8) + '">'
                 + escapeHtml(formatDateShort(p[labelKey])) + '</text>';
        }
    });
    var grid = '';
    for (var g = 0; g <= 3; g++) {
        var yy = PAD + (H - PAD * 2) * (g / 3);
        grid += '<line class="chart-grid-line" x1="' + PAD + '" x2="' + (W - PAD) + '" y1="' + yy + '" y2="' + yy + '"></line>';
    }
    box.innerHTML = '<div class="chart-title">' + escapeHtml(title) + ' · макс ' + maxV + ' ч</div>'
        + '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart-svg" preserveAspectRatio="none">'
        + grid + bars + '</svg>'
        + '<div class="assignees-hint">Клик по столбику — фильтр по этой дате</div>';
    box.querySelectorAll('rect.chart-bar').forEach(function(rect) {
        rect.addEventListener('click', function() {
            var dk = this.getAttribute('data-date');
            if (!dk) return;
            var a = $('stDateFrom'), b = $('stDateTo');
            if (a) a.value = dk;
            if (b) b.value = dk;
            notify('📅 Фильтр: ' + dk);
            loadStats();
        });
    });
    return box;
}
function _buildDonutChart(title, tags) {
    var box = document.createElement('div');
    box.className = 'chart-block';
    var total = tags.reduce(function(s, x) { return s + (Number(x.hours) || 0); }, 0);
    if (!total) {
        box.innerHTML = '<div class="chart-title">' + escapeHtml(title) + '</div>'
            + '<div class="dict-empty">Нет данных</div>';
        return box;
    }
    var colors = ['#f5d76e', '#e6a81a', '#4caf50', '#3498db', '#9b59b6',
                  '#e74c3c', '#00bcd4', '#ff5722', '#607d8b', '#8bc34a'];
    var cx = 100, cy = 100, r = 70, inner = 45;
    var ang = -Math.PI / 2;
    var svg = '<svg viewBox="0 0 200 200" class="chart-svg" style="height:180px;">';
    var legend = '<div class="donut-legend">';
    tags.slice(0, 10).forEach(function(t, i) {
        var v = Number(t.hours) || 0;
        var slice = (v / total) * Math.PI * 2;
        var a1 = ang, a2 = ang + slice;
        var color = colors[i % colors.length];
        var large = slice > Math.PI ? 1 : 0;
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
        var xi1 = cx + inner * Math.cos(a1), yi1 = cy + inner * Math.sin(a1);
        var xi2 = cx + inner * Math.cos(a2), yi2 = cy + inner * Math.sin(a2);
        svg += '<path class="chart-slice" data-tag="' + escapeHtml(t.tag) + '" '
            + 'd="M ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
            + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2)
            + ' L ' + xi2.toFixed(2) + ' ' + yi2.toFixed(2)
            + ' A ' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + xi1.toFixed(2) + ' ' + yi1.toFixed(2)
            + ' Z" fill="' + color + '">'
            + '<title>#' + escapeHtml(t.tag) + ': ' + v + ' ч · клик → фильтр по тегу</title></path>';
        legend += '<div class="donut-legend-item clickable" data-tag="' + escapeHtml(t.tag) + '">'
            + '<span class="dl-color" style="background:' + color + ';"></span>'
            + '<span class="dl-label">#' + escapeHtml(t.tag) + '</span>'
            + '<span class="dl-value">' + v + ' ч</span>'
            + '</div>';
        ang = a2;
    });
    svg += '</svg>';
    legend += '</div>';
    box.innerHTML = '<div class="chart-title">' + escapeHtml(title) + '</div>'
        + '<div style="display:grid;grid-template-columns:200px 1fr;gap:12px;align-items:center;">'
        + svg + legend + '</div>'
        + '<div class="assignees-hint">Клик по сектору или легенде — фильтр по тегу</div>';
    box.querySelectorAll('.chart-slice, .donut-legend-item.clickable').forEach(function(el) {
        el.addEventListener('click', function() {
            var tag = this.getAttribute('data-tag');
            if (!tag) return;
            window.__trkSelectedTags = window.__trkSelectedTags || {};
            window.__trkSelectedTags.stTagFilter = [tag];
            if (window.__trkRenderTagPills) window.__trkRenderTagPills();
            notify('🏷 Фильтр: #' + tag);
            loadStats();
        });
    });
    return box;
}
function renderStats(d) {
    var o = d.overall || {};
    var ov = $('stOverall');
    if (ov) ov.innerHTML =
        '<div class="stat-card"><span class="stat-label">Сотрудников</span><span class="stat-value">' + (o.employees_count || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">Всего задач</span><span class="stat-value">' + (o.tasks_total || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">Закрыто</span><span class="stat-value" style="color:#2ecc71;">' + (o.tasks_done || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">В работе</span><span class="stat-value" style="color:#3498db;">' + (o.tasks_active || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">Просрочено</span><span class="stat-value" style="color:#e74c3c;">' + (o.tasks_overdue || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">Досрочно</span><span class="stat-value" style="color:#9b59b6;">' + (o.early_done || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">С опозданием</span><span class="stat-value" style="color:#e67e22;">' + (o.late_done || 0) + '</span></div>'
        + '<div class="stat-card"><span class="stat-label">Часов всего</span><span class="stat-value">' + formatHours(o.hours_total || 0) + '</span></div>';

    var chartsEl = $('stCharts');
    if (chartsEl) {
        chartsEl.innerHTML = '';
        if (d.hours_series && d.hours_series.length) {
            chartsEl.appendChild(_buildBarChart(
                'Часы по дням', d.hours_series, 'date', 'hours', '#5bc0de'));
        }
        if (d.tags_summary && d.tags_summary.length) {
            chartsEl.appendChild(_buildDonutChart(
                'Распределение часов по тегам', d.tags_summary));
        }
    }

    var ov2 = $('stOverdue');
    if (ov2) {
        var det = d.overdue_details || [];
        if (!det.length) { ov2.style.display = 'none'; ov2.innerHTML = ''; }
        else {
            ov2.style.display = '';
            var h = '<div class="sum-extra-title" style="color:#e74c3c;">⚠ Просроченные задачи (' + det.length + ')</div>'
                + '<div class="sum-table-wrap scroll-block"><table class="sum-table grid-table"><thead><tr>'
                + '<th class="task-col">Задача</th><th>Дедлайн</th><th>Просрочка</th><th>Не закрыли</th>'
                + '</tr></thead><tbody>';
            det.forEach(function(t) {
                var ass = (t.assignees || []).map(function(a) {
                    return '<span class="emp-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + escapeHtml(a.color) + ';margin-right:4px;"></span>' + escName(a.name);
                }).join(', ') || '—';
                h += '<tr><td class="task-cell overdue" style="text-align:left;">'
                    + '<span class="task-ico">' + escapeHtml(t.task_icon) + '</span>' + escapeHtml(t.task_name) + '</td>'
                    + '<td>' + escapeHtml(t.deadline) + '</td>'
                    + '<td style="color:#e74c3c;font-weight:700;">' + t.days_overdue + ' дн.</td>'
                    + '<td style="text-align:left;font-size:0.78rem;">' + ass + '</td></tr>';
            });
            h += '</tbody></table></div>';
            ov2.innerHTML = h;
        }
    }

    var tb = $('stTagsBlock');
    if (tb) {
        var ts = d.tags_summary || [];
        if (!ts.length) { tb.style.display = 'none'; tb.innerHTML = ''; }
        else {
            tb.style.display = '';
            var th = '<div class="sum-extra-title">🏷 Сводка по тегам</div>'
                + '<div class="sum-table-wrap scroll-block"><table class="sum-table grid-table"><thead><tr>'
                + '<th class="task-col">Тег</th><th>Задач</th><th>Закрыто</th><th>Просрочено</th><th>Часов</th>'
                + '</tr></thead><tbody>';
            ts.forEach(function(t) {
                th += '<tr>'
                    + '<td style="text-align:left;"><span class="task-tag-chip clickable" data-tag="' + escapeHtml(t.tag) + '" style="cursor:pointer;">#' + escapeHtml(t.tag) + '</span></td>'
                    + '<td>' + t.tasks + '</td>'
                    + '<td style="color:#2ecc71;font-weight:700;">' + t.done + '</td>'
                    + '<td style="color:#e74c3c;font-weight:700;">' + t.overdue + '</td>'
                    + '<td class="total-cell">' + formatHours(t.hours) + '</td>'
                    + '</tr>';
            });
            th += '</tbody></table></div>';
            tb.innerHTML = th;
            tb.querySelectorAll('.task-tag-chip.clickable').forEach(function(el) {
                el.addEventListener('click', function() {
                    var tag = this.getAttribute('data-tag');
                    window.__trkSelectedTags = window.__trkSelectedTags || {};
                    window.__trkSelectedTags.stTagFilter = [tag];
                    if (window.__trkRenderTagPills) window.__trkRenderTagPills();
                    loadStats();
                });
            });
        }
    }

    var extras = '';
    extras += '<div class="sum-extra-block" style="margin-bottom:14px;">'
        + '<div class="sum-extra-title">👥 По сотрудникам</div>'
        + '<div class="sum-table-wrap scroll-block"><table class="sum-table grid-table"><thead><tr>'
        + '<th class="emp-col">Сотрудник</th><th>Отдел</th><th>Часов</th><th>Задач</th>'
        + '<th>Закрыто</th><th>В работе</th><th>Просроч.</th><th>Досрочно</th><th>Позже</th>'
        + '<th>🌞/🤒/✈️</th></tr></thead><tbody>';
    (d.by_employee || []).forEach(function(r) {
        var fired = r.employee_fired ? ' <span class="emp-fired" title="уволен ' + escapeHtml(r.employee_fired_date) + '">🚪</span>' : '';
        extras += '<tr>'
            + '<td class="emp-cell"><div class="emp-cell-inner"><div class="emp-cell-name"><span class="emp-dot" style="background:' + escapeHtml(r.employee_color) + ';"></span>' + escName(r.employee_name) + fired + '</div></div></td>'
            + '<td>' + escapeHtml(r.employee_department || '—') + '</td>'
            + '<td class="total-cell">' + formatHours(r.hours) + '</td>'
            + '<td>' + r.total_tasks + '</td>'
            + '<td style="color:#2ecc71;font-weight:700;">' + r.done_tasks + '</td>'
            + '<td style="color:#3498db;font-weight:700;">' + r.active_tasks + '</td>'
            + '<td style="color:#e74c3c;font-weight:700;">' + r.overdue_tasks + '</td>'
            + '<td style="color:#9b59b6;">' + r.early_done + '</td>'
            + '<td style="color:#e67e22;">' + (r.late_done || 0) + '</td>'
            + '<td>' + (r.vacation_days || 0) + ' / ' + (r.sick_days || 0) + ' / ' + (r.business_trip_days || 0) + '</td></tr>';
    });
    extras += '</tbody></table></div></div>';
    extras += '<div class="sum-extra-block">'
        + '<div class="sum-extra-title">📋 По задачам</div>'
        + '<div class="sum-table-wrap scroll-block"><table class="sum-table grid-table"><thead><tr>'
        + '<th class="task-col">Задача</th><th>Теги</th><th>Статус</th><th>Дедлайн</th><th>Завершена</th>'
        + '<th>Закрыли</th><th>Назначено</th><th>Работали</th><th>Часов</th></tr></thead><tbody>';
    (d.by_task || []).forEach(function(t) {
        var st = ({'active':'Активна','done':'✅ Выполнена','paused':'Пауза','archived':'Архив'})[t.status] || t.status;
        var ovMark = t.overdue ? ' <span style="color:#e74c3c;">⚠</span>' : '';
        var comp = t.completed_at || '—';
        if (t.completion_kind === 'early') comp += ' <span style="color:#2ecc71;">✓</span>';
        else if (t.completion_kind === 'late') comp += ' <span style="color:#e67e22;">⌛</span>';
        var tagsHtml = (t.task_tags && t.task_tags.length)
            ? t.task_tags.slice(0, 4).map(function(x) { return '<span class="task-tag-chip">#' + escapeHtml(x) + '</span>'; }).join('')
            : '—';
        extras += '<tr>'
            + '<td class="task-cell' + (t.overdue ? ' overdue' : '') + '" style="text-align:left;">'
            + '<span class="task-ico">' + escapeHtml(t.task_icon) + '</span>' + escapeHtml(t.task_name) + ovMark + '</td>'
            + '<td style="text-align:left;">' + tagsHtml + '</td>'
            + '<td>' + escapeHtml(st) + '</td>'
            + '<td>' + escapeHtml(t.deadline || '—') + '</td>'
            + '<td>' + comp + '</td>'
            + '<td>' + (t.closed_by_count || 0) + ' / ' + t.assigned_count + '</td>'
            + '<td>' + t.assigned_count + '</td>'
            + '<td>' + t.workers_count + '</td>'
            + '<td class="total-cell">' + formatHours(t.hours) + '</td></tr>';
    });
    extras += '</tbody></table></div></div>';
    var ex = $('stExtras'); if (ex) ex.innerHTML = extras;
}
on('stApplyBtn', 'click', loadStats);
on('stMonthBtn', 'click', function() {
    if ($('stDateFrom')) $('stDateFrom').value = firstOfMonthISO(todayYM());
    if ($('stDateTo')) $('stDateTo').value = todayISO();
    loadStats();
});
on('stDeptFilter', 'change', loadStats);
on('stTeamFilter', 'change', loadStats);
on('stEmployeeFilter', 'change', loadStats);
on('stTagFilter', 'change', loadStats);

/* ============================================================
   HEATMAP
   ============================================================ */
/* PATCH hm-emp: старый heatmap удалён — остались тонкие делегаты в новый движок (IIFE в конце файла). */
function loadHeatmap() {
    if (typeof window.__hmEmpLoad === 'function') return window.__hmEmpLoad();
}
function renderHeatmap() {
    if (typeof window.__hmEmpRender === 'function') return window.__hmEmpRender();
}

/* ============================================================
   КАРТОЧКА СОТРУДНИКА ЗА ДЕНЬ
   ============================================================ */
function openEmpDayModal(empId, dateStr) {
    apiJson('/api/tracker/employee/day?employee=' + encodeURIComponent(empId) + '&date=' + encodeURIComponent(dateStr))
        .then(function(d) {
            if (!d.success) throw new Error(d.error || 'Ошибка');
            renderEmpDayModal(d);
            var m = $('empDayModal'); if (m) m.classList.add('active');
        })
        .catch(function(err) { if (err && (err.message || '').indexOf('cancelled') !== -1) return; notify('❌ ' + (err.message || 'Ошибка'), 'error'); });
}
function renderEmpDayModal(d) {
    var emp = d.employee || {}, entries = d.entries || [];
    var badge = '';
    var abs = d.absence_type || (d.in_vacation ? 'vacation' : '');
    if (abs) {
        var cls = 'vac';
        if (abs === 'sick_leave') cls = 'sick';
        else if (abs === 'business_trip') cls = 'trip';
        else if (abs === 'remote') cls = 'remote';
        badge = '<span class="emp-day-badge ' + cls + '">' + escapeHtml(absenceLabel(abs)) + '</span>';
    } else if (d.is_workday && entries.length === 0) {
        badge = '<span class="emp-day-badge warn">⚠ Не заполнено</span>';
    } else if (entries.length > 0) {
        badge = '<span class="emp-day-badge ok">✓ Заполнено</span>';
    }
    var dept = emp.department ? ' · 🏢 ' + escapeHtml(emp.department) : '';
    var head = $('empDayHead');
    if (head) head.innerHTML = '<div class="emp-day-avatar" style="background:' + escapeHtml(emp.color || '#00897b') + ';box-shadow:0 0 12px ' + escapeHtml(emp.color || '#00897b') + ';">'
        + escapeHtml(initials(emp.name)) + '</div>'
        + '<div class="emp-day-info"><div class="emp-day-name">' + escName(emp.name || '—') + '</div>'
        + '<div class="emp-day-role">' + escapeHtml(emp.role || '') + dept + ' · ' + escapeHtml(formatDateHuman(d.date)) + '</div></div>'
        + '<div class="emp-day-stats">'
        + '<div class="emp-day-stat"><span class="val">' + formatHours(d.total_hours) + '</span><span class="lbl">часов</span></div>'
        + '<div class="emp-day-stat"><span class="val">' + entries.length + '</span><span class="lbl">задач</span></div>'
        + '</div>' + badge;
    var list = $('empDayList'); if (!list) return;
    if (!entries.length) { list.innerHTML = '<div class="day-empty">За этот день отметок нет.</div>'; return; }
    var html = '';
    var full = [];
    entries.forEach(function(en) {
        var f = Object.assign({}, en);
        f.employee_id = emp.id || '';
        f.employee_name = emp.name; f.employee_color = emp.color;
        f.employee_department = emp.department; f.date = d.date;
        full.push(f);
        html += dayEntryCard(f, false);
    });
    list.innerHTML = html;
    bindDayEntryActions(list, full);
}

/* ============================================================
   ФИЛЬТРЫ ЗАДАЧ
   ============================================================ */
on('tskDeptFilter', 'change', renderTasksFull);
on('tskCuratorFilter', 'change', renderTasksFull);
on('tskPocketFilter', 'change', renderTasksFull);
on('tskSortSelect', 'change', renderTasksFull);
(function() {
    var seg = $('tskDirSeg'); if (!seg) return;
    seg.addEventListener('click', function(ev) {
        var b = ev.target.closest('button[data-v]'); if (!b) return;
        state.tskDir = b.getAttribute('data-v');
        try { localStorage.setItem('tracker_tsk_dir', state.tskDir); } catch (e) {}
        renderTasksFull();
    });
})();

on('tskGridCols', 'change', function() {
    var v = parseInt(this.value, 10) || 3;
    if (v < 1) v = 1;
    if (v > 5) v = 5;
    state.tskGridCols = v;
    try { localStorage.setItem('tracker_tsk_cols', String(v)); } catch (e) {}
    renderTasksFull();
});
(function initTskDisplay() {
    var cols = 3;
    var legacyMode = 'grid';
    try {
        legacyMode = localStorage.getItem('tracker_tsk_display') || 'grid';
        cols = parseInt(localStorage.getItem('tracker_tsk_cols') || '3', 10) || 3;
    } catch (e) {}
    if (legacyMode === 'list') cols = 1;
    if (cols < 1 || cols > 5) cols = 3;
    state.tskDisplayMode = 'grid';
    state.tskGridCols = cols;
    var wrap = $('tskColsWrap');
    if (wrap) wrap.style.display = '';
    var sel = $('tskGridCols');
    if (sel) sel.value = String(cols);
})();

/* ============================================================
   ЗАКРЫТИЕ МОДАЛОК
   ============================================================ */
document.querySelectorAll('[data-close]').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var id = this.getAttribute('data-close');
        var m = $(id);
        if (m) m.classList.remove('active');
        if (id === 'dayModal') {
            var a = $('dayModalLeftActions'); if (a) a.style.display = '';
            var c = $('dayClearBtn'); if (c) c.style.display = '';
        }
    });
});
// PATCH 1.0.12: не закрываем по клику вне для ключевых модалок
var _trkNoClickClose = { dayModal: 1, logModal: 1, taskModal: 1 };
document.querySelectorAll('.modal').forEach(function(m) {
    m.addEventListener('click', function(e) {
        if (e.target === m) {
            if (_trkNoClickClose[m.id]) return;
            m.classList.remove('active');
            if (m.id === 'dayModal') {
                var a = $('dayModalLeftActions'); if (a) a.style.display = '';
                var c = $('dayClearBtn'); if (c) c.style.display = '';
            }
        }
    });
});
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal.active').forEach(function(m) { m.classList.remove('active'); });
        var a = $('dayModalLeftActions'); if (a) a.style.display = '';
        var c = $('dayClearBtn'); if (c) c.style.display = '';
    }
});

/* ============================================================
   SEGMENTED
   ============================================================ */
(function initCalViewMode() {
    var saved = 'tasks';
    try { saved = localStorage.getItem('tracker_cal_view') || 'tasks'; } catch (e) {}
    if (saved !== 'tasks' && saved !== 'employees') saved = 'tasks';
    state.calViewMode = saved;
    var wrap = $('calViewMode');
    if (wrap) {
        wrap.querySelectorAll('button').forEach(function(b) {
            b.classList.toggle('active', b.getAttribute('data-mode') === saved);
        });
    }
})();
setupSegmented('calViewMode', state.calViewMode, function(mode) {
    state.calViewMode = mode;
    try { localStorage.setItem('tracker_cal_view', mode); } catch (e) {}
    renderCalendar();
});
setupSegmented('sumViewMode', state.sumViewMode, function(mode) { state.sumViewMode = mode; loadSummary(); });
setupSegmented('sumTaskRowMode', state.sumTaskRowMode || 'full', function(mode) {
    state.sumTaskRowMode = mode;
    try { localStorage.setItem('tracker_sum_row_mode', mode); } catch (e) {}
    if (state.summaryIsGrid && state.summary) renderSummaryGrid();
});
setupSegmented('tskViewMode', state.tskViewMode, function(mode) { state.tskViewMode = mode; renderTasksFull(); });

/* ============================================================
   СТАРТ
   ============================================================ */
state.currentYM = todayYM();
state.hmYM = todayYM();
setDefaultWeekRange();
if ($('stDateFrom') && !$('stDateFrom').value) {
    $('stDateFrom').value = firstOfMonthISO(todayYM());
    $('stDateTo').value = todayISO();
}
applyPermsToUI();
if (typeof applySummaryColWidths === 'function') applySummaryColWidths();
try {
    var _rm = localStorage.getItem('tracker_sum_row_mode');
    if (_rm === 'compact' || _rm === 'full') state.sumTaskRowMode = _rm;
} catch (e) {}

loadState().then(function() {
    fillDepartmentFilters();
    fillTeamFilters();
    fillEmployeeFilter();
    if (hasPerm('tab.calendar')) loadCalendar();
});

})();
