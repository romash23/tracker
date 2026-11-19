/* tracker_next/03_task_card.js — Карточка проверки: ссылки и документы, колокольчик, профиль, редактирование задачи.
   Файлы грузятся строго по порядку 00→04. Источник: static/tracker.js. */
/* ============================================================
   PATCH v1.0.19 — много ссылок в задаче
   Каждая ссылка: {url, description}. Локальные пути (\\server, C:\,
   /, file://) копируются в буфер по клику, внешние (http/https/ftp)
   открываются в новой вкладке.
   ============================================================ */
var _taskLinksDraft = [];
function _isExternalUrl(u) {
    return /^(https?|ftp):\/\//i.test(String(u || ''));
}
function _escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function renderTaskLinksDraft() {
    var box = document.getElementById('taskLinksList');
    if (!box) return;
    if (!_taskLinksDraft.length) {
        box.innerHTML = '<div class="task-links-empty">Пока нет ссылок</div>';
        return;
    }
    var h = '';
    _taskLinksDraft.forEach(function(lk, i) {
        var url = (lk && lk.url) || '';
        var desc = (lk && lk.description) || '';
        h += '<div class="task-link-row" data-i="' + i + '">'
          +  '<input type="text" class="task-link-desc" placeholder="Описание" value="' + _escapeAttr(desc) + '" maxlength="200">'
          +  '<input type="text" class="task-link-url" placeholder="https://… или \\\\server\\share\\file" value="' + _escapeAttr(url) + '" maxlength="1000">'
          +  '<button type="button" class="task-link-del" title="Удалить">×</button>'
          +  '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.task-link-row').forEach(function(row) {
        var i = parseInt(row.getAttribute('data-i'), 10);
        var dEl = row.querySelector('.task-link-desc');
        var uEl = row.querySelector('.task-link-url');
        if (dEl) dEl.addEventListener('input', function() { _taskLinksDraft[i].description = this.value; });
        if (uEl) uEl.addEventListener('input', function() { _taskLinksDraft[i].url = this.value; });
        var xb = row.querySelector('.task-link-del');
        if (xb) xb.addEventListener('click', function() {
            _taskLinksDraft.splice(i, 1);
            renderTaskLinksDraft();
        });
    });
}
(function(){
    'use strict';
    if (window.__trkTaskLinksInit) return;
    window.__trkTaskLinksInit = true;
    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#taskLinkAddBtn')) {
            e.preventDefault();
            _taskLinksDraft = _taskLinksDraft || [];
            _taskLinksDraft.push({ url: '', description: '' });
            renderTaskLinksDraft();
            var box = document.getElementById('taskLinksList');
            if (box) {
                var rows = box.querySelectorAll('.task-link-row');
                var last = rows[rows.length - 1];
                if (last) {
                    var f = last.querySelector('.task-link-desc');
                    if (f) f.focus();
                }
            }
        }
    }, true);
})();

/* Копирование/открытие ссылок в карточке задачи (в расширенной модалке) */
function _handleLinkClick(url) {
    if (!url) return;
    if (_isExternalUrl(url)) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(function() {
                if (typeof notify === 'function') notify('📋 Скопировано: ' + url);
            }, function() { _fallbackCopy(url); });
        } else {
            _fallbackCopy(url);
        }
    } catch (e) {
        _fallbackCopy(url);
    }
}
function _fallbackCopy(text) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (typeof notify === 'function') notify('📋 Скопировано: ' + text);
    } catch (e) {
        if (typeof notify === 'function') notify('❌ Не удалось скопировать', 'error');
    }
}

/* Показ ссылок в карточке задачи — подключаемся к openTaskCardModal */
(function(){
    'use strict';
    if (window.__trkTaskLinksDisplay) return;
    window.__trkTaskLinksDisplay = true;
    var _renderCards = function() {
        var list = document.getElementById('tasksFullList');
        if (!list) return;
        var st = window.__trkState || {};
        var map = {};
        (st.tasks || []).forEach(function(t) { map[t.id] = t; });
        list.querySelectorAll('.task-card').forEach(function(card) {
            var id = card.getAttribute('data-id');
            if (!id) return;
            var t = map[id];
            if (!t) return;
            var extra = card.querySelector('.task-card-extra');
            var links = Array.isArray(t.links) ? t.links : [];
            if (!links.length) return;
            if (extra) {
                var oldLinks = extra.querySelector('.txi-links-block');
                if (oldLinks) oldLinks.remove();
            } else {
                var head = card.querySelector('.task-card-head');
                if (!head) return;
                extra = document.createElement('div');
                extra.className = 'task-card-extra';
                head.parentNode.insertBefore(extra, head.nextSibling);
            }
            var blk = document.createElement('div');
            blk.className = 'txi-links-block';
            var html = '<div class="txi-links-head">🔗 ' + links.length + ' ' + (links.length === 1 ? 'ссылка' : 'ссылок') + '</div><div class="txi-links">';
            links.slice(0, 4).forEach(function(lk, i) {
                var u = (lk && lk.url) || '';
                var d = (lk && lk.description) || '';
                if (!u) return;
                var ext = _isExternalUrl(u);
                html += '<a class="txi-link" href="javascript:void(0)" data-link-url="' + _escapeAttr(u) + '" title="' + _escapeAttr(u) + '">';
                html += ext ? '🌐 ' : '📁 ';
                html += _escapeAttr(d || (u.length > 55 ? u.slice(0, 54) + '…' : u));
                html += '</a>';
            });
            if (links.length > 4) html += '<span class="txi-more">+' + (links.length - 4) + '</span>';
            html += '</div>';
            blk.innerHTML = html;
            extra.appendChild(blk);
        });
        list.querySelectorAll('.txi-link[data-link-url]').forEach(function(a) {
            if (a._linkHook) return;
            a._linkHook = true;
            a.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var u = this.getAttribute('data-link-url');
                if (u) _handleLinkClick(u);
            });
        });
    };
    function boot() {
        setTimeout(_renderCards, 400);
        setTimeout(_renderCards, 1500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    document.addEventListener('click', function(e) {
        if (e.target && e.target.closest && e.target.closest('.tracker-tab[data-tab="tasks"]')) {
            setTimeout(_renderCards, 300);
        }
    });
    window.__trkRenderTaskCardLinks = _renderCards;
})();


/* ============================================================
   PATCH v1.0.20 — колокольчик уведомлений
   ============================================================ */
(function(){
'use strict';
if (window.__trkBellV120) return;
window.__trkBellV120 = true;

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}

function _ensureDrop() {
    var d = document.getElementById('trkBellDrop');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'trkBellDrop';
    d.className = 'trk-bell-drop';
    d.style.display = 'none';
    document.body.appendChild(d);
    return d;
}

function _fmtTs(ts) {
    if (!ts) return '';
    return String(ts).slice(0, 16);
}

function _renderList(items) {
    var d = _ensureDrop();
    if (!items.length) {
        d.innerHTML = '<div class="trk-bell-head">Уведомления</div><div class="trk-bell-empty">Нет уведомлений</div>';
        return;
    }
    var _isAdmin = !!(window.__trkState && window.__trkState.currentUser && window.__trkState.currentUser.role === 'admin');
    var h = '<div class="trk-bell-head">Уведомления'
          + '<button type="button" class="trk-bell-markall" id="trkBellMarkAll">Прочитать все</button>'
          + (_isAdmin ? '<button type="button" class="trk-bell-markall trk-bell-markall--global" id="trkBellMarkAllGlobal" title="Пометить прочитанными у всех пользователей">Сбросить всем</button>' : '')
          + '</div>';
    items.forEach(function(it) {
        var status = it.status || 'new';
        var statusCls = status === 'confirmed' ? 'confirmed' : (status === 'rejected' ? 'rejected' : '');
        var _msgText = String(it.message || 'Закрыта задача');
        try {
            var _st = window.__trkState || {};
            if (_st.maskNames && typeof window.__trkMaskName === 'function') {
                var _empN = (_st.employees || []).find(function(x) { return x.id === it.employee_id; });
                if (_empN && _empN.name) {
                    var _rn = _empN.name;
                    var _mn = window.__trkMaskName(_rn);
                    if (_rn && _mn && _rn !== _mn) {
                        _msgText = _msgText.split(_rn).join(_mn);
                    }
                }
            }
        } catch (e) { console.error('[bell-mask]', e); }
        var _kind = it.kind || 'task_done';
        var _ico = (_kind === 'task_created') ? '🆕' : '✅';
        var _needConfirm = (_kind === 'task_done' && status === 'new');
        var _badge = '';
        if (status === 'confirmed') _badge = '<div class="trk-bell-badge ok">принято</div>';
        else if (status === 'rejected') _badge = '<div class="trk-bell-badge err">отклонено</div>';
        else if (status === 'info' || _kind === 'task_created') _badge = '<div class="trk-bell-badge">инфо</div>';
        h += '<div class="trk-bell-item trk-bell-item--' + _esc(_kind) + ' ' + statusCls + '" data-nid="' + it.id + '" data-tid="' + _esc(it.task_id) + '" data-kind="' + _esc(_kind) + '">'
          +   '<span class="trk-bell-ico">' + _ico + '</span>'
          +   '<div class="trk-bell-body">'
          +     '<div class="trk-bell-name">' + _esc(_msgText) + '</div>'
          +     '<div class="trk-bell-meta">' + _esc(_fmtTs(it.ts)) + (it.from_username ? ' · ' + _esc(it.from_username) : '') + '</div>'
          +     (_needConfirm ? '<div class="trk-bell-actions">'
          +         '<button type="button" class="trk-bell-act ok" data-act="accept">✓ Принять</button>'
          +         '<button type="button" class="trk-bell-act err" data-act="reject">✗ Отклонить</button>'
          +       '</div>' : _badge)
          +   '</div>'
          + '</div>';
    });
    d.innerHTML = h;

    d.querySelectorAll('.trk-bell-item').forEach(function(el) {
        var nid = parseInt(el.getAttribute('data-nid'), 10);
        var tid = el.getAttribute('data-tid');
        var nameEl = el.querySelector('.trk-bell-name');
        if (nameEl) nameEl.addEventListener('click', function() {
            if (typeof window.trkOpenTaskById === 'function' && tid) {
                window.trkOpenTaskById(tid);
            }
        });
        el.querySelectorAll('.trk-bell-act').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                var act = this.getAttribute('data-act');
                fetch('/api/notifications/action', {
                    method: 'POST',
                    headers: Object.assign({'Content-Type': 'application/json'}, window.REESTR_CSRF ? {'X-CSRF-Token': window.REESTR_CSRF} : {}),
                    credentials: 'same-origin',
                    body: JSON.stringify({ id: nid, action: act }),
                }).then(function(r) { return r.json(); }).then(function(res) {
                    if (res && res.success) {
                        refresh();
                        if (typeof window.__trkLoadState === 'function') window.__trkLoadState();
                    }
                }).catch(function(){});
            });
        });
    });
    var markAll = d.querySelector('#trkBellMarkAll');
    if (markAll) markAll.addEventListener('click', function() {
        fetch('/api/notifications/read', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, window.REESTR_CSRF ? {'X-CSRF-Token': window.REESTR_CSRF} : {}),
            credentials: 'same-origin',
            body: JSON.stringify({}),
        }).then(function() { refresh(); });
    });
    var markAllGlobal = d.querySelector('#trkBellMarkAllGlobal');
    if (markAllGlobal) markAllGlobal.addEventListener('click', function() {
        if (!confirm('Пометить ПРОЧИТАННЫМИ все уведомления у ВСЕХ пользователей?')) return;
        fetch('/api/notifications/read_all', {
            method: 'POST',
            headers: Object.assign({'Content-Type': 'application/json'}, window.REESTR_CSRF ? {'X-CSRF-Token': window.REESTR_CSRF} : {}),
            credentials: 'same-origin',
            body: JSON.stringify({}),
        }).then(function(r) { return r.json(); }).then(function(res) {
            if (res && res.success) {
                if (typeof notify === 'function') notify('✅ Сброшено: ' + (res.cleared || 0));
                refresh();
            } else if (typeof notify === 'function') {
                notify('❌ ' + ((res && res.error) || 'Ошибка'), 'error');
            }
        }).catch(function(){});
    });
}

function refresh() {
    fetch('/api/notifications', {credentials: 'same-origin'})
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d || !d.success) return;
            var cnt = document.getElementById('trkBellCount');
            var unread = d.unread || 0;
            if (cnt) {
                if (unread > 0) { cnt.style.display = ''; cnt.textContent = unread > 99 ? '99+' : String(unread); }
                else cnt.style.display = 'none';
            }
            var drop = document.getElementById('trkBellDrop');
            if (drop && drop.style.display !== 'none') {
                _renderList(d.items || []);
            } else {
                _ensureDrop();
                _renderList(d.items || []);
                var dd = document.getElementById('trkBellDrop');
                if (dd) dd.style.display = 'none';
            }
        })
        .catch(function(){});
}

function toggleDrop() {
    var d = _ensureDrop();
    if (d.style.display === 'none') {
        var bell = document.getElementById('trkBell');
        if (bell) {
            var rect = bell.getBoundingClientRect();
            d.style.right = (window.innerWidth - rect.right) + 'px';
            d.style.top = (rect.bottom + 8) + 'px';
        }
        d.style.display = '';
    } else {
        d.style.display = 'none';
    }
}

function boot() {
    var bell = document.getElementById('trkBell');
    if (!bell || bell._bellHooked) return;
    bell._bellHooked = true;
    bell.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleDrop();
    });
    document.addEventListener('click', function(e) {
        var d = document.getElementById('trkBellDrop');
        if (!d || d.style.display === 'none') return;
        if (e.target && (d.contains(e.target) || (e.target.closest && e.target.closest('#trkBell')))) return;
        d.style.display = 'none';
    });
    refresh();
    setInterval(refresh, 30000);
    window.addEventListener('focus', function(){ try { refresh(); } catch(e){} });
    document.addEventListener('visibilitychange', function(){
        if (!document.hidden) { try { refresh(); } catch(e){} }
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    setTimeout(boot, 300);
}
})();


/* ============================================================
   PATCH v1.0.22 — фиксы UI
   ============================================================ */
(function(){
'use strict';

/* --- 1. emoji-пикер поверх карточки задачи --- */
if (!window.__trkEmojiZFix) {
    window.__trkEmojiZFix = true;
    function _forceEmojiZ(m) {
        if (!m) return;
        m._zstackForeign = true;
        m.style.setProperty('z-index', '9000', 'important');
    }
    function _emojiHook() {
        var m = document.getElementById('emojiModal');
        if (!m) return;
        // Всегда помечаем как «чужой» — JS-стек v1.0.10 её не трогает
        m._zstackForeign = true;
        if (m._zfixHooked) { _forceEmojiZ(m); return; }
        m._zfixHooked = true;
        new MutationObserver(function(){
            if (m.classList.contains('active')) _forceEmojiZ(m);
        }).observe(m, { attributes: true, attributeFilter: ['class'] });
        if (m.classList.contains('active')) _forceEmojiZ(m);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _emojiHook);
    else _emojiHook();
    setTimeout(_emojiHook, 300);
    setTimeout(_emojiHook, 1000);
    setTimeout(_emojiHook, 2500);
    document.addEventListener('click', function(e){
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#taskIconPickBtn')) {
            _emojiHook();
            setTimeout(function(){
                var m = document.getElementById('emojiModal');
                if (m && m.classList.contains('active')) _forceEmojiZ(m);
            }, 30);
            setTimeout(function(){
                var m = document.getElementById('emojiModal');
                if (m && m.classList.contains('active')) _forceEmojiZ(m);
            }, 200);
        }
    }, true);
}

})();


/* --- 2. Блок ссылок на плитке задачи (отдельный контейнер) --- */
(function(){
'use strict';
if (window.__trkTaskLinksBlockV122) return;
window.__trkTaskLinksBlockV122 = true;

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function _isExt(u) { return /^(https?|ftp):\/\//i.test(String(u || '')); }

function _copy(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function(){
                if (typeof window.__trackerNotify === 'function') window.__trackerNotify('📋 Скопировано: ' + text);
            }, function(){ _fallback(text); });
        } else { _fallback(text); }
    } catch (e) { _fallback(text); }
}
function _fallback(text) {
    try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        if (typeof window.__trackerNotify === 'function') window.__trackerNotify('📋 Скопировано: ' + text);
    } catch (e) {
        if (typeof window.__trackerNotify === 'function') window.__trackerNotify('❌ Не удалось скопировать', 'error');
    }
}

function _renderLinksOnList() {
    var list = document.getElementById('tasksFullList');
    if (!list) return;
    var st = window.__trkState || {};
    var map = {};
    (st.tasks || []).forEach(function(t){ map[t.id] = t; });
    list.querySelectorAll('.task-card').forEach(function(card){
        var id = card.getAttribute('data-id');
        if (!id) return;
        var t = map[id];
        var old = card.querySelector('.task-card-links-block');
        var links = (t && Array.isArray(t.links)) ? t.links : [];
        if (!links.length) { if (old) old.remove(); return; }
        var block = old || document.createElement('div');
        block.className = 'task-card-links-block';
        var h = '<span class="tcl-label">🔗 ' + links.length + '</span>';
        links.slice(0, 3).forEach(function(lk){
            var u = (lk && lk.url) || '';
            var d = (lk && lk.description) || '';
            if (!u) return;
            var ext = _isExt(u);
            var label = d || (u.length > 40 ? u.slice(0, 39) + '…' : u);
            h += '<a class="tcl-link" href="javascript:void(0)" data-lu="' + _esc(u) + '" title="' + _esc(u) + '">'
               + (ext ? '🌐 ' : '📁 ') + _esc(label) + '</a>';
        });
        if (links.length > 3) h += '<span class="tcl-more">+' + (links.length - 3) + '</span>';
        block.innerHTML = h;
        if (!old) {
            // вставляем в самый низ карточки — после .task-card-foot или в конец
            var foot = card.querySelector('.task-card-foot');
            if (foot && foot.parentNode) foot.parentNode.insertBefore(block, foot.nextSibling);
            else card.appendChild(block);
        }
        block.querySelectorAll('.tcl-link[data-lu]').forEach(function(a){
            if (a._linkHook) return;
            a._linkHook = true;
            a.addEventListener('click', function(e){
                e.preventDefault(); e.stopPropagation();
                var u = this.getAttribute('data-lu');
                if (!u) return;
                if (_isExt(u)) window.open(u, '_blank', 'noopener,noreferrer');
                else _copy(u);
            });
        });
    });
}

// хукаем рендер списка задач
(function(){
    function _hook() {
        if (typeof window.__trkRenderTasksFull !== 'function') return;
        if (window.__trkRenderTasksFull._linksV122) return;
        var orig = window.__trkRenderTasksFull;
        var w = function(){
            var r = orig.apply(this, arguments);
            setTimeout(_renderLinksOnList, 30);
            return r;
        };
        w._linksV122 = true;
        window.__trkRenderTasksFull = w;
    }
    _hook();
    setTimeout(_hook, 500);
    setTimeout(_hook, 1500);
})();

// и наблюдаем за списком на случай прямых манипуляций
(function(){
    function _obs() {
        var list = document.getElementById('tasksFullList');
        if (!list || list._linksV122Obs) return;
        list._linksV122Obs = true;
        new MutationObserver(function(){ setTimeout(_renderLinksOnList, 40); }).observe(list, { childList: true });
        setTimeout(_renderLinksOnList, 100);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(_obs, 600); });
    else setTimeout(_obs, 600);
    setTimeout(_obs, 1500);
})();

window.__trkRenderTaskCardLinks = _renderLinksOnList;
})();


/* --- 3. Блок «🔗 Ссылки» в расширенной карточке задачи (📊) --- */
(function(){
'use strict';
if (window.__trkTaskCardLinksModalV122) return;
window.__trkTaskCardLinksModalV122 = true;

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function _isExt(u) { return /^(https?|ftp):\/\//i.test(String(u || '')); }

function _renderModal() {
    var modal = document.getElementById('taskCardModal');
    if (!modal || !modal.classList.contains('active')) return;
    var content = modal.querySelector('.modal-content');
    if (!content) return;
    var st = window.__trkState || {};
    var d = st.__lastTaskCardData;
    if (!d || !d.task) return;
    var links = Array.isArray(d.task.links) ? d.task.links : [];
    var old = document.getElementById('taskCardLinksModalBlock');
    if (old) old.remove();
    if (!links.length) return;

    var block = document.createElement('div');
    block.id = 'taskCardLinksModalBlock';
    block.className = 'tcf-links-block';
    var h = '<div class="tcf-links-title"><span>🔗</span><span>Ссылки (' + links.length + ')</span></div>';
    links.forEach(function(lk){
        var u = (lk && lk.url) || '';
        var desc = (lk && lk.description) || '';
        if (!u) return;
        var ext = _isExt(u);
        var actionLabel = ext ? '🌐 Открыть' : '📋 Копировать';
        h += '<div class="tcf-link-row" data-lu="' + _esc(u) + '">'
           +   '<span class="tcf-link-ico">' + (ext ? '🌐' : '📁') + '</span>'
           +   '<div>'
           +     (desc ? '<div class="tcf-link-desc">' + _esc(desc) + '</div>' : '')
           +     '<div class="tcf-link-url">' + _esc(u) + '</div>'
           +   '</div>'
           +   '<button type="button" class="tcf-link-action">' + actionLabel + '</button>'
           + '</div>';
    });
    block.innerHTML = h;

    // вставляем после блока «История работы» или в конце, перед actions
    var actions = content.querySelector(':scope > .modal-actions');
    if (actions && actions.parentNode === content) content.insertBefore(block, actions);
    else content.appendChild(block);

    block.querySelectorAll('.tcf-link-action').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.preventDefault(); e.stopPropagation();
            var row = this.closest('.tcf-link-row');
            var u = row ? row.getAttribute('data-lu') : '';
            if (!u) return;
            if (_isExt(u)) window.open(u, '_blank', 'noopener,noreferrer');
            else {
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(u).then(function(){
                            if (typeof window.__trackerNotify === 'function') window.__trackerNotify('📋 Скопировано: ' + u);
                        }, function(){
                            var ta = document.createElement('textarea');
                            ta.value = u; ta.style.position = 'fixed'; ta.style.left = '-9999px';
                            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                            if (typeof window.__trackerNotify === 'function') window.__trackerNotify('📋 Скопировано: ' + u);
                        });
                    }
                } catch (err) {
                    if (typeof window.__trackerNotify === 'function') window.__trackerNotify('❌ Не удалось скопировать', 'error');
                }
            }
        });
    });
}

// Хукаем открытие карточки задачи
(function(){
    function _hookOpen() {
        if (typeof window.__trkOpenTaskCardModal !== 'function') return;
        if (window.__trkOpenTaskCardModal._linksV122) return;
        var orig = window.__trkOpenTaskCardModal;
        var w = function(){
            var r = orig.apply(this, arguments);
            setTimeout(_renderModal, 200);
            setTimeout(_renderModal, 500);
            return r;
        };
        w._linksV122 = true;
        window.__trkOpenTaskCardModal = w;
    }
    _hookOpen();
    setTimeout(_hookOpen, 500);
    setTimeout(_hookOpen, 1500);
})();

// И просто наблюдаем за модалкой на случай, если патч-обёртка не сработала
setTimeout(function(){
    var modal = document.getElementById('taskCardModal');
    if (!modal) return;
    new MutationObserver(function(){
        if (modal.classList.contains('active')) {
            setTimeout(_renderModal, 200);
            setTimeout(_renderModal, 600);
        }
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}, 700);

window.__trkRenderTaskCardModalLinks = _renderModal;
})();


/* ============================================================
   PATCH v1.0.29 — гарантированно вставляем «Мой профиль»
   в выпадающее меню пользователя. Шаблонный вариант был под
   {% if current_user.employee_id %}, у admin он пустой — потому
   ссылка не отрисовывалась.
   ============================================================ */
(function(){
'use strict';
if (window.__trkMyProfileMenuV129) return;
window.__trkMyProfileMenuV129 = true;

function _ensure() {
    var dd = document.getElementById('userDropdown');
    if (!dd) return;
    if (Array.isArray(window.REESTR_PLUGINS) && window.REESTR_PLUGINS.indexOf('my_profile') < 0) return;
    if (dd.querySelector('a[href="/plugins/my_profile/"]')) return;
    var link = document.createElement('a');
    link.className = 'ud-item';
    link.href = '/plugins/my_profile/';
    link.innerHTML = '<span class="ud-icon">👤</span><span class="ud-label">Мой профиль</span>';
    dd.insertBefore(link, dd.firstChild);
    // Разделитель сразу после ссылки, если его нет
    var next = link.nextSibling;
    var hasSep = next && next.classList && next.classList.contains('ud-sep');
    if (!hasSep) {
        var sep = document.createElement('div');
        sep.className = 'ud-sep';
        dd.insertBefore(sep, link.nextSibling);
    }
}

function boot() {
    _ensure();
    setTimeout(_ensure, 400);
    setTimeout(_ensure, 1200);
    setTimeout(_ensure, 2500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// Если меню перерисовывается — вставим ещё раз
setTimeout(function(){
    var chip = document.getElementById('userChip');
    if (!chip) return;
    chip.addEventListener('click', function(){ setTimeout(_ensure, 30); });
}, 800);
})();


/* ============================================================
   PATCH v1.0.32 — приказы/распоряжения как список + перестановка блоков
   ============================================================ */
var _taskOrdersDraft = [];
/* Документы: тип записи (хранится только путь/номер/ссылка, сам файл — на общем ресурсе) */
window.TRK_DOC_TYPES = [['order','Приказ'],['directive','Распоряжение'],['sz','СЗ'],['other','Другое']];
window.trkDocType = function(o) { var t = o && o.type; return (t === 'directive' || t === 'sz' || t === 'other') ? t : 'order'; };
window.trkDocTypeLabel = function(o) { var t = window.trkDocType(o); var r = window.TRK_DOC_TYPES.find(function(x) { return x[0] === t; }); return r ? r[1] : 'Приказ'; };
window.trkDocTypeSelect = function(o, disabled) {
    var cur = window.trkDocType(o);
    return '<select class="task-order-type" title="Тип документа"' + (disabled ? ' disabled' : '') + '>'
        + window.TRK_DOC_TYPES.map(function(x) { return '<option value="' + x[0] + '"' + (x[0] === cur ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('')
        + '</select>';
};
window.trkDocBindType = function(row, arr, i) {
    var s = row.querySelector('.task-order-type');
    if (s) s.addEventListener('change', function() { if (arr && arr[i]) arr[i].type = this.value; });
};
function _isExtUrl2(u) { return /^(https?|ftp):\/\//i.test(String(u || '')); }
function _escAttr2(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function renderTaskOrdersDraft() {
    var box = document.getElementById('taskOrdersList');
    if (!box) return;
    if (!_taskOrdersDraft.length) {
        box.innerHTML = '<div class="task-links-empty">Пока нет документов</div>';
        return;
    }
    var h = '';
    _taskOrdersDraft.forEach(function(o, i) {
        var desc = (o && o.description) || '';
        var val = (o && o.value) || '';
        h += '<div class="task-link-row task-doc-row" data-i="' + i + '">'
          +  window.trkDocTypeSelect(o)
          +  '<input type="text" class="task-order-desc" placeholder="Описание (СЗ о переносе сроков)" value="' + _escAttr2(desc) + '" maxlength="200">'
          +  '<input type="text" class="task-order-val" placeholder="Номер / путь / URL" value="' + _escAttr2(val) + '" maxlength="1000">'
          +  '<button type="button" class="task-link-del" title="Удалить">×</button>'
          +  '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.task-link-row').forEach(function(row) {
        var i = parseInt(row.getAttribute('data-i'), 10);
        var dEl = row.querySelector('.task-order-desc');
        var vEl = row.querySelector('.task-order-val');
        if (dEl) dEl.addEventListener('input', function() { _taskOrdersDraft[i].description = this.value; });
        if (vEl) vEl.addEventListener('input', function() { _taskOrdersDraft[i].value = this.value; });
        window.trkDocBindType(row, _taskOrdersDraft, i);
        var xb = row.querySelector('.task-link-del');
        if (xb) xb.addEventListener('click', function() {
            _taskOrdersDraft.splice(i, 1);
            renderTaskOrdersDraft();
        });
    });
}
(function(){
    'use strict';
    if (window.__trkTaskOrdersInit) return;
    window.__trkTaskOrdersInit = true;
    document.addEventListener('click', function(e) {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#taskOrderAddBtn')) {
            e.preventDefault();
            _taskOrdersDraft = _taskOrdersDraft || [];
            _taskOrdersDraft.push({ type: 'sz', description: '', value: '' });
            renderTaskOrdersDraft();
        }
    }, true);
})();

/* Перестановка блоков в карточке задачи */
(function(){
'use strict';
if (window.__trkTaskModalReorderV132) return;
window.__trkTaskModalReorderV132 = true;
function _reorder() {
    var modal = document.getElementById('taskModal');
    if (!modal) return;
    var content = modal.querySelector('.modal-content');
    if (!content) return;

    // 1. Ссылки — под приказы (т.е. ссылки идут после ordersGroup)
    var linksGroup = document.getElementById('taskLinksGroup');
    var ordersGroup = document.getElementById('taskOrdersGroup');
    if (linksGroup && ordersGroup && ordersGroup.parentNode && linksGroup.parentNode) {
        if (linksGroup.previousElementSibling !== ordersGroup) {
            ordersGroup.parentNode.insertBefore(linksGroup, ordersGroup.nextSibling);
        }
    }

    // 2. Urgent — под блок статуса (.form-row-3)
    var urgentRow = content.querySelector('.task-urgent-row');
    var row3 = content.querySelector('.form-row-3');
    if (urgentRow && row3 && row3.nextElementSibling !== urgentRow) {
        row3.parentNode.insertBefore(urgentRow, row3.nextSibling);
    }
}
function boot() {
    var m = document.getElementById('taskModal');
    if (!m) return;
    if (m._reorderV132Hooked) { _reorder(); return; }
    m._reorderV132Hooked = true;
    new MutationObserver(function(){ if (m.classList.contains('active')) setTimeout(_reorder, 40); })
        .observe(m, { attributes: true, attributeFilter: ['class'] });
    _reorder();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
setTimeout(boot, 600);
setTimeout(boot, 1500);
setTimeout(boot, 3000);
document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#addTaskBtn') || e.target.closest('#addTaskBtn2') || e.target.closest('.task-card-clickable')) {
        setTimeout(_reorder, 120);
        setTimeout(_reorder, 400);
    }
}, true);
window.__trkReorderTaskModal = _reorder;
})();


/* ============================================================
   PATCH v1.0.40 — полный список ссылок/приказов/доп. данных
   в карточке задачи на вкладке «Задачи».
   Показываем ВСЁ, что занесено: task.links[], task.orders[],
   task.folder (по строкам). Клик по внешнему — открыть, по
   локальному — скопировать в буфер.
   Старые частичные блоки (.task-card-links-block из v1.0.22
   и .txi-ord/.txi-fold/.txi-links из v1.2.21) скрываем CSS-ом.
   ============================================================ */
(function(){
'use strict';
if (window.__trkFullTaskLinksV140) return;
window.__trkFullTaskLinksV140 = true;

function _esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function _isExt(u){ return /^(https?|ftp):\/\//i.test(String(u||'')); }

function _copy(u){
    try{
        if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(u).then(function(){
                if(typeof window.__trackerNotify==='function')window.__trackerNotify('📋 Скопировано: '+u);
            }, function(){ _fb(u); });
        } else _fb(u);
    }catch(e){ _fb(u); }
}
function _fb(u){
    try{
        var ta=document.createElement('textarea');
        ta.value=u; ta.style.position='fixed'; ta.style.left='-9999px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        if(typeof window.__trackerNotify==='function')window.__trackerNotify('📋 Скопировано: '+u);
    }catch(e){}
}

function _collect(t){
    var links = Array.isArray(t.links)
        ? t.links.filter(function(x){return x && x.url;}) : [];
    var orders = Array.isArray(t.orders)
        ? t.orders.filter(function(x){return x && (x.value || x.description);}) : [];
    var folders = String(t.folder||'').split(/\r?\n/)
        .map(function(s){return s.trim();})
        .filter(Boolean);
    return {links:links, orders:orders, folders:folders};
}

function _renderAll(){
    var list = document.getElementById('tasksFullList');
    if(!list) return;
    var st = window.__trkState || {};
    var map = {};
    (st.tasks||[]).forEach(function(t){ map[t.id]=t; });
    list.querySelectorAll('.task-card').forEach(function(card){
        var id = card.getAttribute('data-id');
        if(!id) return;
        var t = map[id];
        if(!t) return;
        var old = card.querySelector('.task-card-full-links');
        if(old) old.remove();

        var data = _collect(t);
        if(!data.links.length && !data.orders.length && !data.folders.length) return;

        var block = document.createElement('div');
        block.className = 'task-card-full-links';
        var h = '';

        // Ссылки
        if(data.links.length){
            h += '<div class="tfl-sec"><div class="tfl-head">🔗 Ссылки (' + data.links.length + ')</div>';
            data.links.forEach(function(lk){
                var u = lk.url || '';
                var d = lk.description || '';
                var ext = _isExt(u);
                h += '<div class="tfl-row" data-lu="' + _esc(u) + '" data-ext="' + (ext?'1':'0') + '">'
                   +    '<span class="tfl-ico">' + (ext?'🌐':'📁') + '</span>'
                   +    '<div class="tfl-body">'
                   +      (d ? '<div class="tfl-desc">' + _esc(d) + '</div>' : '')
                   +      '<div class="tfl-url">' + _esc(u) + '</div>'
                   +    '</div>'
                   +  '</div>';
            });
            h += '</div>';
        }

        // Приказы / распоряжения
        if(data.orders.length){
            h += '<div class="tfl-sec"><div class="tfl-head">📄 Документы (' + data.orders.length + ')</div>';
            data.orders.forEach(function(o){
                var d = o.description || '';
                var v = o.value || '';
                var ext = _isExt(v);
                h += '<div class="tfl-row" data-lu="' + _esc(v) + '" data-ext="' + (ext?'1':'0') + '">'
                   +    '<span class="tfl-ico">' + (ext?'🌐':'📄') + '</span>'
                   +    '<div class="tfl-body">'
                   +      '<div class="tfl-desc"><span class="tfl-doc-type">' + _esc(window.trkDocTypeLabel(o)) + '</span>' + _esc(d) + '</div>'
                   +      (v ? '<div class="tfl-url">' + _esc(v) + '</div>' : '')
                   +    '</div>'
                   +  '</div>';
            });
            h += '</div>';
        }

        // Дополнительные данные (бывшие «папки»)
        if(data.folders.length){
            h += '<div class="tfl-sec"><div class="tfl-head">📁 Комментарии (' + data.folders.length + ')</div>';
            data.folders.forEach(function(f){
                h += '<div class="tfl-row" data-lu="' + _esc(f) + '" data-ext="0">'
                   +    '<span class="tfl-ico">📁</span>'
                   +    '<div class="tfl-body"><div class="tfl-url">' + _esc(f) + '</div></div>'
                   +  '</div>';
            });
            h += '</div>';
        }

        block.innerHTML = h;
        var foot = card.querySelector('.task-card-foot');
        if(foot && foot.parentNode) foot.parentNode.insertBefore(block, foot.nextSibling);
        else card.appendChild(block);

        block.querySelectorAll('.tfl-row').forEach(function(row){
            if(row._hooked) return;
            row._hooked = true;
            row.addEventListener('click', function(e){
                e.preventDefault(); e.stopPropagation();
                var u = this.getAttribute('data-lu');
                var ext = this.getAttribute('data-ext') === '1';
                if(!u) return;
                if(ext){ window.open(u, '_blank', 'noopener,noreferrer'); return; }
                _copy(u);
            });
        });
    });
}

// Обёртка над __trkRenderTasksFull — вызываем перерисовку после рендера списка
(function(){
    function _hook(){
        if(typeof window.__trkRenderTasksFull !== 'function') return;
        if(window.__trkRenderTasksFull._fullLinksV140) return;
        var orig = window.__trkRenderTasksFull;
        var w = function(){
            var r = orig.apply(this, arguments);
            setTimeout(_renderAll, 40);
            return r;
        };
        w._fullLinksV140 = true;
        window.__trkRenderTasksFull = w;
    }
    _hook();
    setTimeout(_hook, 400);
    setTimeout(_hook, 1200);
})();

// Observer на сам список — на случай прямых манипуляций
(function(){
    function _obs(){
        var list = document.getElementById('tasksFullList');
        if(!list || list._fullLinksV140Obs) return;
        list._fullLinksV140Obs = true;
        new MutationObserver(function(){ setTimeout(_renderAll, 30); })
            .observe(list, {childList:true});
        setTimeout(_renderAll, 100);
    }
    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', function(){ setTimeout(_obs, 500); });
    } else setTimeout(_obs, 500);
})();

// Ручной вызов по клику на вкладку «Задачи»
document.addEventListener('click', function(e){
    if(!e.target || !e.target.closest) return;
    if(e.target.closest('.tracker-tab[data-tab="tasks"]')){
        setTimeout(_renderAll, 300);
        setTimeout(_renderAll, 700);
    }
});

window.__trkRenderFullTaskLinks = _renderAll;
})();


/* ============================================================
   PATCH v1.0.8 — карточка задачи из отметки (объединённый)
   * Динамическая кнопка «✏️ Редактировать задачу»
   * taskModal помечается «из отметки»
   * Полное заполнение полей задачи (включая orders/links/extra
     через /api/tracker/task/card, если в state.tasks их нет)
   * Кликабельные названия задач в блоке «Уже заведено за этот день»
   * Кликабельные названия задач в блоке «Назначено, но не заведено»
   ============================================================ */
(function(){
'use strict';
if (window.__trkLogTaskEditFromLogV108) return;
window.__trkLogTaskEditFromLogV108 = true;

var _savedState = null;

function _esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function _g(id){ var el = document.getElementById(id); return el ? el.value : ''; }
function _s(id, v){ var el = document.getElementById(id); if (el) el.value = (v == null ? '' : v); }

function _getHiddenTaskId(){
    var h = document.getElementById('log_task');
    return h ? (h.value || '') : '';
}
function _findTask(id){
    if (!id) return null;
    var st = window.__trkState || {};
    return (st.tasks || []).find(function(x){ return x.id === id; }) || null;
}
function _captureLogState(){
    return {
        task_id: _g('log_task'),
        task_input: _g('log_task_input'),
    };
}
function _isLogModalActive(){
    var lm = document.getElementById('logModal');
    return !!(lm && lm.classList.contains('active'));
}

/* ==========================================================
   Динамическая кнопка «➕ Новая задача» / «✏️ Редактировать»
   ========================================================== */
function _updateLogBtn(){
    var btn = document.getElementById('logCreateTaskBtn');
    if (!btn) return;
    var tid = _getHiddenTaskId();
    if (tid) {
        if ((btn.textContent || '').trim() !== '✏️ Редактировать задачу') {
            btn.textContent = '✏️ Редактировать задачу';
        }
        btn.title = 'Открыть карточку выбранной задачи';
        btn.classList.add('log-create-task-btn--edit');
    } else {
        if ((btn.textContent || '').trim() !== '➕ Новая задача') {
            btn.textContent = '➕ Новая задача';
        }
        btn.title = 'Создать новую задачу';
        btn.classList.remove('log-create-task-btn--edit');
    }
}
window.__trkUpdateLogTaskBtn = _updateLogBtn;

/* ==========================================================
   Полное заполнение формы задачи из task-объекта
   ========================================================== */
function _forceTagDraft(tags){
    tags = Array.isArray(tags) ? tags.slice() : [];
    var box = document.getElementById('taskTagsBox');
    if (!box) return;
    box.querySelectorAll('.tag-pill').forEach(function(p){ p.remove(); });
    var input = document.getElementById('task_tags_input');
    tags.forEach(function(tag, i){
        var pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.innerHTML = '#' + _esc(tag) + '<button type="button" class="tag-x" data-i="' + i + '">×</button>';
        if (input && input.parentNode === box) box.insertBefore(pill, input);
        else box.appendChild(pill);
    });
    box.querySelectorAll('.tag-x').forEach(function(b){
        b.addEventListener('click', function(){
            var idx = parseInt(this.getAttribute('data-i'), 10);
            var cur = (window.__trkCurrentTaskTags || tags).slice();
            cur.splice(idx, 1);
            window.__trkCurrentTaskTags = cur;
            _forceTagDraft(cur);
        });
    });
    window.__trkCurrentTaskTags = tags;
}

function _setCheckboxGroup(containerId, ids){
    var box = document.getElementById(containerId);
    if (!box) return;
    var set = {};
    (ids || []).forEach(function(x){ set[x] = true; });
    box.querySelectorAll('input[type="checkbox"]').forEach(function(cb){
        cb.checked = !!set[cb.value];
    });
}

function _renderOrders(items){
    var box = document.getElementById('taskOrdersList');
    if (!box) return;
    items = Array.isArray(items) ? items : [];
    if (!items.length) {
        box.innerHTML = '<div class="task-links-empty">Пока нет документов</div>';
        return;
    }
    var h = '';
    items.forEach(function(o, i){
        var desc = (o && o.description) || '';
        var val = (o && o.value) || '';
        var added = (o && o.added_by) ? (o.added_by + ((o.added_at)? ' · '+o.added_at : '')) : '';
        h += '<div class="task-link-row task-doc-row" data-i="' + i + '" data-v108-owned="1">'
          +   window.trkDocTypeSelect(o)
          +   '<input type="text" class="task-order-desc" value="' + _esc(desc) + '" placeholder="Описание">'
          +   '<input type="text" class="task-order-val" value="' + _esc(val) + '" placeholder="Номер / путь">'
          +   '<button type="button" class="task-link-del" title="Удалить">×</button>'
          +   (added ? '<div class="task-link-added-by">✍️ ' + _esc(added) + '</div>' : '')
          + '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.task-link-row').forEach(function(row){
        var i = parseInt(row.getAttribute('data-i'), 10);
        var d = row.querySelector('.task-order-desc');
        var v = row.querySelector('.task-order-val');
        if (d) d.addEventListener('input', function(){ if (window._taskOrdersDraft && window._taskOrdersDraft[i]) window._taskOrdersDraft[i].description = this.value; });
        if (v) v.addEventListener('input', function(){ if (window._taskOrdersDraft && window._taskOrdersDraft[i]) window._taskOrdersDraft[i].value = this.value; });
        window.trkDocBindType(row, window._taskOrdersDraft, i);
        var xb = row.querySelector('.task-link-del');
        if (xb) xb.addEventListener('click', function(){
            if (Array.isArray(window._taskOrdersDraft)) window._taskOrdersDraft.splice(i, 1);
            _renderOrders(window._taskOrdersDraft || []);
        });
    });
}

function _renderLinks(items){
    var box = document.getElementById('taskLinksList');
    if (!box) return;
    items = Array.isArray(items) ? items : [];
    if (!items.length) {
        box.innerHTML = '<div class="task-links-empty">Пока нет ссылок</div>';
        return;
    }
    var h = '';
    items.forEach(function(l, i){
        var desc = (l && l.description) || '';
        var u = (l && l.url) || '';
        var added = (l && l.added_by) ? (l.added_by + ((l.added_at)? ' · '+l.added_at : '')) : '';
        h += '<div class="task-link-row" data-i="' + i + '" data-v108-owned="1">'
          +   '<input type="text" class="task-link-desc" value="' + _esc(desc) + '" placeholder="Описание">'
          +   '<input type="text" class="task-link-url" value="' + _esc(u) + '" placeholder="https://… или \\\\server\\share">'
          +   '<button type="button" class="task-link-del" title="Удалить">×</button>'
          +   (added ? '<div class="task-link-added-by">✍️ ' + _esc(added) + '</div>' : '')
          + '</div>';
    });
    box.innerHTML = h;
    box.querySelectorAll('.task-link-row').forEach(function(row){
        var i = parseInt(row.getAttribute('data-i'), 10);
        var d = row.querySelector('.task-link-desc');
        var u = row.querySelector('.task-link-url');
        if (d) d.addEventListener('input', function(){ if (window._taskLinksDraft && window._taskLinksDraft[i]) window._taskLinksDraft[i].description = this.value; });
        if (u) u.addEventListener('input', function(){ if (window._taskLinksDraft && window._taskLinksDraft[i]) window._taskLinksDraft[i].url = this.value; });
        var xb = row.querySelector('.task-link-del');
        if (xb) xb.addEventListener('click', function(){
            if (Array.isArray(window._taskLinksDraft)) window._taskLinksDraft.splice(i, 1);
            _renderLinks(window._taskLinksDraft || []);
        });
    });
}

/* PATCH task-lock: единая точка — блокировка полей и кнопки Продлить/История.
   Вызывается и из openTaskModal (клик по карточке), и из _fillTaskModal. */
window.trkApplyTaskLockState = function(task){
    task = task || {};
    var hasId = !!task.id;
    var isOverride = hasId && window.__trkTaskEditOverride && String(window.__trkTaskEditOverride) === String(task.id);
    var isPlanning = !hasId || !task.status || task.status === 'planning' || !!isOverride;
    var canExtend = hasId && task.status === 'active';
    var extendBtn = document.getElementById('taskExtendBtn');
    var histBtn = document.getElementById('taskDatesHistoryBtn');
    if (extendBtn) {
        extendBtn.style.display = hasId ? 'inline-flex' : 'none';
        extendBtn.disabled = !canExtend;
        extendBtn.title = canExtend ? 'Продлить проверку' : 'Продлить можно только проверку в статусе «Активна»';
        extendBtn.style.opacity = canExtend ? '' : '0.5';
    }
    if (histBtn) histBtn.style.display = hasId ? 'inline-flex' : 'none';
    var lockHint = isPlanning ? '' : 'Редактирование закрыто: проверка не в статусе «Планирование»' + (canExtend ? '. Для сдвига сроков используйте ⏳ в карточке просмотра' : '');
    ['task_name', 'task_description', 'task_folder', 'task_curator', 'task_type', 'task_pocket', 'task_start_date', 'task_deadline', 'task_load_coef', 'task_lead_department', 'task_lead_employee'].forEach(function(fid){
        var el = document.getElementById(fid);
        if (!el) return;
        el.disabled = !isPlanning;
        if (lockHint) el.title = lockHint; else el.removeAttribute('title');
    });
    setTimeout(function(){
        document.querySelectorAll('#taskStagesList input').forEach(function(el){ el.disabled = !isPlanning; });
    }, 100);
};

function _fillTaskModal(task){
    if (!task) return;

    _s('task_id', task.id || '');
    _s('task_name', task.name || '');
    var icon = window.trkQuarterValue(task.icon);
    window.trkEnsureQuarterOption(icon);
    _s('task_icon', icon);
    var prev = document.getElementById('taskIconPreview');
    if (prev) prev.textContent = icon;
    _s('task_description', task.description || '');
    _s('task_folder', task.folder || '');
    _s('task_curator', task.curator || '');
    _s('task_status', task.status || 'planning');
    _s('task_start_date', task.start_date || '');
    _s('task_deadline', task.deadline || '');
    
    _s('task_completed_at', task.completed_at || '');
    
    window.trkApplyTaskLockState(task);

    var urg = document.getElementById('task_is_urgent');
    if (urg) urg.checked = !!task.is_urgent;

    _forceTagDraft(task.tags || []);

    _setCheckboxGroup('taskDepartmentsList', task.department_ids || []);
    _setCheckboxGroup('taskAssigneesList', task.assignees || []);

    window._taskOrdersDraft = (task.orders || []).slice();
    _renderOrders(window._taskOrdersDraft);

    window._taskLinksDraft = (task.links || []).slice();
    _renderLinks(window._taskLinksDraft);
}
window.__trkFillTaskModalAll = _fillTaskModal;

function _ensureFullTask(task){
    if (!task || !task.id) return Promise.resolve(task);
    var hasOrders = Array.isArray(task.orders) && task.orders.length;
    var hasLinks = Array.isArray(task.links) && task.links.length;
    var hasExtraMeta = Array.isArray(task.extra_meta) && task.extra_meta.length;
    if (hasOrders && hasLinks && hasExtraMeta) return Promise.resolve(task);
    if (task._fullFetched) return Promise.resolve(task);
    task._fullFetched = true;
    var from = (document.getElementById('sumDateFrom') || {}).value || '';
    var to = (document.getElementById('sumDateTo') || {}).value || '';
    if (!from || !to) {
        var d = new Date();
        var y = d.getFullYear(), m = d.getMonth() + 1;
        var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
        from = y + '-' + pad(m) + '-01';
        to   = y + '-' + pad(m) + '-' + pad(new Date(y, m, 0).getDate());
    }
    var url = '/api/tracker/task/card?task=' + encodeURIComponent(task.id)
            + '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    var hdrs = {};
    if (window.REESTR_CSRF) hdrs['X-CSRF-Token'] = window.REESTR_CSRF;
    return fetch(url, {credentials: 'same-origin', headers: hdrs})
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (d && d.success && d.task) {
                var ft = d.task;
                if (!Array.isArray(task.orders) || !task.orders.length) task.orders = ft.orders || [];
                if (!Array.isArray(task.links) || !task.links.length) task.links = ft.links || [];
                if (!task.folder && ft.folder) task.folder = ft.folder;
                if (!task.extra_meta && ft.extra_meta) task.extra_meta = ft.extra_meta;
                // Доп.данные могут прийти строками через task.folder
                if (ft.extra && Array.isArray(ft.extra) && ft.extra.length && !task.folder) {
                    task.folder = ft.extra.map(function(x){ return x.line || x; }).join('\n');
                }
            }
            return task;
        })
        .catch(function(){ return task; });
}

/* ==========================================================
   Обёртка openTaskModal
   ========================================================== */
(function _wrapOpenTaskModal(){
    var orig = window.__trkOpenTaskModal;
    if (typeof orig !== 'function' || orig._v108w) return;
    var w = function(t){
        var isFromLog = false;
        if (!t) {
            var tid = _getHiddenTaskId();
            if (tid) {
                var task = _findTask(tid);
                if (task) { t = task; isFromLog = true; }
            }
        } else if (_isLogModalActive()) {
            isFromLog = true;
        }
        if (isFromLog) {
            _savedState = _captureLogState();
            _markTaskModalFromLog();
            setTimeout(function(){
                var lm = document.getElementById('logModal');
                if (lm && !lm.classList.contains('active')) lm.classList.add('active');
            }, 30);
        }
        var r = orig.call(this, t);
        if (t && t.id) {
            var _fillAll = function(){
                _ensureFullTask(t).then(function(ft){
                    _fillTaskModal(ft);
                    var idField = document.getElementById('task_id');
                    if (idField && !idField.value) idField.value = t.id;
                });
            };
            setTimeout(_fillAll, 30);
            setTimeout(_fillAll, 150);
            setTimeout(_fillAll, 450);
            setTimeout(_fillAll, 900);
        }
        return r;
    };
    w._v108w = true;
    window.__trkOpenTaskModal = w;
})();
setTimeout(function(){
    var o = window.__trkOpenTaskModal;
    if (typeof o === 'function' && !o._v108w) {
        var w = function(t){
            var isFromLog = false;
            if (!t) {
                var tid = _getHiddenTaskId();
                if (tid) { var task = _findTask(tid); if (task){ t = task; isFromLog = true; } }
            } else if (_isLogModalActive()) isFromLog = true;
            if (isFromLog) {
                _savedState = _captureLogState();
                _markTaskModalFromLog();
                setTimeout(function(){
                    var lm = document.getElementById('logModal');
                    if (lm && !lm.classList.contains('active')) lm.classList.add('active');
                }, 30);
            }
            var r = o.call(this, t);
            if (t && t.id) {
                var _fillAll = function(){ _ensureFullTask(t).then(function(ft){ _fillTaskModal(ft); }); };
                setTimeout(_fillAll, 30);
                setTimeout(_fillAll, 200);
                setTimeout(_fillAll, 600);
            }
            return r;
        };
        w._v108w = true;
        window.__trkOpenTaskModal = w;
    }
}, 800);

/* ==========================================================
   Обёртка openLogModal (восстанавливаем поля после v1.0.7)
   ========================================================== */
(function _wrapOpenLogModal(){
    var orig = window.__trkOpenLogModal;
    if (typeof orig !== 'function' || orig._v108l) return;
    var w = function(entry){
        var r = orig.apply(this, arguments);
        var tid = entry && (entry.task_id || entry.taskId);
        if (tid) {
            setTimeout(function(){
                var inp = document.getElementById('log_task_input');
                var hid = document.getElementById('log_task');
                var t = _findTask(tid);
                if (t) {
                    var nm = t.name || '';
                    if (t.status === 'done' || t.status === 'archived') nm += ' (архив)';
                    if (inp) inp.value = nm;
                    if (hid) hid.value = t.id;
                } else if (hid) hid.value = tid;
                _updateLogBtn();
            }, 250);
            setTimeout(_updateLogBtn, 600);
        }
        return r;
    };
    w._v108l = true;
    window.__trkOpenLogModal = w;
})();

/* ==========================================================
   Маркер taskModal
   ========================================================== */
function _addBadge(){
    var tm = document.getElementById('taskModal');
    if (!tm || !tm.classList.contains('task-modal-from-log')) return;
    var h2 = tm.querySelector('.modal-content > h2');
    if (!h2) return;
    if (h2.querySelector('.task-modal-from-log-badge')) return;
    var b = document.createElement('span');
    b.className = 'task-modal-from-log-badge';
    b.textContent = 'из отметки';
    h2.appendChild(b);
}
function _markTaskModalFromLog(){
    var tm = document.getElementById('taskModal');
    if (!tm) return;
    tm.classList.add('task-modal-from-log');
    setTimeout(_addBadge, 30);
    setTimeout(_addBadge, 150);
    setTimeout(_addBadge, 400);
}
function _unmarkTaskModal(){
    var tm = document.getElementById('taskModal');
    if (!tm) return;
    tm.classList.remove('task-modal-from-log');
    var b = tm.querySelector('.task-modal-from-log-badge');
    if (b) b.remove();
}

/* ==========================================================
   Наблюдение за закрытием taskModal
   ========================================================== */
(function _watchClose(){
    function _attach(){
        var tm = document.getElementById('taskModal');
        if (!tm || tm._v108Close) return;
        tm._v108Close = true;
        var wasActive = tm.classList.contains('active');
        new MutationObserver(function(){
            var isActive = tm.classList.contains('active');
            if (wasActive && !isActive) {
                var wasFromLog = tm.classList.contains('task-modal-from-log');
                _unmarkTaskModal();
                if (wasFromLog && _savedState) {
                    var s = _savedState;
                    _savedState = null;
                    setTimeout(function(){ _restoreLogTask(s); }, 100);
                    setTimeout(function(){ _restoreLogTask(s); }, 350);
                    setTimeout(function(){ _restoreLogTask(s); }, 800);
                }
            }
            wasActive = isActive;
        }).observe(tm, { attributes: true, attributeFilter: ['class'] });
    }
    _attach();
    setTimeout(_attach, 600);
    setTimeout(_attach, 1500);
})();

function _restoreLogTask(s){
    if (!s) return;
    var lm = document.getElementById('logModal');
    if (lm && !lm.classList.contains('active')) lm.classList.add('active');
    var inp = document.getElementById('log_task_input');
    var hid = document.getElementById('log_task');
    var t = _findTask(s.task_id);
    var nm = s.task_input;
    if (t) {
        nm = t.name || '';
        if (t.status === 'done' || t.status === 'archived') nm += ' (архив)';
    }
    if (inp) inp.value = nm || '';
    if (hid) hid.value = s.task_id || '';
    _updateLogBtn();
}

/* ==========================================================
   Кликабельные названия задач
   ========================================================== */
function _openTaskCard(taskId){
    if (!taskId) return;
    var task = _findTask(taskId);
    if (!task) return;
    if (typeof window.__trkOpenTaskModal === 'function') {
        window.__trkOpenTaskModal(task);
    }
}

// «Уже заведено за этот день»
function _decorateDayExisting(){
    var list = document.getElementById('logDayExistingList');
    if (!list) return;
    list.querySelectorAll('.day-entry').forEach(function(entryEl){
        var taskEl = entryEl.querySelector('.day-entry-task');
        if (!taskEl || taskEl._v108Deco) return;
        taskEl._v108Deco = true;
        taskEl.classList.add('clickable');
        taskEl.title = 'Открыть карточку задачи';
        if (!taskEl.querySelector('.task-title-open')) {
            var ic = document.createElement('span');
            ic.className = 'task-title-open';
            ic.textContent = '↗';
            taskEl.appendChild(ic);
        }
    });
}
(function _observeDayExisting(){
    function _attach(){
        var list = document.getElementById('logDayExistingList');
        if (!list || list._v108DecoObs) return;
        list._v108DecoObs = true;
        new MutationObserver(function(){ setTimeout(_decorateDayExisting, 40); })
            .observe(list, { childList: true, subtree: true });
        _decorateDayExisting();
    }
    _attach();
    setTimeout(_attach, 500);
    setTimeout(_attach, 1500);
})();

document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var taskEl = e.target.closest('#logDayExistingList .day-entry-task.clickable');
    if (!taskEl) return;
    if (e.target.closest('button')) return;
    var entryEl = taskEl.closest('.day-entry');
    if (!entryEl) return;
    var logId = entryEl.getAttribute('data-id');
    if (!logId) return;
    var st = window.__trkState || {};
    var logRec = (st.log || []).find(function(l){ return String(l.id) === String(logId); });
    var taskId = logRec ? logRec.task_id : '';
    if (!taskId && st.calendar && st.calendar.days) {
        for (var i = 0; i < st.calendar.days.length; i++) {
            var day = st.calendar.days[i];
            if (!day.entries) continue;
            var found = day.entries.find(function(en){ return String(en.id) === String(logId); });
            if (found) { taskId = found.task_id; break; }
        }
    }
    if (!taskId) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    _openTaskCard(taskId);
}, true);

// «Назначено, но не заведено»
(function _decorateLabTileNames(){
    function _mark(){
        var tiles = document.querySelectorAll('#logModal .log-assigned-block .lab-tile');
        tiles.forEach(function(tile){
            var nm = tile.querySelector('.lab-name');
            if (!nm || nm._v108Clickable) return;
            nm._v108Clickable = true;
            nm.style.cursor = 'pointer';
            nm.title = 'Открыть карточку задачи';
        });
    }
    function _attach(){
        var lm = document.getElementById('logModal');
        if (!lm || lm._v108LabTileObs) return;
        lm._v108LabTileObs = true;
        new MutationObserver(function(){ setTimeout(_mark, 40); })
            .observe(lm, { childList: true, subtree: true });
        _mark();
    }
    _attach();
    setTimeout(_attach, 700);
    setTimeout(_attach, 1800);
})();

document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    var nm = e.target.closest('#logModal .log-assigned-block .lab-tile .lab-name');
    if (!nm) return;
    if (e.target.closest('.lab-add')) return;
    var tile = nm.closest('.lab-tile');
    if (!tile) return;
    var tid = tile.getAttribute('data-task-id');
    if (!tid) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    _openTaskCard(tid);
}, true);

/* ==========================================================
   Кнопка #logCreateTaskBtn — динамика
   ========================================================== */
(function _hookInput(){
    function _attach(){
        var inp = document.getElementById('log_task_input');
        if (inp && !inp._v108Hook) {
            inp._v108Hook = true;
            inp.addEventListener('input', _updateLogBtn);
            inp.addEventListener('change', _updateLogBtn);
        }
    }
    _attach();
    setTimeout(_attach, 400);
    setTimeout(_attach, 1200);
})();

document.addEventListener('mousedown', function(e){
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#log_task_dropdown .ltd-item')) {
        setTimeout(_updateLogBtn, 50);
        setTimeout(_updateLogBtn, 250);
    }
}, true);

(function _watchLogActive(){
    function _attach(){
        var lm = document.getElementById('logModal');
        if (!lm || lm._v108BtnWatch) return;
        lm._v108BtnWatch = true;
        new MutationObserver(function(){
            if (lm.classList.contains('active')) {
                setTimeout(_updateLogBtn, 50);
                setTimeout(_updateLogBtn, 250);
                setTimeout(_updateLogBtn, 600);
                setTimeout(_decorateDayExisting, 120);
                setTimeout(_decorateDayExisting, 350);
            }
        }).observe(lm, { attributes: true, attributeFilter: ['class'] });
    }
    _attach();
    setTimeout(_attach, 500);
    setTimeout(_attach, 1500);
})();

window.__trkLogTaskEditFromLog = {
    updateButton: _updateLogBtn,
    restore: _restoreLogTask,
    fill: _fillTaskModal,
};
})();


/* ============================================================
   PATCH v1.0.21 — карточка задачи из календаря
   -------------------------------------------------------------
   1. При редактировании из отметки (dayModal → taskModal):
      v1.0.4 merge_log_data_into_task уже отработал, но пишет
      технические строки. Дополнительно клеймим в описание
      дату/автора через merge_extras в log/save.
   2. Кнопка «Сохранить» в taskModal отключает повторный
      показ «Выполняется/Завершено».
   ============================================================ */
(function(){
'use strict';
if (window.__trkEditTaskFromDayV1021) return;
window.__trkEditTaskFromDayV1021 = true;

// 1. Запрет повторных оверлеев поверх taskModal при сохранении задачи
(function _taskModalOverlay(){
    function _attach(){
        var tm = document.getElementById('taskModal');
        if (!tm || tm._v1021Saved) return;
        tm._v1021Saved = true;
        var saveBtn = document.getElementById('saveTaskBtn');
        if (!saveBtn) return;
        // Скрываем любые оверлеи v1.0.11/13 при начале сохранения
        saveBtn.addEventListener('click', function(){
            document.querySelectorAll('.addme-overlay').forEach(function(ov){ ov.remove(); });
            document.querySelectorAll('.modal-content.addme-blocked').forEach(function(el){
                el.classList.remove('addme-blocked');
            });
        }, true);
    }
    _attach();
    setTimeout(_attach, 600);
    setTimeout(_attach, 1500);
})();

// 2. Обёртка openTaskModal: если модалка открывается по задаче,
//    в которой уже есть описание/приказы/ссылки из отметок —
//    прокидываем признак «из отметки», чтобы saveTask дописал merge
(function _wrapOpenTaskModal(){
    function _apply(){
        if (typeof window.__trkOpenTaskModal !== 'function') return;
        if (window.__trkOpenTaskModal._v1021) return;
        var orig = window.__trkOpenTaskModal;
        var wrapped = function(task){
            var r = orig.apply(this, arguments);
            // Помечаем модалку, если она открыта из карточки дня/отметки
            var dm = document.getElementById('dayModal');
            var lm = document.getElementById('logModal');
            if ((dm && dm.classList.contains('active')) ||
                (lm && lm.classList.contains('active'))) {
                var tm = document.getElementById('taskModal');
                if (tm) tm.setAttribute('data-from-day-log', '1');
            }
            return r;
        };
        wrapped._v1021 = true;
        window.__trkOpenTaskModal = wrapped;
    }
    _apply();
    setTimeout(_apply, 500);
    setTimeout(_apply, 1500);
})();

// 3. На сохранение задачи — прокидываем merge_extras, если модалка
//    была открыта из отметки/карточки дня
(function _wrapSaveTask(){
    function _apply(){
        var saveBtn = document.getElementById('saveTaskBtn');
        if (!saveBtn || saveBtn._v1021) return;
        saveBtn._v1021 = true;
        saveBtn.addEventListener('click', function(){
            var tm = document.getElementById('taskModal');
            if (!tm) return;
            if (tm.getAttribute('data-from-day-log') === '1') {
                window.__trkTaskMergeFromDay = true;
                setTimeout(function(){ window.__trkTaskMergeFromDay = false; }, 5000);
            }
        }, true);
    }
    _apply();
    setTimeout(_apply, 800);
    setTimeout(_apply, 1800);
})();

// 4. Обёртка fetch на /api/tracker/task/save — если mergeFromDay,
//    добавляем merge_extras=1 (бэкенд v1.0.4/v1.0.21 сам запишет
//    человеческое «Обновлено <кто> <когда>» в описание)
var _native = window.fetch;
if (typeof _native === 'function' && !window.__trkTaskSaveMergeFetch) {
    window.__trkTaskSaveMergeFetch = true;
    window.fetch = function(url, opts){
        var isSave = (typeof url === 'string' && url.indexOf('/api/tracker/task/save') !== -1);
        var isPost = opts && (opts.method || 'GET').toUpperCase() === 'POST';
        if (!isSave || !isPost) return _native.apply(this, arguments);
        if (!window.__trkTaskMergeFromDay) return _native.apply(this, arguments);
        var _opts = opts;
        try {
            var b = JSON.parse(opts.body || '{}');
            b.merge_extras = 1;
            _opts = Object.assign({}, opts, { body: JSON.stringify(b) });
        } catch(e) {}
        return _native.call(this, url, _opts);
    };
}

window.__trkEditTaskFromDay = true;
})();

/* ============================================================
   PATCH 1.0.9 — переключатель вида задач (Плитка/Компактно/Список)
   Удаляет старую кнопку #tskCompactToggle от v1.0.12.
   ============================================================ */
(function(){
'use strict';
if (window.__trkTaskViewV109) return;
window.__trkTaskViewV109 = true;

var KEY = 'tracker_tsk_view2';
var COLS_KEY = 'tracker_tsk_cols';

function _read(){
    try {
        var v = localStorage.getItem(KEY);
        if (v === 'tile') return 'tile';
    } catch(e){}
    return 'list';
}
function _write(v){
    try { localStorage.setItem(KEY, v); } catch(e){}
    try { localStorage.setItem('tracker_tsk_compact', v === 'compact' ? '1' : '0'); } catch(e){}
}
function _readCols(){
    try {
        var n = parseInt(localStorage.getItem(COLS_KEY), 10);
        if (n >= 1 && n <= 5) return n;
    } catch(e){}
    return 3;
}
function _writeCols(n){
    try { localStorage.setItem(COLS_KEY, String(n)); } catch(e){}
}

function _removeOldBtn(){
    var old = document.getElementById('tskCompactToggle');
    if (old && old.parentNode) old.parentNode.removeChild(old);
}

function _apply(){
    var st = window.__trkState;
    if (!st) return;
    st.tskView = _read();
    st.tskCompactMode = (st.tskView === 'compact');
    st.tskGridCols = _readCols();
    var seg = document.getElementById('tskViewSeg');
    if (seg) {
        seg.querySelectorAll('button').forEach(function(b){
            b.classList.toggle('active', b.getAttribute('data-view') === st.tskView);
        });
    }
    var colsSel = document.getElementById('tskGridCols');
    if (colsSel && String(colsSel.value) !== String(st.tskGridCols)) {
        colsSel.value = String(st.tskGridCols);
    }
    if (typeof window.__trkRenderTasksFull === 'function') {
        try { window.__trkRenderTasksFull(); } catch(e){}
    }
}

function _wire(){
    _removeOldBtn();
    var seg = document.getElementById('tskViewSeg');
    if (seg && !seg._v109Wired) {
        seg._v109Wired = true;
        seg.addEventListener('click', function(e){
            var b = e.target.closest('button[data-view]');
            if (!b) return;
            var v = b.getAttribute('data-view');
            if (v !== 'list') v = 'tile';
            _write(v);
            _apply();
        });
    }
    var colsSel = document.getElementById('tskGridCols');
    if (colsSel && !colsSel._v109ColsWired) {
        colsSel._v109ColsWired = true;
        colsSel.addEventListener('change', function(){
            var n = parseInt(this.value, 10) || 3;
            if (n < 1) n = 1;
            if (n > 5) n = 5;
            _writeCols(n);
            var st = window.__trkState;
            if (st) st.tskGridCols = n;
            if (typeof window.__trkRenderTasksFull === 'function') {
                try { window.__trkRenderTasksFull(); } catch(e){}
            }
        });
    }
    _apply();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_wire, 400); });
} else {
    setTimeout(_wire, 400);
}
setTimeout(_wire, 1200);
setTimeout(_wire, 2500);
setTimeout(_removeOldBtn, 3000);

document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.tracker-tab[data-tab="tasks"]')) {
        setTimeout(function(){
            _removeOldBtn();
            _wire();
        }, 250);
    }
});

window.__trkTaskView = {
    get: _read,
    set: function(v){ _write(v); _apply(); },
    apply: _apply
};

})();

/* ============================================================
   PATCH 1.0.19 — merge-чекбоксы во всех видах
   Плитка / Компактно: .task-card (справа сверху)
   Список: .dict-item (слева, с отступом)
   ============================================================ */
(function(){
'use strict';
if (window.__trkMergeFixV1019) return;
window.__trkMergeFixV1019 = true;

function _hasCb(card){
    return !!(card && card.querySelector('.task-merge-cb'));
}
/* PATCH merge-cb-slot: чекбокс переносится в блок действий (рядом с 🗑),
   чтобы не наезжал на текст и не нажимался случайно при клике по карточке */
function _placeCb(card){
    var cb = card.querySelector('.task-merge-cb');
    if (!cb) return;
    var slot = card.querySelector('.task-card-actions') || card.querySelector('.dict-actions');
    if (!slot) {
        slot = document.createElement('div');
        slot.className = card.classList.contains('task-card') ? 'task-card-actions' : 'dict-actions';
        card.appendChild(slot);
    }
    if (cb.parentNode !== slot) slot.insertBefore(cb, slot.firstChild);
    if (!cb.classList.contains('task-merge-cb--slot')) cb.classList.add('task-merge-cb--slot');
}

function _selectedIds(){
    var out = [];
    document.querySelectorAll('#tasksFullList .task-merge-cb:checked').forEach(function(cb){
        var id = cb.getAttribute('data-task-id');
        if (id) out.push(id);
    });
    return out;
}

function _updateBar(){
    var bar = document.getElementById('taskMergeBar');
    if (!bar) return;
    var n = _selectedIds().length;
    bar.style.display = n >= 2 ? '' : 'none';
    var c = document.getElementById('taskMergeCount');
    if (c) c.textContent = n;
}

function _attach(card){
    if (!card) return;
    if (_hasCb(card)) return;
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
        _updateBar();
    });
    card.insertBefore(cb, card.firstChild);
}

function _scan(){
    var list = document.getElementById('tasksFullList');
    if (!list) return;
    // Плитка и компактно
    list.querySelectorAll('.task-card').forEach(_attach);
    // Список
    list.querySelectorAll('.dict-item').forEach(_attach);
    list.querySelectorAll('.task-card, .dict-item').forEach(_placeCb);
    _updateBar();
}

function _ensureBar(){
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
    document.getElementById('taskMergeBtn').addEventListener('click', function(){
        if (typeof window.__trkTaskMergeOpen === 'function') {
            try { window.__trkTaskMergeOpen(); return; } catch(e){ console.error('[merge-fix]', e); }
        }
        var ids = _selectedIds();
        if (ids.length < 2) { alert('Выберите минимум 2 задачи'); return; }
        alert('Модуль объединения не инициализирован. Обновите страницу (Ctrl+F5).');
    });
    document.getElementById('taskMergeClear').addEventListener('click', function(){
        document.querySelectorAll('#tasksFullList .task-merge-cb:checked').forEach(function(cb){ cb.checked = false; });
        document.querySelectorAll('#tasksFullList .task-card--merge-selected').forEach(function(c){ c.classList.remove('task-card--merge-selected'); });
        _updateBar();
    });
}

function _hookList(){
    var list = document.getElementById('tasksFullList');
    if (!list || list._mergeFixHooked) return;
    list._mergeFixHooked = true;
    new MutationObserver(function(){ setTimeout(_scan, 30); })
        .observe(list, { childList: true });
    _scan();
}

function _boot(){
    _ensureBar();
    _hookList();
    _scan();
    setTimeout(function(){ _ensureBar(); _hookList(); _scan(); }, 500);
    setTimeout(function(){ _ensureBar(); _hookList(); _scan(); }, 1500);
    setTimeout(function(){ _ensureBar(); _hookList(); _scan(); }, 3000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
} else {
    _boot();
}

document.addEventListener('click', function(e){
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('.tracker-tab[data-tab="tasks"]')) {
        setTimeout(function(){ _ensureBar(); _hookList(); _scan(); }, 250);
    }
    if (e.target.closest('#tskViewSeg button')) {
        setTimeout(_scan, 100);
        setTimeout(_scan, 400);
    }
});

window.__trkMergeFixScan = _scan;
})();
