/* tracker/ui.js — Патчи интерфейса: поиск, колонки, плитка/список, модалки задач, дубли, объединение, лоадер.
   Файлы грузятся строго по порядку: boot → core → ui → task_card → tabs (см. templates/tracker.html). */
/* ============================================================
   PATCH 2026-10-06 — мультитеги, автосортировка по тегам
   ============================================================ */
(function() {
    function _initTagFilterUI() {
        ['tskTagFilter', 'sumTagFilter', 'stTagFilter'].forEach(function(id) {
            var sel = document.getElementById(id);
            if (!sel) return;
            if (document.getElementById(id + 'Pills')) return;
            var wrap = document.createElement('div');
            wrap.className = 'tag-filter-pills';
            wrap.id = id + 'Pills';
            wrap.setAttribute('data-target', id);
            sel.parentNode.insertBefore(wrap, sel);
            sel.style.display = 'none';
        });
    }
    function _renderTagPills() {
        ['tskTagFilter', 'sumTagFilter', 'stTagFilter'].forEach(function(id) {
            var wrap = document.getElementById(id + 'Pills');
            if (!wrap) return;
            var cur = (window.__trkSelectedTags && window.__trkSelectedTags[id]) || [];
            var all = Object.keys(window.__trkAllTags || {}).sort();
            if (!all.length) { wrap.innerHTML = '<span style="color:var(--trk-meta);font-size:0.72rem;">—</span>'; return; }
            var html = '';
            all.forEach(function(t) {
                var act = cur.indexOf(t) !== -1 ? ' active' : '';
                html += '<button type="button" class="tag-chip' + act + '" data-tag="' + t + '">#' + t + '</button>';
            });
            if (cur.length) {
                html += '<button type="button" class="tag-clear" title="Очистить">✕</button>';
            }
            if (cur.length > 1) {
                var mode = (window.__trkTagMode && window.__trkTagMode[id]) || 'any';
                html += '<button type="button" class="tag-mode" data-target="' + id + '" title="Логика фильтра: И (все теги) / ИЛИ (любой тег)">'
                    + (mode === 'all' ? 'И' : 'ИЛИ') + '</button>';
            }
            wrap.innerHTML = html;
            wrap.querySelectorAll('.tag-chip').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var t = this.getAttribute('data-tag');
                    var arr = window.__trkSelectedTags[id] = window.__trkSelectedTags[id] || [];
                    var i = arr.indexOf(t);
                    if (i === -1) arr.push(t); else arr.splice(i, 1);
                    _renderTagPills();
                    var ev = { tsk: 'renderTasksFull', sum: 'loadSummary', st: 'loadStats' };
                    var pre = id.slice(0, 3);
                    if (ev[pre] && typeof window[ev[pre]] === 'function') window[ev[pre]]();
                    else if (typeof window.__trkLoadSummary === 'function') window.__trkLoadSummary();
                });
            });
            var clr = wrap.querySelector('.tag-clear');
            if (clr) clr.addEventListener('click', function() {
                window.__trkSelectedTags[id] = [];
                _renderTagPills();
                if (id.indexOf('tsk') === 0) renderTasksFull();
                else if (id.indexOf('sum') === 0 && window.__trkLoadSummary) window.__trkLoadSummary();
                else if (typeof loadStats === 'function') loadStats();
            });
            var modeBtn = wrap.querySelector('.tag-mode');
            if (modeBtn) modeBtn.addEventListener('click', function() {
                window.__trkTagMode = window.__trkTagMode || {};
                window.__trkTagMode[id] = (window.__trkTagMode[id] === 'all') ? 'any' : 'all';
                _renderTagPills();
                if (id.indexOf('tsk') === 0) renderTasksFull();
                else if (id.indexOf('sum') === 0 && window.__trkLoadSummary) window.__trkLoadSummary();
                else if (typeof loadStats === 'function') loadStats();
            });
        });
    }
    window.__trkRenderTagPills = _renderTagPills;
    window.__trkInitTagFilterUI = _initTagFilterUI;
    window.__trkSelectedTags = { tskTagFilter: [], sumTagFilter: [], stTagFilter: [] };
    window.__trkTagMode = { tskTagFilter: 'any', sumTagFilter: 'any', stTagFilter: 'any' };
    window.__trkAllTags = {};
})();
/* ============================================================
   PATCH 2026-10-06 — Свод: тулбар в 2 ряда
   ============================================================ */
(function() {
    'use strict';

    function reorganize() {
        var toolbar = document.querySelector('#panel-summary .sum-toolbar');
        if (!toolbar || toolbar.classList.contains('sum-toolbar-v2')) return;

        var $id = function(id) { return document.getElementById(id); };

        var arrowsL = toolbar.querySelectorAll('.period-arrows')[0];
        var arrowsR = toolbar.querySelectorAll('.period-arrows')[1];
        var sumGroup = toolbar.querySelector('.sum-group');
        var weekBtn = $id('sumWeekBtn');
        var monthBtn = $id('sumMonthBtn');
        var applyBtn = $id('sumApplyBtn');
        var showTotalsLabel = toolbar.querySelector('label.sum-toggle');
        var viewModeSeg = $id('sumViewMode');
        var taskRowModeSeg = $id('sumTaskRowMode');

        var filterLabels = [];
        ['sumDeptFilter', 'sumTeamFilter', 'sumEmployeeFilter', 'sumTaskFilter', 'sumTagFilter'].forEach(function(fid) {
            var el = $id(fid);
            if (!el) return;
            var lbl = el.closest('.sum-filter');
            if (lbl) filterLabels.push(lbl);
        });

        var row1 = document.createElement('div');
        row1.className = 'sum-row sum-row-1';
        var row2 = document.createElement('div');
        row2.className = 'sum-row sum-row-2';

        if (arrowsL) row1.appendChild(arrowsL);
        if (sumGroup) row1.appendChild(sumGroup);
        if (arrowsR) row1.appendChild(arrowsR);

        if (weekBtn || monthBtn || applyBtn) {
            var sep1 = document.createElement('span');
            sep1.className = 'sum-sep';
            row1.appendChild(sep1);
        }
        if (weekBtn) row1.appendChild(weekBtn);
        if (monthBtn) row1.appendChild(monthBtn);
        if (applyBtn) row1.appendChild(applyBtn);

        if (showTotalsLabel || viewModeSeg || taskRowModeSeg) {
            var sep2 = document.createElement('span');
            sep2.className = 'sum-sep';
            row1.appendChild(sep2);
        }
        if (showTotalsLabel) row1.appendChild(showTotalsLabel);
        if (viewModeSeg) row1.appendChild(viewModeSeg);
        if (taskRowModeSeg) row1.appendChild(taskRowModeSeg);

        var spacer = document.createElement('div');
        spacer.className = 'sum-spacer';
        row1.appendChild(spacer);

        filterLabels.forEach(function(lbl) { row2.appendChild(lbl); });

        toolbar.innerHTML = '';
        toolbar.appendChild(row1);
        toolbar.appendChild(row2);
        toolbar.classList.add('sum-toolbar-v2');

        var observer = new MutationObserver(function() {
            var eb = $id('excelExportBtn');
            if (eb && eb.parentNode !== row1) {
                row1.insertBefore(eb, spacer);
            }
        });
        observer.observe(toolbar, { childList: true, subtree: true });
    }

    function boot() {
        setTimeout(reorganize, 200);
        setTimeout(reorganize, 900);
        setTimeout(reorganize, 2000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="summary"]')) {
            setTimeout(reorganize, 150);
        }
    });
})();
/* ============================================================
   PATCH 2026-10-06 — Задачи: живой поиск
   ============================================================ */
(function() {
    'use strict';

    var KEY = 'tracker_tsk_search';
    var input, clearBtn, countEl, list;
    var _t = null;

    function getQuery() {
        return input ? (input.value || '').trim().toLowerCase() : '';
    }

    function haystack(t) {
        if (!t) return '';
        var parts = [
            t.name || '',
            t.description || '',
            t.folder || '',
            t.order_ref || '',
            (t.tags || []).join(' '),
            t.id || ''
        ];
        return parts.join(' \u0001 ').toLowerCase();
    }

    function matches(hay, query) {
        if (!query) return true;
        var terms = query.split(/\s+/).filter(Boolean);
        for (var i = 0; i < terms.length; i++) {
            if (hay.indexOf(terms[i]) === -1) return false;
        }
        return true;
    }

    function getTasksMap() {
        var st = window.__trkState;
        var map = {};
        if (st && st.tasks) {
            for (var i = 0; i < st.tasks.length; i++) map[st.tasks[i].id] = st.tasks[i];
        }
        return map;
    }

    function apply() {
        if (!list) list = document.getElementById('tasksFullList');
        if (!list) return;
        var query = getQuery();
        if (clearBtn) clearBtn.style.display = query ? '' : 'none';

        var cards = list.querySelectorAll('.task-card, .dict-item');
        if (!cards.length) {
            if (countEl) countEl.textContent = '';
            return;
        }

        if (!query) {
            for (var i = 0; i < cards.length; i++) { cards[i].style.display = ''; cards[i].classList.remove('trk-search-hidden'); }
            if (countEl) countEl.textContent = '';
            _searchEmpty(false);
            return;
        }

        var map = getTasksMap();
        var shown = 0, total = cards.length;
        for (var j = 0; j < cards.length; j++) {
            var c = cards[j];
            var id = c.getAttribute('data-id');
            var t = map[id];
            /* класс с !important: в плитке .task-card имеет display:flex !important и перебивает inline-стиль */
            if (matches(haystack(t), query)) {
                c.style.display = '';
                c.classList.remove('trk-search-hidden');
                shown++;
            } else {
                c.style.display = 'none';
                c.classList.add('trk-search-hidden');
            }
        }
        if (countEl) {
            countEl.textContent = shown + ' из ' + total;
            countEl.classList.toggle('no-match', shown === 0);
        }
        _searchEmpty(shown === 0);
    }

    /* 11.11: пустое состояние, когда поиск скрыл все проверки */
    function _searchEmpty(on) {
        if (!list) return;
        var ex = list.querySelector('.trk-empty-search');
        var tbl = list.querySelector('table.kp-table');
        if (tbl) tbl.style.display = on ? 'none' : '';
        if (on && !ex) {
            var d = document.createElement('div');
            d.className = 'dict-empty trk-empty trk-empty-search';
            d.innerHTML = 'Нет проверок по фильтру · <a href="#" class="trk-empty-reset">сбросить фильтры</a>';
            list.appendChild(d);
        } else if (!on && ex) {
            ex.parentNode.removeChild(ex);
        }
    }

    function onChange() {
        var v = input ? (input.value || '') : '';
        try { localStorage.setItem(KEY, v); } catch (e) {}
        if (_t) clearTimeout(_t);
        _t = setTimeout(apply, 120);
    }

    function hookList() {
        var l = document.getElementById('tasksFullList');
        if (!l || l === list) return;
        list = l;
        var obs = new MutationObserver(function() { apply(); });
        obs.observe(list, { childList: true });
        apply();
    }

    function boot() {
        input = document.getElementById('tskSearchInput');
        clearBtn = document.getElementById('tskSearchClear');
        countEl = document.getElementById('tskSearchCount');
        if (!input) return;

        try {
            var saved = localStorage.getItem(KEY);
            if (saved) input.value = saved;
        } catch (e) {}

        input.addEventListener('input', onChange);

        input.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.value = '';
                onChange();
                this.blur();
            }
        });

        if (clearBtn) clearBtn.addEventListener('click', function() {
            input.value = '';
            onChange();
            input.focus();
        });

        hookList();

        document.addEventListener('click', function(e) {
            if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="tasks"]')) {
                setTimeout(function() { hookList(); apply(); }, 200);
            }
        });

        document.addEventListener('keydown', function(e) {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            var panel = document.getElementById('panel-tasks');
            if (!panel || !panel.classList.contains('active')) return;
            e.preventDefault();
            input.focus();
            input.select();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(boot, 300); });
    } else {
        setTimeout(boot, 300);
    }
})();
/* ============================================================
   PATCH 2026-10-06 — Свод: свернуть всё / развернуть всё (v2)
   ============================================================ */
(function() {
    'use strict';

    var STORAGE = 'sum_collapsed';

    function _st() { return window.__trkState || null; }
    function _render() {
        if (window.__trkRenderSummaryGrid) window.__trkRenderSummaryGrid();
    }

    function loadCollapsed() {
        try {
            var raw = localStorage.getItem(STORAGE);
            var obj = raw ? JSON.parse(raw) : {};
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
            return obj;
        } catch (e) { return {}; }
    }

    function saveCollapsed() {
        var st = _st();
        if (!st) return;
        try { localStorage.setItem(STORAGE, JSON.stringify(st.sumCollapsed || {})); } catch (e) {}
    }

    function initCollapsed() {
        var st = _st();
        if (!st) return;
        var saved = loadCollapsed();
        var cur = st.sumCollapsed || {};
        st.sumCollapsed = Object.assign({}, cur, saved);
    }

    function isAllCollapsed() {
        var st = _st();
        if (st && st.summary && (st.summary.rows || []).length) {
            var rows = st.summary.rows;
            var c = st.sumCollapsed || {};
            for (var i = 0; i < rows.length; i++) {
                if (!c[rows[i].employee_id]) return false;
            }
            return true;
        }
        var btns = document.querySelectorAll('#sumWrap .emp-collapse-btn');
        if (!btns.length) return false;
        var domAll = true;
        btns.forEach(function(b) { if (b.textContent.trim() !== '▶') domAll = false; });
        return domAll;
    }

    function toggleAll(force) {
        var st = _st();
        if (!st || !st.summary) return;
        var rows = st.summary.rows || [];
        if (!rows.length) return;
        var target = (typeof force === 'boolean') ? force : !isAllCollapsed();
        if (target) {
            if (!st.sumCollapsed) st.sumCollapsed = {};
            rows.forEach(function(r) {
                if (r && r.employee_id) st.sumCollapsed[r.employee_id] = true;
            });
        } else {
            st.sumCollapsed = {};
        }
        saveCollapsed();
        _render();
    }

    function updateBtn() {
        var btn = document.getElementById('sumCollapseAllBtn');
        if (!btn) return;
        var st = _st();
        var isGrid = st ? !!st.summaryIsGrid : true;
        btn.style.display = isGrid ? '' : 'none';
        var all = isAllCollapsed();
        btn.textContent = all ? '▶ Развернуть все' : '▼ Свернуть все';
        btn.title = all ? 'Развернуть все блоки сотрудников' : 'Свернуть все блоки сотрудников';
    }

    function ensureBtn() {
        var toolbar = document.querySelector('#panel-summary .sum-toolbar');
        if (!toolbar) return;
        var container = toolbar.querySelector('.sum-row-1') || toolbar;
        var btn = document.getElementById('sumCollapseAllBtn');
        if (btn && btn.getAttribute('data-v2') !== '1') {
            btn.parentNode.removeChild(btn);
            btn = null;
        }
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'sumCollapseAllBtn';
            btn.type = 'button';
            btn.setAttribute('data-v2', '1');
            btn.className = 'btn btn-secondary sum-collapse-all-btn';
            btn.addEventListener('click', function() { toggleAll(); });
            var spacer = container.querySelector('.sum-spacer');
            if (spacer) container.insertBefore(btn, spacer);
            else container.appendChild(btn);
        }
        updateBtn();
    }

    window.__trkOnSummaryRender = function() { ensureBtn(); };

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.emp-collapse-btn')) {
            setTimeout(saveCollapsed, 30);
            setTimeout(updateBtn, 60);
        }
        if (e.target.closest('#sumViewMode button')) {
            setTimeout(updateBtn, 150);
        }
    }, true);

    function boot() {
        initCollapsed();
        setTimeout(ensureBtn, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.__trkCollapseAll = { toggle: toggleAll, save: saveCollapsed, load: loadCollapsed, isAll: isAllCollapsed };
})();
/* ============================================================
   PATCH 2026-10-06 — Свод: ресайз колонки «Задача» (v2)
   ============================================================ */
(function() {
    'use strict';

    function attachTaskColResize(th) {
        if (!th || th._rszHooked) return;
        th._rszHooked = true;

        th.addEventListener('mousemove', function(e) {
            var rect = th.getBoundingClientRect();
            var dx = rect.right - e.clientX;
            th.style.cursor = (dx >= 0 && dx <= 8) ? 'col-resize' : '';
        });

        th.addEventListener('mouseleave', function() {
            th.style.cursor = '';
        });

        th.addEventListener('mousedown', function(e) {
            var rect = th.getBoundingClientRect();
            var dx = rect.right - e.clientX;
            if (dx < 0 || dx > 8) return;
            e.preventDefault();
            e.stopPropagation();

            var startX = e.clientX;
            var cs = getComputedStyle(document.documentElement);
            var startW = parseInt(cs.getPropertyValue('--sum-task-w'), 10);
            if (!isFinite(startW) || startW < 40) startW = th.offsetWidth;

            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            function onMove(ev) {
                var w = Math.max(120, Math.min(1200, startW + ev.clientX - startX));
                document.documentElement.style.setProperty('--sum-task-w', w + 'px');
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                var cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sum-task-w'), 10);
                if (isFinite(cur)) { try { localStorage.setItem('sum_task_w', String(cur)); } catch (er) {} }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function hook() {
        var th = document.querySelector('#sumWrap thead th.task-col');
        if (th) attachTaskColResize(th);
    }

    function installObserver() {
        var wrap = document.getElementById('sumWrap');
        if (!wrap || wrap._rszObserver) return;
        wrap._rszObserver = new MutationObserver(function() { hook(); });
        wrap._rszObserver.observe(wrap, { childList: true, subtree: true });
    }

    function boot() {
        installObserver();
        setTimeout(hook, 500);
        setTimeout(hook, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="summary"]')) {
            setTimeout(function() { installObserver(); hook(); }, 250);
        }
        if (e.target.closest('#sumViewMode button')) {
            setTimeout(hook, 350);
        }
    });

    window.__trkResizeTaskCol = hook;
})();
/* ============================================================
   PATCH 2026-10-06 — Публичные helper'ы маскирования для плагинов
   ============================================================ */
(function() {
    'use strict';
    function maskFn(name) {
        var st = window.__trkState;
        if (!st || !st.maskNames) return String(name == null ? '' : name);
        var s = String(name == null ? '' : name);
        if (!s) return s;
        return s.split(/\s+/).map(function(w) {
            if (w.length <= 1) return w;
            return w[0] + new Array(w.length).join('*');
        }).join(' ');
    }
    window.__trkMaskName = maskFn;
    window.__trkMaskNames = false;
    window.__trkEscName = function(name) {
        var s = maskFn(name);
        return String(s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    };
})();
/* ============================================================
   PATCH 2026-10-06 — Триггер перезагрузки после клика по пилюлям тегов
   ============================================================ */
(function() {
    'use strict';
    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        var chip = e.target.closest('.tag-filter-pills .tag-chip, .tag-filter-pills .tag-clear, .tag-filter-pills .tag-mode');
        if (!chip) return;
        var wrap = chip.closest('.tag-filter-pills');
        var target = wrap ? wrap.getAttribute('data-target') : '';
        setTimeout(function() {
            if (target === 'sumTagFilter' && window.__trkLoadSummary) window.__trkLoadSummary();
            else if (target === 'stTagFilter' && window.__trkLoadStats) window.__trkLoadStats();
            else if (target === 'tskTagFilter' && window.__trkRenderTasksFull) window.__trkRenderTasksFull();
        }, 40);
    }, true);
})();
/* ============================================================
   PATCH 2026-10-06 — Создать задачу из карточки дня
   ============================================================ */
(function() {
    'use strict';

    function looksLikeCreateTask(btn) {
        if (!btn) return false;
        var id = (btn.id || '').toLowerCase();
        if (id === 'daycreatetaskbtn' || id === 'dayaddtaskbtn' || id === 'daynewtaskbtn' || id === 'createtaskfromday') return true;
        if (btn.getAttribute && btn.getAttribute('data-act') === 'new-task-from-day') return true;
        var t = (btn.textContent || '').trim().toLowerCase();
        if (!t) return false;
        if (/новая\s*задач|создать\s*задач|\+\s*задач|добавить\s*задач/.test(t)) return true;
        return false;
    }

    document.addEventListener('click', function(e) {
    if (window.__trkLogTaskFromLogV3) return;
    if (!e.target || !e.target.closest) return;
    var dayModal = document.getElementById('dayModal');
    if (!dayModal || !dayModal.classList.contains('active')) return;
        var btn = e.target.closest('button');
        if (!btn) return;
        if (btn.id === 'addTaskBtn' || btn.id === 'addTaskBtn2') return;
        if (!looksLikeCreateTask(btn)) return;

        e.preventDefault();
        e.stopPropagation();

        var st = window.__trkState;
        var dk = st && st.currentDay;

        dayModal.classList.remove('active');

        if (typeof window.__trkOpenTaskModal === 'function') {
            window.__trkOpenTaskModal(null);
        } else {
            var alt = document.getElementById('addTaskBtn2') || document.getElementById('addTaskBtn');
            if (alt) alt.click();
        }
        if (dk) window.__trkPendingDayReopen = dk;
    }, true);

    function attachObserver() {
        var taskModal = document.getElementById('taskModal');
        if (!taskModal || taskModal._reopenHooked) return;
        taskModal._reopenHooked = true;
        var obs = new MutationObserver(function() {
            var isOpen = taskModal.classList.contains('active');
            if (isOpen) return;
            if (!window.__trkPendingDayReopen) return;
            var dk = window.__trkPendingDayReopen;
            window.__trkPendingDayReopen = null;
            setTimeout(function() {
                if (typeof window.__trkOpenDayModal === 'function') {
                    window.__trkOpenDayModal(dk);
                }
            }, 800);
        });
        obs.observe(taskModal, { attributes: true, attributeFilter: ['class'] });
    }

    function boot() { setTimeout(attachObserver, 400); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
/* ============================================================
   PATCH 10 — Должности: автозаполнение списка
   ============================================================ */
(function() {
    'use strict';

    function fillRoleDatalist() {
        var dl = document.getElementById('emp_role_list');
        if (!dl) return;
        var st = window.__trkState;
        if (!st || !st.employees) return;
        var seen = {};
        st.employees.forEach(function(e) {
            var r = (e.role || '').trim();
            if (r) seen[r] = true;
        });
        var roles = Object.keys(seen).sort(function(a, b) {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        });
        dl.innerHTML = roles.map(function(r) {
            return '<option value="' + r.replace(/"/g, '&quot;') + '"></option>';
        }).join('');
    }

    function attachObserver() {
        var m = document.getElementById('employeeModal');
        if (!m || m._roleDatalistHooked) return;
        m._roleDatalistHooked = true;
        var obs = new MutationObserver(function() {
            if (m.classList.contains('active')) fillRoleDatalist();
        });
        obs.observe(m, { attributes: true, attributeFilter: ['class'] });
    }

    function boot() {
        attachObserver();
        setTimeout(fillRoleDatalist, 800);
        setTimeout(fillRoleDatalist, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#addEmployeeBtn')) setTimeout(fillRoleDatalist, 80);
    });

    window.__trkFillRoleDatalist = fillRoleDatalist;
})();
/* PATCH 18 — ЗАМЕНЁН патчем v1.1.4 (log-task-search). 
   PATCH v2: пустой IIFE удалён — он всё равно ничего не делал. */
/* ============================================================
   PATCH 19 — Проверка дубликатов имён задач (клиент)
   ============================================================ */
(function() {
    'use strict';

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }

    function getModal() {
        var m = document.getElementById('trkDupTaskModal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'trkDupTaskModal';
        m.className = 'modal trk-dup-task-modal';
        m.innerHTML = [
            '<div class="modal-content dt-modal">',
            '  <div class="dt-head">',
            '    <span class="dt-icon">⚠</span>',
            '    <div class="dt-title-block">',
            '      <div class="dt-title">Похожая задача уже есть</div>',
            '      <div class="dt-sub">Проверьте, не дубликат ли это</div>',
            '    </div>',
            '  </div>',
            '  <div class="dt-body" id="trkDupBody"></div>',
            '  <div class="dt-actions">',
            '    <button type="button" class="btn btn-secondary" data-dt="cancel">Отмена</button>',
            '    <button type="button" class="btn btn-secondary" data-dt="open">Открыть существующую</button>',
            '    <button type="button" class="btn btn-primary" data-dt="force">Всё равно создать</button>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(m);
		m.style.setProperty('z-index', '9000', 'important');
        return m;
    }

    function showDupDialog(data) {
        return new Promise(function(resolve) {
            var m = getModal();
            var body = m.querySelector('#trkDupBody');
            var html = '';
            if (data.exact) {
                html += '<div class="dt-exact">'
                     + '<div class="dt-exact-lbl">Точное совпадение:</div>'
                     + '<div class="dt-exact-name">' + _esc(data.exact.name) + '</div>'
                     + '</div>';
            }
            if (data.similar && data.similar.length) {
                html += '<div class="dt-similar">'
                     + '<div class="dt-sim-lbl">Похожие задачи:</div>'
                     + data.similar.map(function(t) {
                         return '<div class="dt-sim-row"><span class="dt-sim-name">' + _esc(t.name) + '</span>'
                              + '<button type="button" class="dt-sim-open" data-id="' + _esc(t.id) + '">открыть</button></div>';
                     }).join('')
                     + '</div>';
            }
            body.innerHTML = html;

            m.classList.add('active');
            var resolved = false;
            function finish(choice, tid) {
                if (resolved) return;
                resolved = true;
                m.classList.remove('active');
                m.removeEventListener('click', onClick);
                resolve({ choice: choice, id: tid || '' });
            }
            function onClick(e) {
                if (e.target === m) { finish('cancel'); return; }
                var openBtn = e.target.closest && e.target.closest('.dt-sim-open');
                if (openBtn) {
                    finish('open', openBtn.getAttribute('data-id'));
                    return;
                }
                var b = e.target.closest && e.target.closest('[data-dt]');
                if (!b) return;
                finish(b.getAttribute('data-dt'));
            }
            m.addEventListener('click', onClick);
        });
    }

    var _nativeFetch = window.fetch;
    if (_nativeFetch && !window.__trkDupTaskModalV1) {
        window.__trkDupTaskModalV1 = true;
        window.fetch = function(url, opts) {
            if (typeof url !== 'string' || url.indexOf('/api/tracker/task/save') === -1) {
                return _nativeFetch.apply(this, arguments);
            }
            if (!opts || (opts.method || 'GET').toUpperCase() !== 'POST') {
                return _nativeFetch.apply(this, arguments);
            }
            var self = this;
            return _nativeFetch.apply(this, arguments).then(function(r) {
                if (r.status !== 409) return r;
                return r.clone().json().then(function(d) {
                    if (!d || d.error !== 'duplicate_name') return r;
                    return showDupDialog(d).then(function(res) {
                        if (res.choice === 'cancel') {
                            return new Response(JSON.stringify({
                                success: false, error: 'cancelled'
                            }), { status: 200, headers: {'Content-Type': 'application/json'} });
                        }
                        if (res.choice === 'open') {
                            var tid = res.id || (d.exact && d.exact.id) || (d.similar && d.similar[0] && d.similar[0].id);
                            var _st = window.__trkState;
                            var _t = _st && _st.tasks ? _st.tasks.find(function(x) { return x.id === tid; }) : null;
                            if (_t && typeof window.__trkOpenTaskModal === 'function') {
                                window.__trkOpenTaskModal(_t);
                            } else if (window.__trackerNotify) {
                                window.__trackerNotify('Не удалось открыть задачу: не найдена в текущем списке', 'error');
                            }
                            return new Response(JSON.stringify({ success: true, opened: tid }), {
                                status: 200, headers: {'Content-Type': 'application/json'}
                            });
                        }
                        var payload;
                        try { payload = JSON.parse(opts.body || '{}'); } catch (e) { payload = {}; }
                        payload.force_duplicate = 1;
                        var newOpts = Object.assign({}, opts, { body: JSON.stringify(payload) });
                        return _nativeFetch.call(self, url, newOpts);
                    });
                });
            });
        };
    }
})();
/* ============================================================
   PATCH 22 — Свод: штриховка «назначено, не отмечено»
   ============================================================ */
(function() {
    'use strict';

    function _st() { return window.__trkState || null; }

    function decorateLegend() {
        var legend = document.querySelector('#sumExtras .grid-legend');
        if (!legend) return;
        if (legend.querySelector('.trk-legend-missing')) return;
        var s = document.createElement('span');
        s.className = 'grid-legend-item trk-legend-missing';
        s.innerHTML = '<span class="grid-legend-swatch" style="background: repeating-linear-gradient(45deg, rgba(128,128,128,0.10) 0, rgba(128,128,128,0.10) 3px, rgba(128,128,128,0.28) 3px, rgba(128,128,128,0.28) 6px);"></span>🩶 Назначено, не отмечено';
        legend.appendChild(s);
        if (legend.querySelector('.trk-legend-overdue')) return;
        var s2 = document.createElement('span');
        s2.className = 'grid-legend-item trk-legend-overdue';
        s2.innerHTML = '<span class="grid-legend-swatch" style="background: repeating-linear-gradient(45deg, rgba(231,76,60,0.12) 0, rgba(231,76,60,0.12) 3px, rgba(231,76,60,0.32) 3px, rgba(231,76,60,0.32) 6px);"></span>⚠ Просрочено без отметок';
        legend.appendChild(s2);
    }

    function decorateMissing() {
        var wrap = document.getElementById('sumWrap');
        var table = wrap ? wrap.querySelector('table.grid-table') : null;
        if (!table) return;
        var st = _st();
        if (!st || !st.summary) return;
        var d = st.summary;
        var days = d.days || [];
        var meta = d.day_meta || {};
        var today = st.today || '';
        if (!days.length || !today) return;

        var rowByEmp = {};
        (d.rows || []).forEach(function(r) { rowByEmp[r.employee_id] = r; });

        var trs = table.querySelectorAll('tbody > tr');
        var lastEmpId = '';

        trs.forEach(function(tr) {
            if (tr.classList.contains('emp-sep')) return;
            if (tr.classList.contains('day-totals-row')) return;

            var empCell = tr.querySelector('td.emp-cell[data-emp]');
            if (empCell) lastEmpId = empCell.getAttribute('data-emp');
            if (!lastEmpId) return;

            var taskCell = tr.querySelector('td.task-cell[data-task]');
            if (!taskCell) return;
            var taskId = taskCell.getAttribute('data-task');
            if (!taskId || taskId === '__collapsed__') return;

            var rowData = rowByEmp[lastEmpId];
            if (!rowData) return;
            var taskData = (rowData.tasks || []).find(function(x) { return x.task_id === taskId; });
            if (!taskData) return;

            var taskFull = (st.tasks || []).find(function(x) { return x.id === taskId; });
            if (!taskFull) return;
            var tstatus = taskFull.status || 'active';
            if (tstatus !== 'active' && tstatus !== 'paused') return;
            if ((taskFull.assignees || []).indexOf(lastEmpId) === -1) return;

            var startD = taskFull.start_date || '';
            var endD = taskFull.deadline || '';
            var anyCells = taskData.cells && Object.keys(taskData.cells).length > 0;
            var overdueNoWork = !!(endD && endD < today && !anyCells);

            var absMap = rowData.absence_days || {};

            var dayCells = tr.querySelectorAll('td.day-cell');
            for (var i = 0; i < days.length && i < dayCells.length; i++) {
                var dk = days[i];
                var td = dayCells[i];
                if (td.hasAttribute('data-emp') || td.hasAttribute('data-task')) continue;
                if (absMap[dk]) continue;
                if (td.classList.contains('absence-vacation') ||
                    td.classList.contains('absence-sick_leave') ||
                    td.classList.contains('absence-business_trip') ||
                    td.classList.contains('absence-remote')) continue;
                if (startD && dk < startD) continue;
                if (endD && dk > endD) continue;
                if (dk > today) continue;
                var m = meta[dk] || {};
                if (!m.is_workday) continue;

                var cls = overdueNoWork ? 'day-cell--missing-overdue' : 'day-cell--missing-assigned';
                td.classList.add(cls);
                var ttl = overdueNoWork ? '⚠ Просрочено без отметок' : '🩶 Назначено, не отмечено';
                td.title = (td.title ? td.title + ' · ' : '') + ttl;
            }
        });

        decorateLegend();
    }

    var _prev = window.__trkOnSummaryRender;
    window.__trkOnSummaryRender = function() {
        if (typeof _prev === 'function') {
            try { _prev(); } catch (e) {}
        }
        try { decorateMissing(); } catch (e) { console.error('[missing-shading]', e); }
    };

    setTimeout(function() { try { decorateMissing(); } catch (e) {} }, 700);
    setTimeout(function() { try { decorateMissing(); } catch (e) {} }, 1800);

    window.__trkDecorateMissing = decorateMissing;
})();
/* ============================================================
   PATCH 23 — Глобальная связь задач и отметок
   ============================================================ */
(function() {
    'use strict';

    function _st() { return window.__trkState || null; }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function _fmtH(h) {
        h = Number(h) || 0;
        if (h === Math.floor(h)) return h + ' ч';
        return h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' ч';
    }
    function _mask(name) {
        var st = _st();
        if (!st || !st.maskNames) return name;
        return String(name == null ? '' : name).split(/\s+/).map(function(w) {
            if (w.length <= 1) return w;
            return w[0] + new Array(w.length).join('*');
        }).join(' ');
    }

    function _meEmpId() {
        var st = _st();
        return st && st.currentUser ? (st.currentUser.employee_id || '') : '';
    }

    function _isWorkday(dayMeta) {
        return !!(dayMeta && dayMeta.is_workday);
    }

    function _inInterval(t, dk) {
        var s = t.start_date || '';
        var e = t.deadline || '';
        if (s && dk < s) return false;
        if (e && dk > e) return false;
        return true;
    }

    function _absenceOf(emp, dk) {
        if (!emp) return '';
        var vs = emp.vacations || [];
        for (var i = 0; i < vs.length; i++) {
            var v = vs[i];
            if (v.from && v.to && v.from <= dk && dk <= v.to) return v.type || 'vacation';
        }
        return '';
    }

    function _missingTasksFor(empId, dk) {
        var st = _st();
        if (!st || !st.tasks || !st.calendar) return [];
        var day = st.calendar.days.find(function(d) { return d.date === dk; });
        if (!day) return [];
        var meta = (st.calendar.days.find(function(x) { return x.date === dk; }) || {});
        var today = st.today || '';
        if (dk > today) return [];
        if (!_isWorkday(meta)) return [];
        var emp = (st.employees || []).find(function(e) { return e.id === empId; });
        if (_absenceOf(emp, dk)) return [];
        var doneTask = {};
        (day.entries || []).forEach(function(en) {
            if (en.employee_id === empId) doneTask[en.task_id] = true;
        });
        var out = [];
        (st.tasks || []).forEach(function(t) {
            if (t.status !== 'active' && t.status !== 'paused') return;
            if ((t.assignees || []).indexOf(empId) === -1) return;
            if (!_inInterval(t, dk)) return;
            if (doneTask[t.id]) return;
            out.push(t);
        });
        return out;
    }

    function _decorateDayModal() {
        var st = _st();
        if (!st) return;
        if (st.dayViewMode === 'employee') return;
        var empId = _meEmpId();
        if (!empId) return;
        var dk = st.currentDay;
        if (!dk) return;
        var list = document.getElementById('dayList');
        if (!list) return;
        var missing = _missingTasksFor(empId, dk);
        var old = list.querySelector('.day-assigned-block');
        if (old) old.remove();
        if (!missing.length) return;

        var block = document.createElement('div');
        block.className = 'day-assigned-block';
        var head = '<div class="dab-head">'
                 + '<span class="dab-icon">🩶</span>'
                + '<span class="dab-title">Назначено на этот день</span>'
                + '<span class="dab-count">' + missing.length + '</span>'
                + '</div>';
        var tiles = missing.map(function(t) {
            var cls = t.status === 'paused' ? ' dab-paused' : '';
            return '<div class="dab-tile' + cls + '" data-task-id="' + _esc(t.id) + '">'
                 +   '<span class="dab-ico">' + _esc(t.icon || '📋') + '</span>'
                 +   '<div class="dab-body">'
                 +     '<div class="dab-name">' + _esc(t.name) + '</div>'
                 +     '<div class="dab-meta">'
                 +       (t.deadline ? '⏰ ' + _esc(t.deadline) : '')
                 +       (t.status === 'paused' ? ' · ⚠ Приостановлена' : '')
                 +     '</div>'
                 +   '</div>'
                 +   '<button type="button" class="dab-add" title="Отметиться по этой задаче">➕</button>'
                 + '</div>';
        }).join('');
        block.innerHTML = head + '<div class="dab-tiles">' + tiles + '</div>';
        list.insertBefore(block, list.firstChild);

        block.querySelectorAll('.dab-tile').forEach(function(el) {
            el.addEventListener('click', function(e) {
                var tid = this.getAttribute('data-task-id');
                if (!tid) return;
                if (e.target.closest('.dab-add') || !e.target.closest('button')) {
                    _activateTask(tid);
                }
            });
        });
    }

    function _activateTask(taskId) {
        var st = _st();
        if (!st) return;
        var t = (st.tasks || []).find(function(x) { return x.id === taskId; });
        if (!t) return;

        if (t.status === 'done' || t.status === 'archived') {
            var map = { done: 'выполнена', archived: 'в архиве' };
            _showNotice(
                '🔒 Задача закрыта',
                'Задача <b>' + _esc(t.name) + '</b> — ' + map[t.status] + '.',
                'Измените её статус во вкладке «Задачи», чтобы отметить по ней работу.'
            );
            return;
        }
        if (t.status === 'paused') {
            _confirmNotice(
                '⚠ Задача приостановлена',
                'Задача <b>' + _esc(t.name) + '</b> имеет статус «Приостановлена».',
                'Всё равно отметить по ней работу?',
                'Отметить',
                function() { _doAdd(t.id); }
            );
            return;
        }
        _doAdd(t.id);
    }

    function _doAdd(taskId) {
        var st = _st();
        if (!st) return;
        var empId = _meEmpId();
        var dk = st.currentDay;
        if (!empId || !dk) return;
        var day = st.calendar && st.calendar.days ? st.calendar.days.find(function(d) { return d.date === dk; }) : null;
        var n = 0;
        (day && day.entries || []).forEach(function(en) { if (en.employee_id === empId) n++; });
        var hrs = Math.round((8 / (n + 1)) * 4) / 4;
        if (hrs < 0.5) hrs = 0.5;
        if (hrs > 24) hrs = 24;
        var hdrs = { 'Content-Type': 'application/json' };
        if (window.REESTR_CSRF) hdrs['X-CSRF-Token'] = window.REESTR_CSRF;
        fetch('/api/tracker/log/save', {
            method: 'POST',
            headers: hdrs,
            credentials: 'same-origin',
            body: JSON.stringify({
                employee_id: empId,
                task_id: taskId,
                date: dk,
                hours: hrs,
                status: 'in_progress',
                comment: 'Назначенная задача, активирована из календаря',
                link: ''
            })
        }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
        .then(function(res) {
            if (!res.ok || !res.d || !res.d.success) {
                if (res.d && res.d.error && res.d.error !== 'cancelled' && typeof window.__trackerNotify === 'function') {
                    window.__trackerNotify('❌ ' + res.d.error, 'error');
                }
                return;
            }
            // PATCH v1.0.20: закрыть все модалки, без повторного открытия dayModal
            ['dayModal','logModal','trkNoticeModal'].forEach(function(id){
                var el = document.getElementById(id);
                if (el) el.classList.remove('active');
            });
            var _refresh = (typeof window.__trkRefreshAll === 'function')
                ? window.__trkRefreshAll
                : (typeof window.__trkRenderCalendar === 'function' ? window.__trkRenderCalendar : null);
            if (_refresh) { Promise.resolve(_refresh()); }
        }).catch(function(err) {
            if (err && err.message && err.message.indexOf('cancelled') !== -1) return;
            if (typeof window.__trackerNotify === 'function') {
                window.__trackerNotify('❌ ' + (err.message || 'Ошибка'), 'error');
            }
        });
    }

    function _getNoticeModal() {
        var m = document.getElementById('trkNoticeModal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'trkNoticeModal';
        m.className = 'modal trk-notice-modal';
        m.innerHTML = '<div class="modal-content nm-modal">'
            + '<div class="nm-head"><span class="nm-icon" id="nmIcon">🔒</span>'
            + '<div class="nm-title" id="nmTitle"></div></div>'
            + '<div class="nm-body"><div id="nmLine1"></div><div id="nmLine2" class="nm-sub"></div></div>'
            + '<div class="nm-actions" id="nmActions"></div>'
            + '</div>';
        document.body.appendChild(m);
		m.style.setProperty('z-index', '9000', 'important');
        return m;
    }

    function _showNotice(title, line1, line2) {
        var m = _getNoticeModal();
        var t = m.querySelector('#nmTitle'); if (t) t.textContent = title;
        var i = m.querySelector('#nmIcon'); if (i) i.textContent = title.indexOf('🔒') === 0 ? '🔒' : 'ℹ';
        var l1 = m.querySelector('#nmLine1'); if (l1) l1.innerHTML = line1;
        var l2 = m.querySelector('#nmLine2'); if (l2) l2.innerHTML = line2 || '';
        var a = m.querySelector('#nmActions');
        if (a) a.innerHTML = '<button type="button" class="btn btn-primary" data-nm="ok">Понятно</button>';
        m.classList.add('active');
        var onClick = function(e) {
            if (e.target === m || (e.target.closest && e.target.closest('[data-nm="ok"]'))) {
                m.classList.remove('active');
                m.removeEventListener('click', onClick);
            }
        };
        m.addEventListener('click', onClick);
    }

    // PATCH v2: в _confirmNotice была синтаксическая ошибка — запятая вместо +, 
    // из-за чего в модалке появлялась только кнопка Отмена.
    function _confirmNotice(title, line1, line2, okLabel, onOk) {
        var m = _getNoticeModal();
        var t = m.querySelector('#nmTitle'); if (t) t.textContent = title;
        var i = m.querySelector('#nmIcon'); if (i) i.textContent = '⚠';
        var l1 = m.querySelector('#nmLine1'); if (l1) l1.innerHTML = line1;
        var l2 = m.querySelector('#nmLine2'); if (l2) l2.innerHTML = line2 || '';
        var a = m.querySelector('#nmActions');
        if (a) a.innerHTML = '<button type="button" class="btn btn-secondary" data-nm="cancel">Отмена</button>'
                          + '<button type="button" class="btn btn-primary" data-nm="ok">' + _esc(okLabel) + '</button>';
        m.classList.add('active');
        var onClick = function(e) {
            var b = e.target.closest && e.target.closest('[data-nm]');
            if (e.target === m) b = { getAttribute: function() { return 'cancel'; } };
            if (!b) return;
            m.classList.remove('active');
            m.removeEventListener('click', onClick);
            if (b.getAttribute('data-nm') === 'ok' && typeof onOk === 'function') onOk();
        };
        m.addEventListener('click', onClick);
    }

    function _decorateCalendar() {
        var st = _st();
        if (!st || !st.calendar) return;
        var empId = _meEmpId();
        if (!empId) return;
        var grid = document.getElementById('calGrid');
        if (!grid) return;
        var cells = grid.querySelectorAll('.cal-cell');
        cells.forEach(function(cell) {
            var dk = cell.getAttribute('data-date');
            if (!dk) return;
            var old = cell.querySelector('.cal-assigned-dot');
            if (old) old.remove();
            var missing = _missingTasksFor(empId, dk);
            if (!missing.length) return;
            var dot = document.createElement('span');
            dot.className = 'cal-assigned-dot';
            dot.title = missing.length + ' назначенных задач(и) без отметки';
            dot.textContent = '●';
            cell.appendChild(dot);
        });
    }

    function _autoCheckInTaskModal() {
        var st = _st();
        if (!st) return;
        var me = _meEmpId();
        if (!me) return;
        var taskIdField = document.getElementById('task_id');
        if (!taskIdField || taskIdField.value) return;
        var list = document.getElementById('taskAssigneesList');
        if (!list) return;
        var cb = list.querySelector('input[type="checkbox"][value="' + me + '"]');
        if (cb && !cb.checked) cb.checked = true;
    }

    function _attachObservers() {
        var dm = document.getElementById('dayModal');
        if (dm && !dm._linksHooked) {
            dm._linksHooked = true;
            new MutationObserver(function() {
                if (dm.classList.contains('active')) {
                    setTimeout(_decorateDayModal, 80);
                    setTimeout(_decorateDayModal, 300);
                }
            }).observe(dm, { attributes: true, attributeFilter: ['class'] });
            var dl = document.getElementById('dayList');
            if (dl) {
                new MutationObserver(function() { setTimeout(_decorateDayModal, 40); }).observe(dl, { childList: true });
            }
        }
        var grid = document.getElementById('calGrid');
        if (grid && !grid._assignedHooked) {
            grid._assignedHooked = true;
            new MutationObserver(function() { setTimeout(_decorateCalendar, 60); }).observe(grid, { childList: true });
        }
        var tm = document.getElementById('taskModal');
        if (tm && !tm._autoHooked) {
            tm._autoHooked = true;
            new MutationObserver(function() {
                if (tm.classList.contains('active')) {
                    setTimeout(_autoCheckInTaskModal, 150);
                    setTimeout(_autoCheckInTaskModal, 400);
                }
            }).observe(tm, { attributes: true, attributeFilter: ['class'] });
        }
    }

    function boot() {
        _attachObservers();
        setTimeout(_attachObservers, 800);
        setTimeout(_attachObservers, 2000);
        setTimeout(_decorateCalendar, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }

    window.__trkDecorateAssigned = _decorateDayModal;
    window.__trkDecorateCalendarAssigned = _decorateCalendar;
})();
/* ============================================================
   PATCH 24 — фиксы: загрузчик не перекрывает модалки, число колонок
   ============================================================ */
(function() {
    'use strict';

    function hideLoader() {
        var l = document.getElementById('globalLoader');
        if (l) l.classList.remove('active');
        try { window.__trkLoaderPending = 0; } catch (e) {}
    }
    var _modalObserver = new MutationObserver(function(muts) {
        for (var i = 0; i < muts.length; i++) {
            var el = muts[i].target;
            if (el && el.classList && el.classList.contains('modal') && el.classList.contains('active')) {
                hideLoader();
                return;
            }
        }
    });
    function watchModals() {
        document.querySelectorAll('.modal').forEach(function(m) {
            if (m._loaderWatchHooked) return;
            m._loaderWatchHooked = true;
            _modalObserver.observe(m, { attributes: true, attributeFilter: ['class'] });
        });
    }
    watchModals();
    setTimeout(watchModals, 800);
    setTimeout(watchModals, 2000);

    var KEY = 'tracker_tsk_cols';
    function readCols() {
        try {
            var v = parseInt(localStorage.getItem(KEY), 10);
            if (v >= 1 && v <= 5) return v;
        } catch (e) {}
        return 3;
    }
    function applyCols() {
        var st = window.__trkState;
        var cols = readCols();
        if (st) st.tskGridCols = cols;
        var list = document.getElementById('tasksFullList');
        if (list && list.classList.contains('tasks-grid')) {
            list.removeAttribute('data-cols');
        }
        var sel = document.getElementById('tskGridCols');
        if (sel && String(sel.value) !== String(cols)) sel.value = String(cols);
    }
    window.addEventListener('load', applyCols);
    setTimeout(applyCols, 500);
    setTimeout(applyCols, 1500);

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="tasks"]')) {
            setTimeout(applyCols, 250);
        }
    });

    document.addEventListener('change', function(e) {
        if (!e.target || e.target.id !== 'tskGridCols') return;
        try { localStorage.setItem(KEY, String(e.target.value)); } catch (er) {}
        setTimeout(applyCols, 60);
    }, true);

    var wrap = document.getElementById('tasksFullList');
    if (wrap && !wrap._colsHooked) {
        wrap._colsHooked = true;
        new MutationObserver(function() { setTimeout(applyCols, 30); }).observe(wrap, { childList: true });
    } else if (!wrap) {
        setTimeout(function() {
            var w2 = document.getElementById('tasksFullList');
            if (w2 && !w2._colsHooked) {
                w2._colsHooked = true;
                new MutationObserver(function() { setTimeout(applyCols, 30); }).observe(w2, { childList: true });
            }
        }, 900);
    }

    window.__trkApplyTskCols = applyCols;
})();
/* ============================================================
   PATCH 25 — Подсветка задач без исполнителей
   ============================================================ */
(function() {
    'use strict';

    function decorate() {
        var st = window.__trkState;
        if (!st || !st.tasks) return;
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        list.querySelectorAll('.task-card, .dict-item').forEach(function(card) {
            var id = card.getAttribute('data-id');
            if (!id) return;
            var t = st.tasks.find(function(x) { return x.id === id; });
            if (!t) return;
            var noAssignees = !((t.assignees || []).length);
            var badge = card.querySelector('.task-card-no-assignees-badge');
            if (noAssignees) {
                card.classList.add('task-card--no-assignees');
                if (badge) badge.remove();
                if (false) {
                    var b = document.createElement('span');
                    b.className = 'task-card-no-assignees-badge';
                    b.textContent = '⚠ Нет исполнителей';
                    b.title = 'Задача ни на кого не назначена — её никто не увидит в календаре';
                    var head = card.querySelector('.task-card-head') || card.querySelector('.dict-item-body');
                    if (head) head.appendChild(b);
                }
            } else {
                card.classList.remove('task-card--no-assignees');
                if (badge) badge.remove();
            }
        });
    }

    var wrap = document.getElementById('tasksFullList');
    function observe(el) {
        if (!el || el._noAsgHooked) return;
        el._noAsgHooked = true;
        new MutationObserver(function() { setTimeout(decorate, 30); }).observe(el, { childList: true });
        decorate();
    }
    observe(wrap);
    setTimeout(function() { observe(document.getElementById('tasksFullList')); }, 800);
    setTimeout(function() { observe(document.getElementById('tasksFullList')); }, 2000);
    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="tasks"]')) {
            setTimeout(decorate, 250);
        }
    });

    window.__trkDecorateNoAssignees = decorate;
})();
/* ============================================================
   PATCH 26 — Расширенная карточка задачи: все исполнители
   v2: сохранение __lastTaskCardData делается в обёртке openTaskCardModal 
   из основной части файла — здесь только рендер.
   ============================================================ */
(function() {
    'use strict';

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }
    function _initials(name) {
        var parts = String(name || '').trim().split(/\s+/);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
    }
    function _fmtH(h) {
        h = Number(h) || 0;
        if (h === Math.floor(h)) return h + ' ч';
        return h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' ч';
    }
    function _statusLbl(s) {
        return ({ done:'✅ готово', in_progress:'🔵 в работе', planned:'📝 план', blocked:'🔴 блок' })[s] || '';
    }

    function coverageBar(cov) {
        var cls = cov >= 70 ? 'ok' : (cov >= 40 ? 'warn' : 'err');
        var w = Math.max(0, Math.min(cov, 100));
        return '<div class="cov-bar"><div class="cov-bar-track"><div class="cov-bar-fill ' + cls + '" style="width:' + w + '%"></div></div><span class="cov-bar-pct">' + cov + '%</span></div>';
    }

    window.__trkRenderTaskCardEmployees = function(d) {
        var wrap = document.getElementById('taskCardEmployees');
        if (!wrap) return;
        var rows = d.employees || [];
        if (!rows.length) {
            wrap.innerHTML = '<div class="day-empty">Нет ни назначенных, ни отметок за этот период.</div>';
            return;
        }
        var worked = [], idle = [];
        rows.forEach(function(e) {
            if (e.worked) worked.push(e); else idle.push(e);
        });
        var html = '';

        if (worked.length) {
            html += '<div class="tc-sec-title"><span>👥</span><span>Исполнители (' + worked.length + ')</span></div>';
            html += '<div class="tc-list">';
            worked.forEach(function(e) {
                html += _rowHtml(e, false);
            });
            html += '</div>';
        }

        if (idle.length) {
            html += '<div class="tc-sec-title tc-sec-idle"><span>⚠</span><span>Не приступили (' + idle.length + ')</span></div>';
            html += '<div class="tc-list">';
            idle.forEach(function(e) {
                html += _rowHtml(e, true);
            });
            html += '</div>';
        }

        wrap.innerHTML = html;
    };

    function _rowHtml(e, idle) {
        var cls = 'tc-row' + (idle ? ' tc-idle' : '') + (e.overdue ? ' tc-overdue' : '');
        var bg = _esc(e.employee_color || '#888');
        var st = e.last_status ? _statusLbl(e.last_status) : '';
        var cov = (typeof e.coverage === 'number') ? e.coverage : 0;
        var badge = '';
        if (idle) badge = '<span class="tc-badge tc-badge-idle">не работал</span>';
        else if (e.emp_completion_kind === 'early') badge = '<span class="tc-badge tc-badge-ok">✅ досрочно</span>';
        else if (e.emp_completion_kind === 'on_time') badge = '<span class="tc-badge tc-badge-ok">✅ в срок</span>';
        else if (e.emp_completion_kind === 'late') badge = '<span class="tc-badge tc-badge-warn">⏰ с опозданием</span>';
        else if (e.overdue) badge = '<span class="tc-badge tc-badge-err">⚠ просрочено</span>';
        return '<div class="' + cls + '">'
             +   '<div class="tc-avatar" style="background:' + bg + ';">' + _esc(_initials(e.employee_name)) + '</div>'
             +   '<div class="tc-body">'
             +     '<div class="tc-name">' + _esc(e.employee_name)
             +       (e.employee_department ? ' <span class="tc-dept">🏢 ' + _esc(e.employee_department) + '</span>' : '')
             +     '</div>'
             +     '<div class="tc-meta">'
             +       (st ? '<span>' + _esc(st) + '</span>' : '')
             +       (e.active_days ? '<span>· ' + e.active_days + ' дн.</span>' : '')
             +       (e.emp_completed_at ? '<span>· ✅ ' + _esc(e.emp_completed_at) + '</span>' : '')
             +       badge
             +     '</div>'
             +     (idle ? '' : coverageBar(cov))
             +   '</div>'
             +   '<div class="tc-hours">' + _fmtH(e.total_hours) + '</div>'
             + '</div>';
    }
})();
/* ============================================================
   PATCH 27 — Защита при удалении задачи
   ============================================================ */
(function() {
    'use strict';

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }

    function getModal() {
        var m = document.getElementById('trkDelTaskModal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'trkDelTaskModal';
        m.className = 'modal trk-del-task-modal';
        m.innerHTML = [
            '<div class="modal-content dlm-modal">',
            '  <div class="dlm-head">',
            '    <span class="dlm-icon">🗑</span>',
            '    <div class="dlm-title-block">',
            '      <div class="dlm-title">Удалить задачу?</div>',
            '      <div class="dlm-sub" id="trkDlmSub"></div>',
            '    </div>',
            '  </div>',
            '  <div class="dlm-warn" id="trkDlmWarn" style="display:none;"></div>',
            '  <div class="dlm-actions">',
            '    <button type="button" class="btn btn-secondary" data-dl="cancel">Отмена</button>',
            '    <button type="button" class="btn btn-danger" data-dl="force">Удалить задачу и все отметки</button>',
            '  </div>',
            '</div>'
        ].join('');
        document.body.appendChild(m);
		m.style.setProperty('z-index', '9000', 'important');
        return m;
    }

    function showDlg(data) {
        return new Promise(function(resolve) {
            var m = getModal();
            var sub = m.querySelector('#trkDlmSub');
            var warn = m.querySelector('#trkDlmWarn');
            if (sub) sub.textContent = 'Задача: ' + (data.taskName || '');
            if (warn) {
                var emps = (data.employees || []).map(function(e) {
                    return '<span class="dlm-emp">' + _esc(e.name) + '</span>';
                }).join(' ');
                warn.innerHTML = [
                    '<div class="dlm-warn-title">⚠ В задаче есть отметки</div>',
                    '<div class="dlm-warn-line">Отметок: <b>' + data.logs_count + '</b> · Участников: <b>' + (data.employees || []).length + '</b> · Дней: <b>' + data.dates_count + '</b></div>',
                    data.first_date ? '<div class="dlm-warn-line">Период: ' + _esc(data.first_date) + ' — ' + _esc(data.last_date) + '</div>' : '',
                    emps ? '<div class="dlm-warn-line dlm-emps">' + emps + '</div>' : '',
                    '<div class="dlm-warn-line dlm-danger">При удалении задачи <b>все отметки будут удалены безвозвратно</b>.</div>'
                ].join('');
                warn.style.display = 'block';
            }
            m.classList.add('active');
            var resolved = false;
            function finish(choice) {
                if (resolved) return;
                resolved = true;
                m.classList.remove('active');
                m.removeEventListener('click', onClick);
                resolve(choice);
            }
            function onClick(e) {
                if (e.target === m) { finish('cancel'); return; }
                var b = e.target.closest && e.target.closest('[data-dl]');
                if (!b) return;
                finish(b.getAttribute('data-dl'));
            }
            m.addEventListener('click', onClick);
        });
    }

    function taskNameById(tid) {
        var st = window.__trkState;
        if (!st || !st.tasks) return '';
        var t = st.tasks.find(function(x) { return x.id === tid; });
        return t ? (t.name || '') : '';
    }

    var _nativeFetch = window.fetch;
    if (_nativeFetch && !window.__trkDelTaskModalV1) {
        window.__trkDelTaskModalV1 = true;
        window.fetch = function(url, opts) {
            if (typeof url !== 'string' || url.indexOf('/api/tracker/task/delete') === -1) {
                return _nativeFetch.apply(this, arguments);
            }
            if (!opts || (opts.method || 'GET').toUpperCase() !== 'POST') {
                return _nativeFetch.apply(this, arguments);
            }
            var payload = {};
            try { payload = JSON.parse(opts.body || '{}'); } catch (e) {}
            if (payload.force) return _nativeFetch.apply(this, arguments);
            var self = this;
            return _nativeFetch.apply(this, arguments).then(function(r) {
                if (r.status !== 409) return r;
                return r.clone().json().then(function(d) {
                    if (!d || d.error !== 'task_has_logs') return r;
                    d.taskName = taskNameById(payload.id);
                    return showDlg(d).then(function(choice) {
                        if (choice === 'cancel') {
                            return new Response(JSON.stringify({
                                success: false, error: 'cancelled'
                            }), { status: 200, headers: {'Content-Type': 'application/json'} });
                        }
                        var newPayload = Object.assign({}, payload, { force: 1 });
                        var newOpts = Object.assign({}, opts, { body: JSON.stringify(newPayload) });
                        return _nativeFetch.call(self, url, newOpts);
                    });
                });
            });
        };
    }
})();
/* ============================================================
   PATCH 28 — Фильтр «Требуют внимания» на вкладке Задачи
   ============================================================ */
(function() {
    'use strict';
    var KEY = 'tracker_tsk_attention';
    var STALE_DAYS = 3;

    function isOn() {
        try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
    }
    function setOn(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }

    function daysSince(iso) {
        if (!iso) return null;
        try {
            var d = new Date(iso + 'T00:00:00');
            var t = new Date();
            t.setHours(0, 0, 0, 0);
            return Math.floor((t - d) / 86400000);
        } catch (e) { return null; }
    }

    function taskProblem(t) { return window.trkTaskProblems(t); }

    function countProblems() {
        var st = window.__trkState;
        if (!st) return { n: 0, byId: {} };
        var logsByTask = {};
        (st.log || []).forEach(function(l) { logsByTask[l.task_id] = (logsByTask[l.task_id] || 0) + 1; });
        var byId = {};
        var n = 0;
        (st.tasks || []).forEach(function(t) {
            var r = taskProblem(t, logsByTask);
            if (r) { byId[t.id] = r; n++; }
        });
        return { n: n, byId: byId };
    }

    function decorate() {
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        var c = countProblems();
        list.querySelectorAll('.task-card, .dict-item').forEach(function(el) {
            var id = el.getAttribute('data-id');
            if (!id) return;
            var badge = el.querySelector('.task-att-badge');
            if (badge) badge.remove();
            if (c.byId[id]) el.classList.add('task-card--attention');
            else el.classList.remove('task-card--attention');
        });
    }

    function hookRender() {
        if (typeof window.__trkRenderTasksFull !== 'function') return;
        if (window.__trkRenderTasksFull._attHooked) return;
        var orig = window.__trkRenderTasksFull;
        var wrapped = function() {
            var r = orig.apply(this, arguments);
            setTimeout(function() { decorate(); }, 20);
            return r;
        };
        wrapped._attHooked = true;
        window.__trkRenderTasksFull = wrapped;
    }

    function filterAttention(tasks) {
        if (!isOn()) return tasks;
        var c = countProblems();
        return tasks.filter(function(t) { return !!c.byId[t.id]; });
    }

    function boot() {
        hookRender();
        setTimeout(function() { hookRender(); decorate(); }, 900);
        setTimeout(function() { hookRender(); decorate(); }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="tasks"]')) {
            setTimeout(boot, 250);
        }
    });

    window.__trkFilterAttention = filterAttention;
    window.__trkAttentionCount = countProblems;
})();
/* ============================================================
   PATCH 29 — Карточка задачи: сводка по исполнителям
   v2: работает через __lastTaskCardData, который заполняется в 
   обёртке openTaskCardModal основной части файла.
   ============================================================ */
(function() {
    'use strict';
    function _fmtH(h) {
        h = Number(h) || 0;
        if (h === Math.floor(h)) return h + ' ч';
        return h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + ' ч';
    }
    function buildSummary(d) {
        var rows = d.employees || [];
        var worked = rows.filter(function(e) { return e.worked; });
        var idle = rows.filter(function(e) { return !e.worked; });
        var cov = (typeof d.coverage === 'number') ? d.coverage : 0;
        var cls = cov >= 70 ? 'ok' : (cov >= 40 ? 'warn' : 'err');
        return [
            '<div class="tc-summary">',
            '  <div class="tc-summary-card">',
            '    <div class="tc-summary-val">' + _fmtH(d.total_hours || 0) + '</div>',
            '    <div class="tc-summary-lbl">Всего часов</div>',
            '  </div>',
            '  <div class="tc-summary-card">',
            '    <div class="tc-summary-val">' + worked.length + ' / ' + rows.length + '</div>',
            '    <div class="tc-summary-lbl">Работали / назначено</div>',
            '  </div>',
            '  <div class="tc-summary-card">',
            '    <div class="tc-summary-val">' + (d.active_days || 0) + ' / ' + (d.possible_days || 0) + '</div>',
            '    <div class="tc-summary-lbl">Дней активно</div>',
            '  </div>',
            '  <div class="tc-summary-card tc-summary-cov ' + cls + '">',
            '    <div class="tc-summary-val">' + cov + '%</div>',
            '    <div class="tc-summary-lbl">Покрытие</div>',
            '  </div>',
            '</div>'
        ].join('');
    }
    window.__trkInjectTaskSummary = function() {
        var head = document.getElementById('taskCardHead');
        var list = document.getElementById('taskCardEmployees');
        if (!head || !list) return;
        var existing = document.getElementById('taskCardSummary');
        if (existing) existing.remove();
        var st = window.__trkState;
        var d = st && st.__lastTaskCardData;
        if (!d) return;
        var html = buildSummary(d);
        if (!html) return;
        var el = document.createElement('div');
        el.id = 'taskCardSummary';
        el.innerHTML = html;
        var container = head.parentNode;
        if (container) container.insertBefore(el, list);
    };
})();
/* ============================================================
   PATCH 33 — FAB «Новая задача» в правом нижнем углу
   ============================================================ */
(function() {
    'use strict';
    function ensureFab() {
        if (!window.REESTR_PERMS || !window.REESTR_PERMS['action.task.create']) return;
        if (document.getElementById('tskFabBtn')) { updateFab(); return; }
        var b = document.createElement('button');
        b.id = 'tskFabBtn';
        b.type = 'button';
        b.className = 'tsk-fab';
        b.title = 'Новая задача';
        b.setAttribute('aria-label', 'Новая задача');
        b.textContent = '➕';
        b.addEventListener('click', function(e) {
            e.preventDefault();
            // Новая задача → ВСЕГДА спрашиваем тип (аудит/другое), карточку напрямую не открываем
            if (typeof window.__trkOpenTaskKindChooser === 'function') {
                window.__trkOpenTaskKindChooser();
            } else {
                var alt = document.getElementById('addTaskBtn2') || document.getElementById('addTaskBtn');
                if (alt) alt.click();
                // НЕ открываем карточку напрямую: без выбора типа форма не имеет смысла
            }
        });
        document.body.appendChild(b);
        updateFab();
    }
    function updateFab() {
        var b = document.getElementById('tskFabBtn');
        if (!b) return;
        var onTasks = !!document.querySelector('.tracker-tab[data-tab="tasks"].active');
        b.style.display = onTasks ? '' : 'none';
    }
    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.tracker-tab')) {
            setTimeout(updateFab, 60);
        }
    });
    setTimeout(ensureFab, 700);
    setTimeout(ensureFab, 1800);
    setTimeout(updateFab, 900);
    window.__trkEnsureFab = ensureFab;
})();
/* ============================================================
   v1.1.2 — Выпадающее меню пользователя
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkUserMenuV112) return;
    window.__trkUserMenuV112 = true;
    function boot(){
        var chip = document.getElementById('userChip');
        var dd = document.getElementById('userDropdown');
        if (!chip || !dd || chip._v112Hooked) return;
        chip._v112Hooked = true;
        chip.addEventListener('click', function(e){
            e.stopPropagation();
            var active = dd.classList.toggle('active');
            chip.setAttribute('aria-expanded', active ? 'true' : 'false');
        });
        document.addEventListener('click', function(e){
            if (!dd.contains(e.target) && e.target !== chip && !chip.contains(e.target)) {
                dd.classList.remove('active');
                chip.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', function(e){
            if (e.key === 'Escape') {
                dd.classList.remove('active');
                chip.setAttribute('aria-expanded', 'false');
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
    setTimeout(boot, 800);
})();
/* ============================================================
   v1.1.3 — Проверка дублей названия задачи (расширенный поиск)
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkDupV113Final) return;
    window.__trkDupV113Final = true;

    var LOG = '[dup v1.1.3]';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    }); }
    function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

    function words(s) {
        return String(s || '').toLowerCase()
            .split(/[\s\-_.:,;!?/\\|]+/)
            .map(function(w){ return w.trim(); })
            .filter(function(w){ return w.length >= 2; });
    }

    function lev(a, b) {
        if (a === b) return 0;
        var la = a.length, lb = b.length;
        if (la === 0) return lb;
        if (lb === 0) return la;
        var prev = [], cur = [];
        for (var j = 0; j <= lb; j++) prev[j] = j;
        for (var i = 1; i <= la; i++) {
            cur[0] = i;
            for (var k = 1; k <= lb; k++) {
                var cost = a[i - 1] === b[k - 1] ? 0 : 1;
                cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
            }
            prev = cur.slice();
        }
        return prev[lb];
    }

    function matchWords(qWords, tWords) {
        var hits = 0;
        var hitWords = [];
        for (var i = 0; i < qWords.length; i++) {
            var qw = qWords[i];
            for (var j = 0; j < tWords.length; j++) {
                var tw = tWords[j];
                if (tw === qw) { hits += 1; hitWords.push(qw); break; }
                if (tw.length >= 4 && qw.length >= 4 && tw.indexOf(qw) !== -1) { hits += 1; hitWords.push(qw); break; }
                if (tw.length >= 4 && qw.length >= 4 && qw.indexOf(tw) !== -1) { hits += 1; hitWords.push(qw); break; }
                if (tw.length >= 5 && qw.length >= 5 && lev(tw, qw) <= 1) { hits += 1; hitWords.push(qw); break; }
            }
        }
        return { hits: hits, hitWords: hitWords };
    }

    function highlightWords(name, hitWords) {
        if (!hitWords || !hitWords.length) return esc(name);
        var escaped = esc(name);
        var uniq = [];
        var seen = {};
        for (var i = 0; i < hitWords.length; i++) {
            var w = hitWords[i];
            if (!seen[w.toLowerCase()]) {
                seen[w.toLowerCase()] = true;
                uniq.push(w);
            }
        }
        uniq.sort(function(a, b){ return b.length - a.length; });
        for (var k = 0; k < uniq.length; k++) {
            var raw = uniq[k];
            var rx = new RegExp('(' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
            escaped = escaped.replace(rx, '<mark>$1</mark>');
        }
        return escaped;
    }

    function findSimilar(q) {
        var st = window.__trkState;
        var tasks = (st && Array.isArray(st.tasks)) ? st.tasks : [];
        var curId = document.getElementById('task_id');
        var skipId = curId ? curId.value : '';
        var qn = norm(q);
        if (qn.length < 3 || !tasks.length) return [];

        var qWords = words(qn);

        var out = [];
        for (var i = 0; i < tasks.length; i++) {
            var t = tasks[i];
            if (!t || t.id === skipId) continue;
            var tn = norm(t.name);
            if (!tn) continue;

            var reason = '', score = 999, hitWords = [];

            if (tn === qn) {
                reason = 'точное совпадение'; score = 0;
                hitWords = qWords.slice();
            } else if (qn.length >= 4 && tn.indexOf(qn) !== -1) {
                reason = 'содержит весь ваш текст'; score = 1;
                hitWords = qWords.slice();
            } else if (tn.length >= 4 && qn.indexOf(tn) !== -1) {
                reason = 'входит в ваш текст'; score = 1;
                hitWords = qWords.slice();
            } else if (qWords.length >= 2) {
                var mw = matchWords(qWords, words(tn));
                if (mw.hits === qWords.length) {
                    reason = 'совпадают все слова'; score = 2;
                    hitWords = mw.hitWords;
                } else if (mw.hits >= 2 && mw.hits >= Math.ceil(qWords.length / 2)) {
                    reason = 'совпадают ' + mw.hits + ' из ' + qWords.length + ' слов'; score = 3;
                    hitWords = mw.hitWords;
                }
            } else if (qWords.length === 1) {
                var mw1 = matchWords(qWords, words(tn));
                if (mw1.hits === 1) {
                    reason = 'совпадает ключевое слово'; score = 3;
                    hitWords = mw1.hitWords;
                }
            }

            if (score === 999 && qn.length >= 5 && tn.length >= 5 && lev(qn, tn) <= 2) {
                reason = 'очень похоже (опечатка?)'; score = 4;
            }

            if (score !== 999) out.push({ t: t, reason: reason, score: score, hitWords: hitWords });
        }

        out.sort(function(a, b){ return a.score - b.score; });

        var seen2 = {};
        var uniq = [];
        for (var j = 0; j < out.length && uniq.length < 6; j++) {
            if (!seen2[out[j].t.id]) {
                seen2[out[j].t.id] = true;
                uniq.push(out[j]);
            }
        }
        return uniq;
    }

    function renderHint(hint, q) {
        var inp = document.getElementById('task_name');
        if (!inp || !hint) return;
        var found = findSimilar(q);
        if (!found.length) {
            hint.setAttribute('hidden', '');
            hint.innerHTML = '';
            return;
        }
        hint.removeAttribute('hidden');
        var html = '<div class="tdh-title">⚠ Найдены похожие задачи (' + found.length + '):</div><div class="tdh-list">';
        found.forEach(function(x){
            html += '<div class="tdh-row" data-tid="' + esc(x.t.id) + '">'
                 +  '<span class="tdh-ico">' + esc(x.t.icon || '📋') + '</span>'
                 +  '<span class="tdh-name">' + highlightWords(x.t.name, x.hitWords) + '</span>'
                 +  '<span class="tdh-reason">' + esc(x.reason) + '</span>'
                 +  '<button type="button" class="tdh-open">Открыть</button>'
                 +  '</div>';
        });
        html += '</div>';
        hint.innerHTML = html;
        hint.querySelectorAll('.tdh-open').forEach(function(b){
            b.addEventListener('click', function(e){
                e.preventDefault(); e.stopPropagation();
                var row = this.closest('.tdh-row');
                var tid = row ? row.getAttribute('data-tid') : '';
                if (!tid) return;
                var st = window.__trkState;
                var t = null;
                var tasks = (st && Array.isArray(st.tasks)) ? st.tasks : [];
                for (var i = 0; i < tasks.length; i++) {
                    if (tasks[i].id === tid) { t = tasks[i]; break; }
                }
                if (!t) return;
                if (!confirm('Открыть существующую задачу «' + t.name + '»?\n\nТекущая форма будет закрыта.')) return;
                var m = document.getElementById('taskModal');
                if (m) m.classList.remove('active');
                if (typeof window.__trkOpenTaskModal === 'function') {
                    setTimeout(function(){ window.__trkOpenTaskModal(t); }, 120);
                }
            });
        });
    }

    function ensure() {
        var inp = document.getElementById('task_name');
        var hint = document.getElementById('taskDupHint');
        if (!inp) return false;
        if (!hint) {
            hint = document.createElement('div');
            hint.className = 'task-dup-hint';
            hint.id = 'taskDupHint';
            hint.setAttribute('hidden', '');
            inp.parentNode.insertBefore(hint, inp.nextSibling);
        }
        if (inp._dupV113Final) return true;
        inp._dupV113Final = true;
        var handler = function() {
            var q = inp.value || '';
            if (q.trim().length < 3) {
                hint.setAttribute('hidden', '');
                hint.innerHTML = '';
                return;
            }
            renderHint(hint, q);
        };
        inp.addEventListener('input', handler);
        inp.addEventListener('change', handler);
        inp.addEventListener('keyup', handler);
        inp.addEventListener('paste', function(){ setTimeout(handler, 50); });
        return true;
    }

    function watchModal() {
        var m = document.getElementById('taskModal');
        if (!m || m._dupV113FinalObs) return;
        m._dupV113FinalObs = true;
        var obs = new MutationObserver(function(){
            if (m.classList.contains('active')) {
                setTimeout(ensure, 30);
                setTimeout(ensure, 200);
                setTimeout(ensure, 500);
            }
        });
        obs.observe(m, { attributes: true, attributeFilter: ['class'] });
    }

    function boot() {
        watchModal();
        setTimeout(watchModal, 500);
        setTimeout(watchModal, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#addTaskBtn') || e.target.closest('#addTaskBtn2')) {
            setTimeout(ensure, 60);
            setTimeout(ensure, 250);
            setTimeout(ensure, 600);
        }
    }, true);

    window.__trkDupCheck = ensure;
})();
/* ============================================================
   v1.1.5 — Очистка блоков похожих задач при закрытии карточек
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkDupCleanupV115) return;
    window.__trkDupCleanupV115 = true;

    function clearHint(id) {
        var h = document.getElementById(id);
        if (!h) return;
        h.setAttribute('hidden', '');
        h.innerHTML = '';
    }

    function attach(modalId, hintId, inputId) {
        var m = document.getElementById(modalId);
        if (!m || m._dupCleanupV115) return;
        m._dupCleanupV115 = true;
        var obs = new MutationObserver(function(){
            if (!m.classList.contains('active')) {
                clearHint(hintId);
            }
        });
        obs.observe(m, { attributes: true, attributeFilter: ['class'] });
    }

    function boot() {
        attach('taskModal', 'taskDupHint', 'task_name');
        attach('logModal', 'logTaskDupHint', 'log_task_input');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
})();
/* ============================================================
   v1.1.6 — Переключение порядка модалок taskModal / logModal
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkModalStackV116) return;
    window.__trkModalStackV116 = true;

    var LOWER = ['logModal', 'dayModal', 'employeeModal', 'departmentModal', 'teamModal', 'userModal'];

    function anyLowerActive() {
        for (var i = 0; i < LOWER.length; i++) {
            var el = document.getElementById(LOWER[i]);
            if (el && el.classList.contains('active')) return true;
        }
        return false;
    }

    function updateStack() {
        var tm = document.getElementById('taskModal');
        if (!tm) return;
        if (tm.classList.contains('active')) {
            tm.style.zIndex = '3500';
        } else if (anyLowerActive()) {
            tm.style.removeProperty('z-index');
        }
    }

    function watch() {
        var ids = ['taskModal'].concat(LOWER);
        for (var i = 0; i < ids.length; i++) {
            var el = document.getElementById(ids[i]);
            if (!el || el._zstackV116) continue;
            el._zstackV116 = true;
            new MutationObserver(updateStack).observe(el, {
                attributes: true,
                attributeFilter: ['class']
            });
        }
        updateStack();
    }

    watch();
    setTimeout(watch, 500);
    setTimeout(watch, 1500);
})();
/* ============================================================
   v1.2.6 — История работы в карточке задачи
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkTaskFeedRender) return;
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function initials(n){var p=String(n||'').trim().split(/\s+/);if(!p.length)return'?';if(p.length===1)return p[0].slice(0,2).toUpperCase();return (p[0][0]+(p[1][0]||'')).toUpperCase();}
    function fh(h){h=Number(h)||0;if(h===Math.floor(h))return h+' ч';return h.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+' ч';}
    function fd(iso){if(!iso)return '';var p=iso.split('-');if(p.length!==3)return iso;return p[2]+'.'+p[1]+'.'+p[0];}

    window.__trkTaskFeedRender = function(d){
        if (!document.getElementById('tcfStyleV19')) {
            var _s = document.createElement('style');
            _s.id = 'tcfStyleV19';
            _s.textContent = [
                '.tcf-wrap{margin:12px 0 8px}',
                '.tcf-block{background:rgba(255,255,255,0.03);border:1px solid rgba(245,215,110,0.12);border-radius:12px;padding:12px 14px}',
                '.tcf-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
                '.tcf-title{font-weight:700;font-size:0.95rem}',
                '.tcf-meta{opacity:0.55;font-size:0.8rem;margin-left:auto}',
                '.tcf-feed{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;padding-right:4px}',
                '.tcf-item{display:flex;gap:10px;padding:8px 10px;border-radius:10px;background:rgba(0,0,0,0.18);border-left:3px solid rgba(245,215,110,0.35)}',
                '.tcf-item--done{border-left-color:#2ecc71}',
                '.tcf-item--blocked{border-left-color:#e74c3c}',
                '.tcf-item--planned{border-left-color:#95a5a6}',
                '.tcf-item--in_progress{border-left-color:#3498db}',
                '.tcf-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#111;flex-shrink:0}',
                '.tcf-body{flex:1;min-width:0}',
                '.tcf-line1{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:0.82rem}',
                '.tcf-name{font-weight:600}',
                '.tcf-date{opacity:0.55}',
                '.tcf-st{font-size:0.75rem;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,0.06)}',
                '.tcf-st-done{color:#2ecc71}',
                '.tcf-st-blocked{color:#e74c3c}',
                '.tcf-h{font-weight:700;color:#f5d76e}',
                '.tcf-text{margin-top:4px;font-size:0.85rem;line-height:1.35;white-space:pre-wrap;word-break:break-word}',
                '.tcf-text-muted{opacity:0.4;font-style:italic}',
                '.tcf-empty{opacity:0.45;padding:8px 0;font-size:0.85rem}',
                '.tcf-links-head{margin-top:10px;font-weight:600;font-size:0.85rem}',
                '.tcf-links{display:flex;flex-direction:column;gap:4px;margin-top:6px}',
                '.tcf-link{display:flex;gap:8px;font-size:0.8rem;color:#7ec8ff;text-decoration:none}',
                '.tcf-link:hover{text-decoration:underline}'
            ].join('');
            document.head.appendChild(_s);
        }

        var wrap = document.getElementById('taskCardFeed');
        if (!wrap) {
            var modal = document.getElementById('taskCardModal');
            var content = modal ? modal.querySelector('.modal-content') : null;
            if (!content) return;
            var list = document.getElementById('taskCardEmployees');
            if (!list || !list.parentNode) return;
            wrap = document.createElement('div');
            wrap.id = 'taskCardFeed';
            wrap.className = 'tcf-wrap';
            list.parentNode.insertBefore(wrap, list.nextSibling);
        }
        var feed = d.feed || [];
        var links = d.links || [];
        var first_log = d.first_log || '';
        var last_log = d.last_log || '';

        var h = '<div class="tcf-block">';
        h += '<div class="tcf-head">';
        h += '<span class="tcf-icon">📖</span>';
        h += '<span class="tcf-title">История работы</span>';
        h += '<span class="tcf-meta">';
        if (first_log) h += fd(first_log);
        if (first_log && last_log && first_log !== last_log) h += ' — ' + fd(last_log);
        h += ' · ' + feed.length + ' коммент.' + (links.length ? ' · ' + links.length + ' ссылок' : '');
        h += '</span>';
        h += '</div>';
        if (!feed.length && !links.length) {
            h += '<div class="tcf-empty">Пока нет отметок по этой задаче</div>';
        } else {
            if (feed.length) {
                h += '<div class="tcf-feed">';
                feed.forEach(function(x){
                    var bg = esc(x.employee_color || '#888');
                    var st = String(x.status || '');
                    var stCls = st === 'done' ? 'tcf-st-done' : (st === 'blocked' ? 'tcf-st-blocked' : (st === 'planned' ? 'tcf-st-planned' : 'tcf-st-work'));
                    h += '<div class="tcf-item tcf-item--' + esc(st || 'log') + '">';
                    h += '<div class="tcf-av" style="background:' + bg + ';">' + esc(initials(x.employee_name)) + '</div>';
                    h += '<div class="tcf-body">';
                    h += '<div class="tcf-line1">';
                    h += '<span class="tcf-name">' + esc(x.employee_name) + '</span>';
                    h += '<span class="tcf-date">' + esc(fd(x.date)) + '</span>';
                    if (x.status_label) h += '<span class="tcf-st ' + stCls + '">' + esc(x.status_label) + '</span>';
                    if (x.hours) h += '<span class="tcf-h">' + esc(fh(x.hours)) + '</span>';
                    h += '</div>';
                    if (x.comment) {
                        h += '<div class="tcf-text">' + esc(x.comment) + '</div>';
                    } else {
                        h += '<div class="tcf-text tcf-text-muted">отметка без комментария</div>';
                    }
                    h += '</div></div>';
                });
                h += '</div>';
            }
            if (links.length) {
                h += '<div class="tcf-links-head">🔗 Ссылки</div>';
                h += '<div class="tcf-links">';
                links.forEach(function(x){
                    h += '<a class="tcf-link" href="' + esc(x.link) + '" target="_blank" rel="noopener">';
                    h += '<span class="tcf-link-date">' + esc(fd(x.date)) + '</span>';
                    h += '<span class="tcf-link-url">' + esc(x.link) + '</span>';
                    h += '</a>';
                });
                h += '</div>';
            }
        }
        h += '</div>';
        wrap.innerHTML = h;
    };
})();
/* ============================================================
   v1.2.7 — Объединение задач
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkTaskMerge) return;
    window.__trkTaskMerge = true;

    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function selected(){ var out=[]; document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){ out.push(cb.getAttribute('data-task-id')); }); return out; }
    function updateBar(){
        var bar = document.getElementById('taskMergeBar');
        if (!bar) return;
        var n = selected().length;
        bar.style.display = n >= 2 ? '' : 'none';
        var c = document.getElementById('taskMergeCount');
        if (c) c.textContent = n;
    }
    function addCbs(){
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        list.querySelectorAll('.task-card').forEach(function(card){
            if (card.querySelector('.task-merge-cb')) return;
            var id = card.getAttribute('data-id');
            if (!id) return;
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'task-merge-cb';
            cb.setAttribute('data-task-id', id);
            cb.title = 'Выбрать для объединения';
            cb.addEventListener('click', function(e){ e.stopPropagation(); });
            cb.addEventListener('change', updateBar);
            card.insertBefore(cb, card.firstChild);
        });
        var wrap = document.getElementById('panel-tasks');
        if (wrap && !document.getElementById('taskMergeBar')) {
            var toolbar = wrap.querySelector('.sum-toolbar');
            if (toolbar) {
                var bar = document.createElement('div');
                bar.id = 'taskMergeBar';
                bar.className = 'task-merge-bar';
                bar.style.display = 'none';
                bar.innerHTML = '<span>🔗 Выбрано <b id="taskMergeCount">0</b> задач</span>'
                    + '<button type="button" class="btn btn-primary" id="taskMergeBtn">Объединить</button>'
                    + '<button type="button" class="btn btn-secondary" id="taskMergeClear">Сбросить</button>';
                toolbar.parentNode.insertBefore(bar, toolbar.nextSibling);
                document.getElementById('taskMergeBtn').addEventListener('click', openModal);
                document.getElementById('taskMergeClear').addEventListener('click', function(){
                    document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){ cb.checked = false; });
                    updateBar();
                });
            }
        }
    }

    function openModal(){
        var ids = selected();
        if (ids.length < 2) return;
        var st = window.__trkState || {};
        var tasks = (st.tasks || []).filter(function(t){ return ids.indexOf(t.id) !== -1; });
        if (tasks.length < 2) return;

        var h = '';
        h += '<div class="tmm-hint">Все поля будут собраны автоматически:</div>';
        h += '<ul class="tmm-rules">';
        h += '<li><b>Название, иконка, статус, даты</b> — от выбранной (radio) задачи</li>';
        h += '<li><b>Теги, отделы, исполнители</b> — объединятся со всех задач</li>';
        h += '<li><b>Описание, папки, приказы</b> — склеятся, по одному значению на строку</li>';
        h += '</ul>';
        h += '<div class="tmm-list-title">Клик — сделать выбранную основной (остальные удалятся):</div>';
        h += '<div class="tmm-list">';
        tasks.forEach(function(t, i){
            var desc = (t.description||'').replace(/\s+/g,' ').trim();
            var folder = (t.folder||'').trim();
            var order = (t.order_ref||'').trim();
            var empsN = (t.assignees||[]).length;
            var tagsN = (t.tags||[]).length;
            var depsN = (t.department_ids||[]).length;
            h += '<label class="tmm-card' + (i===0?' selected':'') + '">';
            h += '<input type="radio" name="tmm_survivor" value="' + esc(t.id) + '"' + (i===0?' checked':'') + '>';
            h += '<span class="tmm-ico">' + esc(t.icon||'📋') + '</span>';
            h += '<div class="tmm-body">';
            h += '<div class="tmm-name">' + esc(t.name) + '</div>';
            h += '<div class="tmm-meta">';
            h += '<span>📅 ' + (t.start_date||'—') + ' → ' + (t.deadline||'—') + '</span>';
            h += '<span>🏷 ' + tagsN + '</span>';
            h += '<span>👥 ' + empsN + '</span>';
            h += '<span>🏢 ' + depsN + '</span>';
            h += '</div>';
            if (desc) h += '<div class="tmm-desc">' + esc(desc.slice(0, 140)) + (desc.length>140?'…':'') + '</div>';
            if (folder) h += '<div class="tmm-fold">📁 ' + esc(folder.split('\n').filter(Boolean).slice(0,2).join(' · ')) + (folder.split('\n').length>2?'…':'') + '</div>';
            if (order) h += '<div class="tmm-ord">📄 ' + esc(order.split('\n').filter(Boolean).slice(0,2).join(' · ')) + (order.split('\n').length>2?'…':'') + '</div>';
            h += '</div></label>';
        });
        h += '</div>';
        h += '<div class="modal-actions"><button class="btn btn-secondary" data-close="taskMergeModal">Отмена</button>';
        h += '<button class="btn btn-primary" id="tmm_submit">🔗 Объединить</button></div>';

        var modal = document.getElementById('taskMergeModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'taskMergeModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content"><h2>🔗 Объединение задач</h2><div id="tmm_body"></div></div>';
            document.body.appendChild(modal);
            modal.addEventListener('click', function(e){ if (e.target === modal) modal.classList.remove('active'); });
        }
        document.getElementById('tmm_body').innerHTML = h;
        var body = document.getElementById('tmm_body');
        body.querySelectorAll('[data-close]').forEach(function(b){
            b.onclick = function(){ modal.classList.remove('active'); };
        });
        body.querySelectorAll('.tmm-card').forEach(function(card){
            card.addEventListener('click', function(){
                body.querySelectorAll('.tmm-card').forEach(function(c){ c.classList.remove('selected'); });
                card.classList.add('selected');
            });
        });
        document.getElementById('tmm_submit').onclick = function(){ submit(ids); };
        modal.classList.add('active');
    }

    function submit(ids){
        var survivor = '';
        document.querySelectorAll('input[name="tmm_survivor"]').forEach(function(r){ if (r.checked) survivor = r.value; });
        var payload = {
            task_ids: ids,
            survivor_id: survivor,
        };
        var hdrs = { 'Content-Type': 'application/json' };
        if (window.REESTR_CSRF) hdrs['X-CSRF-Token'] = window.REESTR_CSRF;
        fetch('/api/tracker/task/merge', {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify(payload),
        })
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (!d.success) { alert('Ошибка: ' + (d.error || 'неизвестная')); return; }
            var modal = document.getElementById('taskMergeModal');
            if (modal) modal.classList.remove('active');
            document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){ cb.checked = false; });
            updateBar();
            if (typeof window.__trkLoadState === 'function') window.__trkLoadState();
            alert('✅ Объединено задач: ' + (1 + (d.merged_ids || []).length));
        })
        .catch(function(e){ alert('Ошибка: ' + e.message); });
    }

    function boot(){ addCbs(); setTimeout(addCbs, 500); setTimeout(addCbs, 1500); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="tasks"]')) setTimeout(addCbs, 250);
    });
})();
/* ============================================================
   v1.2.12 — Watchdog лоадера: автозакрытие через 8 секунд
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkLoaderWatchdog) return;
    window.__trkLoaderWatchdog = true;

    function setup(el) {
        if (!el || el._watchdogHooked) return;
        el._watchdogHooked = true;
        el._shownAt = 0;
        new MutationObserver(function(){
            if (el.classList.contains('active')) {
                if (!el._shownAt) el._shownAt = Date.now();
            } else {
                el._shownAt = 0;
            }
        }).observe(el, { attributes: true, attributeFilter: ['class'] });
        setInterval(function(){
            if (!el.classList.contains('active')) return;
            if (!el._shownAt) { el._shownAt = Date.now(); return; }
            if (Date.now() - el._shownAt > 8000) {
                el.classList.remove('active');
                el._shownAt = 0;
                console.warn('[loader] автоскрытие: 8s');
            }
        }, 1000);
    }

    function find(){
        var el = document.getElementById('globalLoader');
        if (el) setup(el);
        else setTimeout(find, 500);
    }
    find();
})();
/* ============================================================
   v1.2.17 — Раздельные столбцы для Задач/Сотрудников,
   фикс column-count в «Сотрудниках», версия в шапке
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkFixesV1217) return;
    window.__trkFixesV1217 = true;

    var LS_TASKS = 'tracker_day_cols';
    var LS_EMP   = 'tracker_day_cols_emp';

    function readNum(key, def){
        try { var v = parseInt(localStorage.getItem(key), 10); if (v >= 1 && v <= 4) return v; } catch(e){}
        return def;
    }
    function writeNum(key, v){ try { localStorage.setItem(key, String(v)); } catch(e){} }

    function currentMode(){
        var list = document.getElementById('dayList');
        return list && list.classList.contains('day-list--employees') ? 'emp' : 'tasks';
    }
    function colsFor(mode){
        if (mode === 'emp') return readNum(LS_EMP, 1);
        return readNum(LS_TASKS, 1);
    }
    function saveFor(mode, v){
        if (mode === 'emp') writeNum(LS_EMP, v);
        else writeNum(LS_TASKS, v);
    }

    function pickerMax(mode){
        return mode === 'emp' ? 2 : 2;
    }

    function updatePickerVisibility(){
        var p = document.getElementById('dayColsPicker');
        if (!p) return;
        var mode = currentMode();
        var max = pickerMax(mode);
        p.querySelectorAll('button').forEach(function(b){
            var v = parseInt(b.getAttribute('data-cols'), 10);
            b.style.display = (v <= max) ? '' : 'none';
        });
    }

    function syncPicker(){
        var p = document.getElementById('dayColsPicker');
        if (!p) return;
        var v = colsFor(currentMode());
        p.querySelectorAll('button').forEach(function(b){
            b.classList.toggle('active', parseInt(b.getAttribute('data-cols'), 10) === v);
        });
    }

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        var b = e.target.closest('#dayColsPicker button');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        var v = parseInt(b.getAttribute('data-cols'), 10);
        var mode = currentMode();
        var max = pickerMax(mode);
        if (!(v >= 1)) v = 1;
        if (v > max) v = max;
        saveFor(mode, v);
        if (typeof window.__trkApplyDayLayout === 'function') {
            setTimeout(window.__trkApplyDayLayout, 30);
        }
        setTimeout(syncPicker, 40);
    }, true);

    function applyAll(){
        var dayM = document.getElementById('dayModal');
        if (!dayM || !dayM.classList.contains('active')) return;
        var lm = document.getElementById('logModal');
        if (lm && lm.classList.contains('active')) return;
        var list = document.getElementById('dayList');
        if (!list) return;
        var mode = currentMode();
        var v = colsFor(mode);
        if (mode === 'emp') {
            list.style.setProperty('display', 'block', 'important');
            list.style.setProperty('column-count', 'auto', 'important');
            var tiles = list.querySelector('.day-emp-tiles');
            if (tiles) {
                tiles.style.setProperty('display', 'grid', 'important');
                tiles.style.setProperty('grid-template-columns',
                    v === 1 ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', 'important');
                tiles.style.setProperty('gap', '12px', 'important');
                tiles.style.setProperty('width', '100%', 'important');
                tiles.style.setProperty('align-items', 'stretch', 'important');
            }
        } else {
            list.style.removeProperty('column-count');
            list.style.removeProperty('display');
            list.setAttribute('data-cols', String(v));
        }
        list.setAttribute('data-cols', String(v));
        updatePickerVisibility();
        syncPicker();
    }

    window.__trkApplyDayLayout = applyAll;

    // PATCH v2: убран setInterval — вызывает перерисовку layout каждые 1.5 сек.
    // Теперь только по событиям: открытие dayModal, смена вида, смена кол-ва колонок.

    function ensureVersionBadge(){
        if (document.getElementById('trkVersionBadge')) return;
        var header = document.querySelector('.tracker-header');
        if (!header) return;
        var a = document.createElement('a');
        a.id = 'trkVersionBadge';
        a.className = 'theme-toggle-btn trk-version-badge';
        a.href = '/plugins/updater/';
        a.title = 'Версия программы и обновления';
        a.innerHTML = '<span class="tvb-ico">📦</span><span class="tvb-ver" id="trkVersionNum">—</span><span class="tvb-dot" id="trkVersionDot" style="display:none;"></span>';
        var userMenu = header.querySelector('.user-menu');
        if (userMenu) header.insertBefore(a, userMenu);
        else header.appendChild(a);
    }

    function checkVersion(){
        fetch('/api/plugins/updater/version', {credentials: 'same-origin'})
            .then(function(r){ return r.json(); })
            .then(function(d){
                if (!d || !d.success) return;
                var vEl = document.getElementById('trkVersionNum');
                var dot = document.getElementById('trkVersionDot');
                if (vEl) vEl.textContent = 'v' + (d.version || '?');
                if (dot) {
                    if (d.has_update) {
                        dot.style.display = '';
                        dot.title = 'Доступно обновление ' + (d.remote_version || '');
                    } else {
                        dot.style.display = 'none';
                    }
                }
                var b = document.getElementById('trkVersionBadge');
                if (b) {
                    b.classList.toggle('has-update', !!d.has_update);
                    b.classList.toggle('has-gaps', !!d.has_gaps);
                    if (d.has_gaps) {
                        b.title = 'Цепочка патчей разорвана. Версия: ' + (d.version || '?') + '. Пропущено: ' + (d.missing_ids || []).join(', ');
                    } else {
                        b.title = 'Версия программы: ' + (d.version || '?');
                    }
                }
            })
            .catch(function(){});
    }

    ensureVersionBadge();
    setTimeout(ensureVersionBadge, 500);
    setTimeout(ensureVersionBadge, 1500);
    setTimeout(checkVersion, 900);
    setInterval(checkVersion, 5 * 60 * 1000);

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab')) setTimeout(ensureVersionBadge, 200);
    });

    // PATCH v2: layout применяем по событиям вместо интервала
    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#dayViewMode button') ||
            e.target.closest('#dayColsPicker button')) {
            setTimeout(applyAll, 100);
            setTimeout(applyAll, 300);
        }
    }, true);

    // При открытии dayModal
    setTimeout(function(){
        var m = document.getElementById('dayModal');
        if (!m) return;
        new MutationObserver(function(){
            if (m.classList.contains('active')) {
                setTimeout(applyAll, 60);
                setTimeout(applyAll, 250);
            }
        }).observe(m, { attributes: true, attributeFilter: ['class'] });
    }, 600);
})();
/* ============================================================
   v1.2.21 — Дополнительная информация в карточках Задач
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkTaskExtraInfo) return;
    window.__trkTaskExtraInfo = true;

    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function trunc(s, n){ s = String(s||''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    function linksByTask(){
        var st = window.__trkState || {};
        var out = {};
        var logs = st.log || [];
        var cutoff = '';
        try {
            var d = new Date();
            d.setDate(d.getDate() - 90);
            cutoff = d.toISOString().slice(0, 10);
        } catch(e) {}
        for (var i = 0; i < logs.length; i++) {
            var l = logs[i];
            var tid = l.task_id;
            var lk = (l.link || '').trim();
            if (!tid || !lk) continue;
            if (cutoff && (l.date || '') < cutoff) continue;
            var arr = out[tid] || (out[tid] = []);
            var seen = false;
            for (var k = 0; k < arr.length; k++) if (arr[k] === lk) { seen = true; break; }
            if (!seen) arr.push(lk);
            if (arr.length >= 5) continue;
        }
        return out;
    }

    function buildExtraHtml(t, links) {
        var h = '';
        var desc = (t.description || '').trim();
        if (desc) {
            h += '<div class="txi txi-desc" title="' + esc(desc) + '">' + esc(trunc(desc.replace(/\s+/g, ' '), 220)) + '</div>';
        }
        var folders = (t.folder || '').split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean);
        var orders = (t.order_ref || '').split(/\r?\n/).map(function(x){ return x.trim(); }).filter(Boolean);
        if (orders.length) {
            var showO = orders.slice(0, 2).map(esc).join(' · ');
            var restO = orders.length > 2 ? ' <span class="txi-more">+' + (orders.length - 2) + '</span>' : '';
            h += '<div class="txi txi-ord" title="' + esc(orders.join('\n')) + '">📄 ' + showO + restO + '</div>';
        }
        if (folders.length) {
            var showF = folders.slice(0, 2).map(esc).join(' · ');
            var restF = folders.length > 2 ? ' <span class="txi-more">+' + (folders.length - 2) + '</span>' : '';
            h += '<div class="txi txi-fold" title="' + esc(folders.join('\n')) + '">📁 ' + showF + restF + '</div>';
        }
        if (links && links.length) {
            h += '<div class="txi txi-links">';
            links.slice(0, 3).forEach(function(lk){
                h += '<a class="txi-link" href="' + esc(lk) + '" target="_blank" rel="noopener" title="' + esc(lk) + '">🔗 ' + esc(trunc(lk, 60)) + '</a>';
            });
            if (links.length > 3) h += '<span class="txi-more">+' + (links.length - 3) + '</span>';
            h += '</div>';
        }
        if (!h) return '';
        return '<div class="task-card-extra">' + h + '</div>';
    }

    function injectForList() {
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        var st = window.__trkState || {};
        var tasks = {};
        (st.tasks || []).forEach(function(t){ tasks[t.id] = t; });
        var links = linksByTask();
        list.querySelectorAll('.task-card, .dict-item').forEach(function(card){
            var id = card.getAttribute('data-id');
            if (!id) return;
            var t = tasks[id];
            if (!t) return;
            var old = card.querySelector('.task-card-extra');
            if (old) old.remove();
            var html = buildExtraHtml(t, links[id] || []);
            if (!html) return;
            var head = card.querySelector('.task-card-head');
            if (head && head.parentNode) {
                head.parentNode.insertBefore(htmlToNode(html), head.nextSibling);
                return;
            }
            var body = card.querySelector('.dict-item-body');
            if (body) body.appendChild(htmlToNode(html));
        });
    }

    function htmlToNode(html) {
        var w = document.createElement('div');
        w.innerHTML = html;
        return w.firstElementChild;
    }

    function boot(){
        injectForList();
        setTimeout(injectForList, 400);
        setTimeout(injectForList, 1000);
        setTimeout(injectForList, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    setInterval(function(){
        var panel = document.getElementById('panel-tasks');
        if (!panel || !panel.classList.contains('active')) return;
        injectForList();
    }, 2000);

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="tasks"]') ||
            e.target.closest('#tskDisplayMode button') ||
            e.target.closest('.sum-filter')) {
            setTimeout(injectForList, 350);
        }
    });

    window.__trkInjectTaskExtra = injectForList;
})();
/* ============================================================
   v1.0.4 — Автовыбор отделов по выбранным сотрудникам
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkAutoDepsV104) return;
    window.__trkAutoDepsV104 = true;

    function empDept(empId) {
        var st = window.__trkState;
        if (!st || !st.employees) return '';
        var e = st.employees.find(function(x){ return x.id === empId; });
        return (e && e.department_id) ? e.department_id : '';
    }

    function selectDept(deptId) {
        if (!deptId) return false;
        var list = document.getElementById('taskDepartmentsList');
        if (!list) return false;
        var cb = list.querySelector('input[type="checkbox"][value="' + deptId + '"]');
        if (!cb) return false;
        if (cb.checked) return false;
        cb.checked = true;
        try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
        return true;
    }

    function autoSelectAll() {
        var list = document.getElementById('taskAssigneesList');
        if (!list) return;
        var ids = [];
        list.querySelectorAll('input[type="checkbox"]:checked').forEach(function(cb){
            ids.push(cb.value);
        });
        ids.forEach(function(eid){ selectDept(empDept(eid)); });
    }

    document.addEventListener('change', function(e){
        if (!e.target || e.target.type !== 'checkbox') return;
        var list = e.target.closest('#taskAssigneesList');
        if (!list) return;
        if (!e.target.checked) return;
        var deptId = empDept(e.target.value);
        selectDept(deptId);
    }, true);

    function wrapOpenTaskModal() {
        var orig = window.__trkOpenTaskModal;
        if (typeof orig !== 'function' || orig._autoDepsHooked) return;
        var wrapped = function() {
            var r = orig.apply(this, arguments);
            setTimeout(autoSelectAll, 60);
            setTimeout(autoSelectAll, 200);
            return r;
        };
        wrapped._autoDepsHooked = true;
        window.__trkOpenTaskModal = wrapped;
    }

    wrapOpenTaskModal();
    setTimeout(wrapOpenTaskModal, 500);
    setTimeout(wrapOpenTaskModal, 1500);

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#addTaskBtn') || e.target.closest('#addTaskBtn2')) {
            setTimeout(autoSelectAll, 200);
            setTimeout(autoSelectAll, 500);
        }
    });

    window.__trkAutoSelectDepts = autoSelectAll;
})();
/* ============================================================
   PATCH 1.0.11 — Динамический padding у logModal (закомментировано)
   PATCH v2: полностью удалён — PATCH 1.0.19 в CSS уже обнуляет 
   padding для всех вариантов #logModal .modal-content. 
   Динамический padding измерял высоту шапки и футера, но не 
   применял её (был закомментирован).
   ============================================================ */
/* ============================================================
   PATCH 1.0.13 — Модалка информации об отсутствии
   ============================================================ */
(function() {
    'use strict';

    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }

    function _initials(name) {
        var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + (parts[1][0] || '')).toUpperCase();
    }

    function _fmtHuman(iso) {
        if (!iso) return '';
        var p = iso.split('-');
        if (p.length !== 3) return iso;
        var MON = ['января','февраля','марта','апреля','мая','июня','июля',
                   'августа','сентября','октября','ноября','декабря'];
        var m = parseInt(p[1], 10) - 1;
        return parseInt(p[2], 10) + ' ' + (MON[m] || p[1]) + ' ' + p[0];
    }

    function _daysBetween(a, b) {
        try {
            var d = Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
            return d + 1;
        } catch (e) { return 0; }
    }

    function _findAbsence(empId, dk) {
        var st = window.__trkState;
        if (!st || !st.employees) return null;
        var emp = st.employees.find(function(e) { return e.id === empId; });
        if (!emp || !emp.vacations) return null;
        for (var i = 0; i < emp.vacations.length; i++) {
            var v = emp.vacations[i];
            var f = v.from || '', t = v.to || '';
            if (f && t && f <= dk && dk <= t) {
                return { emp: emp, period: v };
            }
        }
        return null;
    }

    window.__trkOpenAbsenceInfo = function(empId, dk) {
        var found = _findAbsence(empId, dk);
        if (!found) return;
        var emp = found.emp;
        var v = found.period;
        var vtype = v.type || 'vacation';
        var labels = {
            vacation:      '🌞 Отпуск',
            sick_leave:    '🤒 Больничный',
            business_trip: '✈️ Командировка',
            remote:        '🏠 Удаленка'
        };
        var colors = {
            vacation:      '#3498db',
            sick_leave:    '#f39c12',
            business_trip: '#9b59b6',
            remote:        '#00acc1'
        };
        var days = _daysBetween(v.from, v.to);
        var html = '';
        html += '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--trk-hover-row);border-radius:12px;margin-bottom:14px;border-left:4px solid ' + colors[vtype] + ';">';
        html += '<div style="width:44px;height:44px;border-radius:50%;background:' + _esc(emp.color || '#888') + ';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1rem;text-shadow:0 1px 3px rgba(0,0,0,0.35);flex-shrink:0;">' + _esc(_initials(emp.name)) + '</div>';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:700;color:var(--trk-text);font-size:1rem;word-break:break-word;">' + _esc(emp.name || '') + '</div>';
        var sub = '';
        if (emp.department) sub += '🏢 ' + _esc(emp.department);
        if (emp.role) sub += (sub ? ' · ' : '') + _esc(emp.role);
        if (sub) html += '<div style="font-size:0.78rem;color:var(--trk-meta);margin-top:2px;">' + sub + '</div>';
        html += '</div></div>';

        html += '<div style="padding:14px 16px;background:var(--trk-hover-row);border-radius:12px;display:flex;flex-direction:column;gap:10px;">';
        html += '<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.9rem;"><span style="color:var(--trk-meta);">Тип:</span><span style="font-weight:700;color:' + colors[vtype] + ';">' + (labels[vtype] || vtype) + '</span></div>';
        html += '<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.9rem;"><span style="color:var(--trk-meta);">Период:</span><span style="font-weight:700;color:var(--trk-text);text-align:right;">' + _esc(_fmtHuman(v.from)) + ' — ' + _esc(_fmtHuman(v.to)) + '</span></div>';
        html += '<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.9rem;"><span style="color:var(--trk-meta);">Длительность:</span><span style="font-weight:700;color:var(--trk-accent);">' + days + ' дн.</span></div>';
        if (v.comment) {
            html += '<div style="font-size:0.85rem;color:var(--trk-desc);padding-top:8px;border-top:1px dashed var(--trk-border-soft);line-height:1.5;word-break:break-word;">' + _esc(v.comment) + '</div>';
        }
        html += '</div>';

        var body = document.getElementById('absenceInfoBody');
        if (body) body.innerHTML = html;
        var modal = document.getElementById('absenceInfoModal');
        if (modal) modal.classList.add('active');
    };

    function _findEmpId(td) {
        var eid = td.getAttribute('data-emp');
        if (eid) return eid;
        var tr = td.parentNode;
        while (tr) {
            var ec = tr.querySelector ? tr.querySelector('td.emp-cell[data-emp]') : null;
            if (ec) return ec.getAttribute('data-emp');
            tr = tr.previousElementSibling;
        }
        return '';
    }

    function _findDate(td) {
        var dk = td.getAttribute('data-date');
        if (dk) return dk;
        var t = td.getAttribute('title') || '';
        var m = t.match(/\d{4}-\d{2}-\d{2}/);
        return m ? m[0] : '';
    }

    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        var td = e.target.closest(
            'td.day-cell.absence-vacation,' +
            'td.day-cell.absence-sick_leave,' +
            'td.day-cell.absence-business_trip,' +
            'td.day-cell.absence-remote,' +
            'td.vacation-cell,' +
            'td.sick_leave-cell,' +
            'td.business_trip-cell,' +
            'td.remote-cell'
        );
        if (!td) return;
        var empId = _findEmpId(td);
        var dk = _findDate(td);
        if (!empId || !dk) return;
        e.stopPropagation();
        e.preventDefault();
        window.__trkOpenAbsenceInfo(empId, dk);
    }, true);

    document.addEventListener('click', function(e) {
        if (!e.target) return;
        if (e.target.id === 'absenceInfoModal') {
            e.target.classList.remove('active');
            return;
        }
        var closeBtn = e.target.closest && e.target.closest('[data-close="absenceInfoModal"]');
        if (closeBtn) {
            var m = document.getElementById('absenceInfoModal');
            if (m) m.classList.remove('active');
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        var m = document.getElementById('absenceInfoModal');
        if (m && m.classList.contains('active')) m.classList.remove('active');
    });
})();
/* ============================================================
   PATCH 1.0.18 — Меряем высоту sticky-шапки
   ============================================================ */
(function() {
    'use strict';

    function measureHeader() {
        var header = document.querySelector('.tracker-header');
        if (!header) return;
        var h = Math.ceil(header.getBoundingClientRect().height);
        if (h > 0) {
            document.documentElement.style.setProperty('--tracker-header-h', h + 'px');
        }
    }

    window.addEventListener('load', measureHeader);
    window.addEventListener('resize', measureHeader);
    setTimeout(measureHeader, 100);
    setTimeout(measureHeader, 400);
    setTimeout(measureHeader, 1500);

    var header = document.querySelector('.tracker-header');
    if (header) {
        try {
            new MutationObserver(measureHeader).observe(header, {
                childList: true, subtree: true
            });
        } catch (e) {}
    }

    window.__trkMeasureHeader = measureHeader;
})();



/* ============================================================
   v1.2.7-merge-v2 — Объединение задач с чекбоксами при наведении
   Guard: window.__trkTaskMerge — повторный запуск блока ничего не делает.
   ============================================================ */
(function(){
    'use strict';
    if (window.__trkTaskMerge) return;
    window.__trkTaskMerge = true;

    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

    function selected(){
        var out = [];
        document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){
            out.push(cb.getAttribute('data-task-id'));
        });
        return out;
    }

    function updateBar(){
        var bar = document.getElementById('taskMergeBar');
        if (!bar) return;
        var n = selected().length;
        bar.style.display = n >= 2 ? '' : 'none';
        var c = document.getElementById('taskMergeCount');
        if (c) c.textContent = n;
    }

    function ensureBar(){
        var panel = document.getElementById('panel-tasks');
        if (!panel) return;
        if (document.getElementById('taskMergeBar')) return;
        var toolbar = panel.querySelector('.sum-toolbar');
        if (!toolbar) return;
        var bar = document.createElement('div');
        bar.id = 'taskMergeBar';
        bar.className = 'task-merge-bar';
        bar.style.display = 'none';
        bar.innerHTML = '<span>🔗 Выбрано <b id="taskMergeCount">0</b> задач</span>'
            + '<button type="button" class="btn btn-primary" id="taskMergeBtn">Объединить</button>'
            + '<button type="button" class="btn btn-secondary" id="taskMergeClear">Сбросить</button>';
        toolbar.parentNode.insertBefore(bar, toolbar.nextSibling);
        document.getElementById('taskMergeBtn').addEventListener('click', openModal);
        document.getElementById('taskMergeClear').addEventListener('click', function(){
            document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){ cb.checked = false; });
            document.querySelectorAll('.task-card').forEach(function(c){ c.classList.remove('task-card--merge-selected'); });
            updateBar();
        });
    }

    function addCbs(){
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        list.querySelectorAll('.task-card').forEach(function(card){
            if (card.querySelector('.task-merge-cb')) return;
            var id = card.getAttribute('data-id');
            if (!id) return;
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'task-merge-cb';
            cb.setAttribute('data-task-id', id);
            cb.title = 'Выбрать для объединения';
            cb.addEventListener('click', function(e){ e.stopPropagation(); });
            cb.addEventListener('change', function(){
                if (this.checked) card.classList.add('task-card--merge-selected');
                else card.classList.remove('task-card--merge-selected');
                updateBar();
            });
            card.insertBefore(cb, card.firstChild);
        });
        ensureBar();
        updateBar();
    }

    function openModal(){
        var ids = selected();
        if (ids.length < 2) return;
        var st = window.__trkState || {};
        var tasks = (st.tasks || []).filter(function(t){ return ids.indexOf(t.id) !== -1; });
        if (tasks.length < 2) return;

        var h = '';
        h += '<div class="tmm-hint">Все поля будут собраны автоматически:</div>';
        h += '<ul class="tmm-rules">';
        h += '<li><b>Название, иконка, статус, даты</b> — от выбранной (radio) задачи</li>';
        h += '<li><b>Теги, отделы, исполнители</b> — объединятся со всех задач</li>';
        h += '<li><b>Описание, папки, приказы</b> — склеятся, по одному значению на строку</li>';
        h += '</ul>';
        h += '<div class="tmm-list-title">Клик — сделать выбранную основной (остальные удалятся):</div>';
        h += '<div class="tmm-list">';
        tasks.forEach(function(t, i){
            var desc = (t.description||'').replace(/\s+/g,' ').trim();
            var folder = (t.folder||'').trim();
            var order = (t.order_ref||'').trim();
            var empsN = (t.assignees||[]).length;
            var tagsN = (t.tags||[]).length;
            var depsN = (t.department_ids||[]).length;
            h += '<label class="tmm-card' + (i===0?' selected':'') + '">';
            h += '<input type="radio" name="tmm_survivor" value="' + esc(t.id) + '"' + (i===0?' checked':'') + '>';
            h += '<span class="tmm-ico">' + esc(t.icon||'📋') + '</span>';
            h += '<div class="tmm-body">';
            h += '<div class="tmm-name">' + esc(t.name) + '</div>';
            h += '<div class="tmm-meta">';
            h += '<span>📅 ' + (t.start_date||'—') + ' → ' + (t.deadline||'—') + '</span>';
            h += '<span>🏷 ' + tagsN + '</span>';
            h += '<span>👥 ' + empsN + '</span>';
            h += '<span>🏢 ' + depsN + '</span>';
            h += '</div>';
            if (desc) h += '<div class="tmm-desc">' + esc(desc.slice(0, 140)) + (desc.length>140?'…':'') + '</div>';
            if (folder) h += '<div class="tmm-fold">📁 ' + esc(folder.split('\n').filter(Boolean).slice(0,2).join(' · ')) + (folder.split('\n').length>2?'…':'') + '</div>';
            if (order) h += '<div class="tmm-ord">📄 ' + esc(order.split('\n').filter(Boolean).slice(0,2).join(' · ')) + (order.split('\n').length>2?'…':'') + '</div>';
            h += '</div></label>';
        });
        h += '</div>';
        h += '<div class="modal-actions"><button class="btn btn-secondary" data-close="taskMergeModal">Отмена</button>';
        h += '<button class="btn btn-primary" id="tmm_submit">🔗 Объединить</button></div>';

        var modal = document.getElementById('taskMergeModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'taskMergeModal';
            modal.className = 'modal';
            modal.style.setProperty('z-index', '9000', 'important');
            modal.innerHTML = '<div class="modal-content"><h2>🔗 Объединение задач</h2><div id="tmm_body"></div></div>';
            document.body.appendChild(modal);
            modal.addEventListener('click', function(e){ if (e.target === modal) modal.classList.remove('active'); });
        }
        modal.style.setProperty('z-index', '9000', 'important');
        document.getElementById('tmm_body').innerHTML = h;
        var body = document.getElementById('tmm_body');
        body.querySelectorAll('[data-close]').forEach(function(b){
            b.onclick = function(){ modal.classList.remove('active'); };
        });
        body.querySelectorAll('.tmm-card').forEach(function(card){
            card.addEventListener('click', function(){
                body.querySelectorAll('.tmm-card').forEach(function(c){ c.classList.remove('selected'); });
                card.classList.add('selected');
            });
        });
        document.getElementById('tmm_submit').onclick = function(){ submit(ids); };
        modal.classList.add('active');
    }

    function submit(ids){
        var survivor = '';
        document.querySelectorAll('input[name="tmm_survivor"]').forEach(function(r){ if (r.checked) survivor = r.value; });
        var payload = { task_ids: ids, survivor_id: survivor };
        var hdrs = { 'Content-Type': 'application/json' };
        if (window.REESTR_CSRF) hdrs['X-CSRF-Token'] = window.REESTR_CSRF;
        fetch('/api/tracker/task/merge', {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify(payload)
        })
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (!d.success) { alert('Ошибка: ' + (d.error || 'неизвестная')); return; }
            var modal = document.getElementById('taskMergeModal');
            if (modal) modal.classList.remove('active');
            document.querySelectorAll('.task-merge-cb:checked').forEach(function(cb){ cb.checked = false; });
            document.querySelectorAll('.task-card--merge-selected').forEach(function(c){ c.classList.remove('task-card--merge-selected'); });
            updateBar();
            if (typeof window.__trkLoadState === 'function') window.__trkLoadState();
            if (typeof window.__trackerNotify === 'function') window.__trackerNotify('✅ Объединено задач: ' + (1 + (d.merged_ids || []).length), 'success');
            else alert('✅ Объединено задач: ' + (1 + (d.merged_ids || []).length));
        })
        .catch(function(e){ alert('Ошибка: ' + e.message); });
    }

    // MutationObserver на #tasksFullList: восстанавливаем чекбоксы после каждой перерисовки
    function hookList(){
        var list = document.getElementById('tasksFullList');
        if (!list || list._mergeHooked) return;
        list._mergeHooked = true;
        new MutationObserver(function(){
            addCbs();
        }).observe(list, { childList: true });
        addCbs();
    }

    function boot(){
        addCbs();
        ensureBar();
        hookList();
        setTimeout(function(){ addCbs(); hookList(); }, 500);
        setTimeout(function(){ addCbs(); hookList(); }, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('.tracker-tab[data-tab="tasks"]')) {
            setTimeout(function(){ hookList(); addCbs(); }, 250);
        }
    });

    window.__trkTaskMergeOpen = openModal;
})();


/* PATCH v1.0.10: централизованный стек модалок по порядку открытия */
(function(){
'use strict';
if (window.__trkModalZStack) return;
window.__trkModalZStack = true;
var BASE = 2000, STEP = 100, _stack = [];
function _recompute() {
    _stack.forEach(function(id, i) {
        var m = document.getElementById(id);
        if (!m || m._zstackForeign) return;
        if (!m._zstackSetByUs && m.style.zIndex) { m._zstackForeign = true; return; }
        m.style.setProperty('z-index', String(BASE + (i + 1) * STEP), 'important');
        m._zstackSetByUs = true;
    });
}
function _onClassChange(el) {
    if (!el || !el.classList || !el.classList.contains('modal')) return;
    var id = el.id; if (!id) return;
    var isActive = el.classList.contains('active');
    var idx = _stack.indexOf(id);
    if (isActive && idx === -1) { _stack.push(id); }
    else if (!isActive && idx !== -1) { _stack.splice(idx, 1); }
    else { return; }
    _recompute();
}
function _scan() {
    document.querySelectorAll('.modal').forEach(function(m) {
        if (!m.id || m._zstackHooked) return;
        m._zstackHooked = true;
        new MutationObserver(function(){ _onClassChange(m); })
            .observe(m, { attributes: true, attributeFilter: ['class'] });
        if (m.classList.contains('active') && _stack.indexOf(m.id) === -1) _stack.push(m.id);
    });
    _recompute();
}
function boot() { _scan(); setTimeout(_scan, 500); setTimeout(_scan, 1500); setTimeout(_scan, 3000); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
document.addEventListener('click', function(){ setTimeout(_scan, 120); });
})();


/* PATCH v1.0.11: поиск в списках выбора */
(function(){
'use strict';
if (window.__trkSearchInLists) return;
window.__trkSearchInLists = true;
function _setupFilter(listId) {
    var list = document.getElementById(listId);
    if (!list || list._searchBox) return;
    var wrap = list.parentNode; if (!wrap) return;
    var box = document.createElement('div');
    box.className = 'assignees-search-wrap';
    box.innerHTML =
        '<span class="assignees-search-icon">🔍</span>' +
        '<input type="text" class="assignees-search" placeholder="' + (/dep/i.test(String(listId)) ? 'Поиск по банку…' : 'Поиск по ФИО…') + '" autocomplete="off">' +
        '<button type="button" class="assignees-search-clear" style="display:none;" title="Очистить">×</button>';
    wrap.insertBefore(box, list);
    list._searchBox = box;
    var input = box.querySelector('input');
    var clearBtn = box.querySelector('.assignees-search-clear');
    function applyFilter() {
        var q = (input.value || '').trim().toLowerCase();
        clearBtn.style.display = q ? '' : 'none';
        list.querySelectorAll('.assignees-item, .dept-multi-item').forEach(function(item) {
            var txt = (item.textContent || '').toLowerCase();
            item.style.display = (!q || txt.indexOf(q) !== -1) ? '' : 'none';
        });
        list.querySelectorAll('.assignees-group').forEach(function(grp) {
            var hasVisible = false;
            grp.querySelectorAll('.assignees-item').forEach(function(it) {
                if (it.style.display !== 'none') hasVisible = true;
            });
            grp.style.display = hasVisible ? '' : 'none';
        });
    }
    input.addEventListener('input', applyFilter);
    clearBtn.addEventListener('click', function() { input.value = ''; applyFilter(); input.focus(); });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.preventDefault(); input.value = ''; applyFilter(); }
    });
    new MutationObserver(applyFilter).observe(list, { childList: true });
}
function setup() {
    _setupFilter('taskAssigneesList');
    _setupFilter('taskDepartmentsList');
    _setupFilter('teamMembersList');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(setup, 400); }); else setTimeout(setup, 400);
setTimeout(setup, 1200);
setTimeout(setup, 2500);
window.__trkSetupListSearch = setup;
})();


/* PATCH v1.0.11: авто-title у кнопок действий */
(function(){
'use strict';
if (window.__trkBtnTitleDecorator) return;
window.__trkBtnTitleDecorator = true;
var TITLES = { edit: 'Редактировать', delete: 'Удалить', card: 'Карточка задачи', copy: 'Копировать', close: 'Закрыть' };
function decorate(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    scope.querySelectorAll('.dict-action-btn[data-act]').forEach(function(btn) {
        if (btn.title) return;
        var act = btn.getAttribute('data-act');
        if (TITLES[act]) btn.title = TITLES[act];
    });
}
function boot() {
    decorate(document);
    new MutationObserver(function(muts) {
        muts.forEach(function(m) {
            if (!m.addedNodes) return;
            m.addedNodes.forEach(function(n) { if (n.nodeType === 1) decorate(n); });
        });
    }).observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();


/* PATCH v1.0.12: подсветка совпадений в поиске задач */
(function(){
'use strict';
if (window.__trkSearchHighlightV112) return;
window.__trkSearchHighlightV112 = true;
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function highlightCards() {
    var inp = document.getElementById('tskSearchInput');
    var list = document.getElementById('tasksFullList');
    if (!inp || !list) return;
    var q = (inp.value || '').trim();
    list.querySelectorAll('.task-card').forEach(function(card) {
        var titleEl = card.querySelector('.task-card-title');
        if (!titleEl) return;
        if (!card._origTitleHtml) card._origTitleHtml = titleEl.innerHTML;
        if (!q) {
            if (titleEl.innerHTML !== card._origTitleHtml) titleEl.innerHTML = card._origTitleHtml;
            return;
        }
        var rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        var html = esc(titleEl.textContent || '').replace(rx, '<mark>$1</mark>');
        if (titleEl.innerHTML !== html) titleEl.innerHTML = html;
    });
}
function attachObserver() {
    var list = document.getElementById('tasksFullList');
    if (!list || list._hlV112Hooked) return;
    list._hlV112Hooked = true;
    new MutationObserver(function() {
        list.querySelectorAll('.task-card').forEach(function(c) { delete c._origTitleHtml; });
        highlightCards();
    }).observe(list, { childList: true });
}
function boot() {
    attachObserver();
    setTimeout(attachObserver, 800);
    setTimeout(attachObserver, 2000);
    var inp = document.getElementById('tskSearchInput');
    if (inp && !inp._hlV112Hooked) {
        inp._hlV112Hooked = true;
        inp.addEventListener('input', function(){ setTimeout(highlightCards, 60); });
    }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
setTimeout(boot, 1200);
window.__trkSearchHighlight = highlightCards;
})();


/* PATCH v1.0.12: переключатель компактного режима плитки задач */
(function(){
'use strict';
if (window.__trkCompactModeV112) return;
window.__trkCompactModeV112 = true;
var KEY = 'tracker_tsk_compact';
function readState() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
function writeState(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }
function ensureButton() {
    var panel = document.getElementById('panel-tasks');
    if (!panel) return;
    if (document.getElementById('tskCompactToggle')) return;
    var cols = document.getElementById('tskColsWrap');
    var anchor = cols || panel.querySelector('.sum-toolbar');
    if (!anchor) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'tskCompactToggle';
    b.className = 'btn btn-secondary tsk-compact-toggle';
    b.title = 'Компактные карточки (меньше высота)';
    b.textContent = '☰ Компактно';
    b.addEventListener('click', function() {
        var on = !readState();
        writeState(on);
        var st = window.__trkState;
        if (st) st.tskCompactMode = on;
        b.classList.toggle('active', on);
        b.textContent = on ? '☰ Компактно ✓' : '☰ Компактно';
        if (typeof window.__trkRenderTasksFull === 'function') window.__trkRenderTasksFull();
    });
    if (anchor.parentNode) anchor.parentNode.insertBefore(b, anchor.nextSibling);
    var on = readState();
    b.classList.toggle('active', on);
    b.textContent = on ? '☰ Компактно ✓' : '☰ Компактно';
}
function applyState() {
    var st = window.__trkState;
    if (st) st.tskCompactMode = readState();
}
function boot() { applyState(); ensureButton(); setTimeout(ensureButton, 800); setTimeout(ensureButton, 2000); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
document.addEventListener('click', function(e) {
    if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="tasks"]')) {
        setTimeout(ensureButton, 250);
    }
});
})();


/* ============================================================
   PATCH v1.0.17 — гарантированный рефреш списка задач после save.
   Оборачивает fetch: как только /api/tracker/task/save вернул 2xx,
   принудительно перерисовываем текущую вкладку (если это «Задачи»).
   Идемпотентно к trkRefreshAll — двойной рендер не вредит.
   ============================================================ */
(function(){
'use strict';
if (window.__trkSaveTaskRefreshHook) return;
window.__trkSaveTaskRefreshHook = true;

var _nativeFetch = window.fetch;
if (typeof _nativeFetch !== 'function') return;

window.fetch = function(url, opts) {
    var isTaskSave = (typeof url === 'string' && url.indexOf('/api/tracker/task/save') !== -1);
    var isPost = !!(opts && (opts.method || 'GET').toUpperCase() === 'POST');
    var promise = _nativeFetch.apply(this, arguments);
    if (!isTaskSave || !isPost) return promise;
    return promise.then(function(r) {
        if (r && r.ok) {
            setTimeout(function() {
                var tabBtn = document.querySelector('.tracker-tab.active');
                var tabId = tabBtn ? tabBtn.getAttribute('data-tab') : '';
                if (tabId === 'tasks' && typeof window.__trkRenderTasksFull === 'function') {
                    try { window.__trkRenderTasksFull(); } catch (e) { console.error('[save-refresh]', e); }
                }
                // PATCH v1.0.17: сразу обновляем календарь — «назначено, не начато»
                if (typeof window.__trkLoadState === 'function') {
                    try { window.__trkLoadState(); } catch (e) {}
                }
                var _cal = window.__trkRenderCalendar;
                if (typeof _cal === 'function') {
                    try { _cal(); } catch (e) { console.error('[save-refresh-cal]', e); }
                }
            }, 250);
        }
        return r;
    });
};
})();
