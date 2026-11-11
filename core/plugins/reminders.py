"""plugins/reminders.py — Умные напоминания."""
__version__ = '2.0'
__description__ = 'Напоминания по проверкам: дедлайн в ближайшие 7 дней, этапы закончились без смены статуса, начало прошло в «Планировании»'

from datetime import date, timedelta
from flask import jsonify


_JS = r'''
(function(){
'use strict';
var INTERVAL_MS = 5 * 60 * 1000;
function getBell() {
    var b = document.getElementById('trkBell');
    if (b) return b;
    var header = document.querySelector('.tracker-header');
    if (!header) return null;
    b = document.createElement('button');
    b.id = 'trkBell';
    b.type = 'button';
    b.className = 'theme-toggle-btn trk-bell';
    b.title = 'Напоминания';
    b.innerHTML = '🔔 <span class="trk-bell-cnt" id="trkBellCnt"></span>';
    b.addEventListener('click', function(e){ e.stopPropagation(); toggleDrop(); });
    var anchor = header.querySelector('.user-menu');
    if (anchor) header.insertBefore(b, anchor);
    else header.appendChild(b);
    var drop = document.createElement('div');
    drop.id = 'trkBellDrop';
    drop.className = 'trk-bell-drop';
    drop.style.display = 'none';
    document.body.appendChild(drop);
    document.addEventListener('click', function(e){
        if (e.target && e.target.closest && (e.target.closest('.trk-bell-item') || e.target.closest('#trkBell'))) return;
        drop.style.display = 'none';
    });
    return b;
}
function toggleDrop() {
    var d = document.getElementById('trkBellDrop');
    if (!d) return;
    d.style.display = (d.style.display === 'none') ? '' : 'none';
}
function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function render(items) {
    var cnt = document.getElementById('trkBellCnt');
    var drop = document.getElementById('trkBellDrop');
    var b = document.getElementById('trkBell');
    var n = items.length;
    if (cnt) cnt.textContent = n ? String(n) : '';
    if (b) b.classList.toggle('active', n > 0);
    if (!drop) return;
    if (!n) {
        drop.innerHTML = '<div class="trk-bell-empty">Напоминаний нет 👍</div>';
        return;
    }
    var html = '<div class="trk-bell-head">Напоминания (' + n + ')</div>';
    items.forEach(function(it){
        var cls = (it.kind === 'overdue' || it.kind === 'stale') ? 'trk-bell-item-overdue' : (it.kind === 'tomorrow' ? 'trk-bell-item-tomorrow' : 'trk-bell-item-today');
        var ico = it.kind === 'overdue' ? '⚠' : it.kind === 'stale' ? '🕒' : (it.kind === 'tomorrow' ? '⏰' : '🔥');
        html += '<div class="trk-bell-item ' + cls + '" data-task-id="' + _esc(it.task_id) + '" data-kind="' + _esc(it.kind) + '">';
        html += '<div class="trk-bell-ico">' + ico + '</div>';
        html += '<div class="trk-bell-body"><div class="trk-bell-name">' + _esc(it.task_name) + '</div>';
        html += '<div class="trk-bell-meta">' + _esc(it.label) + '</div></div>';
        html += '</div>';
    });
    drop.innerHTML = html;
}
function load() {
    var csrf = window.REESTR_CSRF || '';
    fetch('/api/plugins/reminders/me', {
        credentials: 'same-origin',
        headers: csrf ? {'X-CSRF-Token': csrf} : {}
    }).then(function(r){ return r.json(); }).then(function(d){
        if (!d || !d.success) return;
        render(d.items || []);
    }).catch(function(){});
}
function todayISO() {
    var st = window.__trkState;
    if (st && st.today) return st.today;
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function findMyLatestLog(taskId, dk) {
    var st = window.__trkState;
    if (!st || !st.log) return null;
    var me = st.currentUser ? (st.currentUser.employee_id || '') : '';
    if (!me) return null;
    var best = null;
    st.log.forEach(function(l) {
        if (l.task_id !== taskId) return;
        if (l.employee_id !== me) return;
        if ((l.date || '') !== dk) return;
        if (!best || (l.id || 0) > (best.id || 0)) best = l;
    });
    return best;
}
function buildLogModalEntry(rec) {
    if (!rec) return null;
    var st = window.__trkState;
    var t = (st && st.tasks) ? st.tasks.find(function(x) { return x.id === rec.task_id; }) : null;
    var e = (st && st.employees) ? st.employees.find(function(x) { return x.id === rec.employee_id; }) : null;
    return {
        id: rec.id,
        employee_id: rec.employee_id,
        employee_name: e ? e.name : '',
        task_id: rec.task_id,
        task_name: t ? t.name : '',
        task_icon: t ? (t.icon || '📋') : '📋',
        date: rec.date,
        hours: rec.hours,
        status: rec.status || 'in_progress',
        comment: rec.comment || '',
        link: rec.link || ''
    };
}
function goToTask(tid, kind) {
    if (!tid) return;
    if (typeof window.trkOpenTaskById === 'function') { window.trkOpenTaskById(tid); return; }
    var st = window.__trkState || {}, t = (st.tasks || []).find(function(x) { return String(x.id) === String(tid); });
    if (t && typeof window.trkOpenTaskSmart === 'function') window.trkOpenTaskSmart(t);
}
function boot(){
    var P = window.REESTR_PERMS || {}; if (!P['tab.tasks'] && !P['tab.calendar']) return;
    if (!getBell()) return;
    load();
    setInterval(load, INTERVAL_MS);
    document.addEventListener('click', function(e){
        var item = e.target && e.target.closest && e.target.closest('.trk-bell-item');
        if (!item) return;
        var tid = item.getAttribute('data-task-id');
        var kind = item.getAttribute('data-kind');
        var drop = document.getElementById('trkBellDrop');
        if (drop) drop.style.display = 'none';
        goToTask(tid, kind);
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ setTimeout(boot, 400); });
else setTimeout(boot, 400);
})();
'''


def register(app, db, hooks):
    print('[reminders] v' + __version__ + ' · ' + __description__)

    @app.route('/plugins-assets/reminders.js', methods=['GET'])
    def _rm_js():
        return app.response_class(_JS, mimetype='application/javascript')

    @app.route('/api/plugins/reminders/me', methods=['GET'])
    def _rm_me():
        try:
            from auth import current_user
            u = current_user(db)
        except Exception:
            u = None
        if not u:
            return jsonify({'success': False, 'error': 'auth'}), 401
        data = db.load_all()
        today_d = date.today()
        today = today_d.strftime('%Y-%m-%d')
        soon = (today_d + timedelta(days=7)).strftime('%Y-%m-%d')
        items = []
        for t in data.get('tasks', []):
            if (t.get('task_kind') or 'audit') != 'audit':
                continue
            st = t.get('status') or ''
            if st not in ('planning', 'approved', 'active'):
                continue
            dl = (t.get('deadline') or '')[:10]
            sd = (t.get('start_date') or '')[:10]
            base = {'task_id': t.get('id'), 'task_name': t.get('name') or '', 'deadline': dl}
            if dl and dl < today:
                items.append(dict(base, kind='overdue',
                                  label='Этапы закончились ' + dl[8:10] + '.' + dl[5:7] + ', статус не обновлён'))
            elif dl and dl <= soon:
                n = (date.fromisoformat(dl) - today_d).days
                items.append(dict(base, kind='today' if n <= 1 else 'tomorrow',
                                  label=('Дедлайн сегодня' if n == 0 else 'Дедлайн завтра' if n == 1 else 'Дедлайн через ' + str(n) + ' дн.')
                                  + ' · ' + dl[8:10] + '.' + dl[5:7]))
            if st == 'planning' and sd and sd < today:
                items.append(dict(base, kind='stale',
                                  label='Начало ' + sd[8:10] + '.' + sd[5:7] + ' прошло, проверка всё ещё в «Планировании»'))

        items.sort(key=lambda x: (({'overdue': 0, 'stale': 1, 'today': 2, 'tomorrow': 3}).get(x['kind'], 4), x.get('deadline') or ''))
        return jsonify({'success': True, 'items': items[:20]})

    def on_startup(**ctx):
        print('[reminders] готов — колокольчик в шапке, клик ведёт к записи')
    hooks.on('on_startup', on_startup)
