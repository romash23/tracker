"""plugins/weekly_report.py — недельный HTML-отчёт по проверкам (срез по задачам, как «Недельный срез» в «Своде»)."""
__version__ = '2.0'
__description__ = 'Недельный отчёт по проверкам: HTML в share/reports/ (краткая строка + раскрытие), планировщик + ручной запуск'

import json
import re
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from flask import request, jsonify, Response, redirect, send_file

CFG = Path(__file__).parent / 'weekly_report.json'
DEFAULTS = {'enabled': True, 'weekday': 4, 'hour': 18, 'keep': 26, 'first_run_after_seconds': 120}


def _cfg():
    if not CFG.exists():
        CFG.write_text(json.dumps(DEFAULTS, ensure_ascii=False, indent=2), encoding='utf-8')
        return dict(DEFAULTS)
    try:
        c = dict(DEFAULTS)
        c.update(json.loads(CFG.read_text(encoding='utf-8')) or {})
        return c
    except Exception:
        return dict(DEFAULTS)


def _reports_dir(base):
    d = Path(base) / 'share' / 'reports'
    d.mkdir(parents=True, exist_ok=True)
    return d


_SVOD = None


def _svod():
    """Чистые функции плагина «Свод» (svod_compute, _server_problems, _STATUS) без повторной регистрации маршрутов."""
    global _SVOD
    if _SVOD is None:
        import importlib.util
        spec = importlib.util.spec_from_file_location('weekly_report_svod_fn', str(Path(__file__).parent / 'svod.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _SVOD = mod
    return _SVOD


def _slice_compute(S, data, audit_rows, extensions, overrides, mon, today=None, diary_rows=None):
    """Недельный отчёт по проверкам за неделю mon..mon+6.
    audit_rows — строки audit_log (entity='task') за неделю."""
    today = today or date.today()
    sun = mon + timedelta(days=6)
    a, z = mon.strftime('%Y-%m-%d'), sun.strftime('%Y-%m-%d')
    tasks = {t['id']: t for t in data.get('tasks', []) if (t.get('task_kind') or 'audit') == 'audit'}
    st_lbl = lambda k: S._STATUS.get(k, k or '—')
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
    _dd = []
    def _tsd(v):
        try:
            return datetime.strptime(v[:19], '%Y-%m-%d %H:%M:%S')
        except Exception:
            return None
    for x in status_changes:
        p_ = _dd[-1] if _dd else None
        if p_ and p_['id'] == x['id'] and p_['from'] == x['from'] and p_['to'] == x['to'] \
                and _tsd(p_['ts']) and _tsd(x['ts']) and (_tsd(x['ts']) - _tsd(p_['ts'])).total_seconds() <= 300:
            continue
        _dd.append(x)
    status_changes = _dd
    ext = []
    for x in extensions:
        ea = (x.get('extended_at') or '')[:10]
        if a <= ea <= z and x['task_id'] in tasks:
            ext.append({'id': x['task_id'], 'name': tasks[x['task_id']].get('name'), 'date': ea,
                        'days': x.get('days_added'), 'from': x.get('prev_deadline') or '', 'to': x.get('new_deadline') or '',
                        'comment': x.get('comment') or '', 'who': x.get('created_by') or ''})
    # перегрузы ТБ: эта неделя и следующая
    nxt = mon + timedelta(days=7)
    res = S.svod_compute(data, mon, nxt + timedelta(days=6), '', overrides, extensions, today)
    over = []
    for b in res['banks']:
        if b['capacity'] and b['peak'] > b['capacity']:
            over.append({'bank': b['name'], 'peak': b['peak'], 'capacity': b['capacity'],
                         'pct': round(100.0 * b['peak'] / b['capacity'])})
    over.sort(key=lambda x: -x['pct'])
    probs = [{'id': r['id'], 'name': r['name'], 'problems': S._server_problems(r, today)}
             for r in res['tasks'] if S._server_problems(r, today)]
    soon = [{'id': r['id'], 'name': r['name'], 'deadline': r['deadline'], 'status': r['status_label']}
            for r in res['tasks'] if r['status'] in ('planning', 'approved', 'active')
            and r['deadline'] and today.strftime('%Y-%m-%d') <= r['deadline'] <= (today + timedelta(days=14)).strftime('%Y-%m-%d')]
    soon.sort(key=lambda x: x['deadline'])
    done = [{'id': t['id'], 'name': t.get('name'), 'date': (t.get('completed_at') or '')[:10]}
            for t in tasks.values() if t.get('status') == 'done' and a <= (t.get('completed_at') or '')[:10] <= z]
    # --- срез по проверкам: строка на проверку, события недели, этап, дневник по ТБ ---
    dname = {x['id']: (x.get('name') or x['id']) for x in data.get('departments', [])}
    ref = min(today, sun)
    ref_s = ref.strftime('%Y-%m-%d')
    all_tasks = data.get('tasks', [])
    extras = {}
    for x in all_tasks:
        if x.get('task_kind') == 'other' and x.get('other_subkind') == 'audit_extra' and x.get('parent_task_id'):
            extras.setdefault(x['parent_task_id'], []).append(x)
    ev = {}
    for x in status_changes:
        ev.setdefault(x['id'], []).append({'ts': x['ts'], 'kind': 'status', 'text': x['from'] + ' → ' + x['to'] + (' (авто)' if x.get('auto') else '')})
    for x in created:
        ev.setdefault(x['id'], []).append({'ts': x['ts'], 'kind': 'new', 'text': 'создана, статус «' + x['status'] + '»'})
    for x in ext:
        ev.setdefault(x['id'], []).append({'ts': x['date'], 'kind': 'ext', 'text': 'продление +' + str(x['days'] or 0) + ' дн.: ' + (x['from'] or '—') + ' → ' + (x['to'] or '—') + (' · ' + x['comment'] if x['comment'] else '')})
    for x in done:
        ev.setdefault(x['id'], []).append({'ts': x['date'], 'kind': 'done', 'text': 'завершена'})
    prob_map = {x['id']: x['problems'] for x in probs}

    def stage_at(t, iso):
        for s_ in t.get('stages') or []:
            if s_.get('start') and s_['start'] <= iso <= (s_.get('end') or t.get('deadline') or s_['start']):
                return s_
        return None

    def week_comments(t):
        out = []
        for ln in str(t.get('folder') or '').splitlines():
            ln = ln.strip()
            m = re.match(r'^(\d{2})\.(\d{2})\.(\d{4})\s*[—–-]?\s*(.*)$', ln)
            if m:
                d_ = m.group(3) + '-' + m.group(2) + '-' + m.group(1)
                if a <= d_ <= z:
                    out.append({'date': d_, 'text': m.group(4)})
        return out

    diary = {}
    for r in diary_rows or []:
        diary[(r['task_id'], r['bank_id'])] = {'done': r.get('done_text') or '', 'moved': r.get('moved_text') or '',
                                               'author': r.get('author') or '', 'updated_at': r.get('updated_at') or ''}
    task_rows = []
    for t in tasks.values():
        stt = t.get('status') or 'active'
        evs = sorted(ev.get(t['id'], []), key=lambda x: x['ts'])
        live = stt in ('planning', 'approved', 'active') and (t.get('start_date') or '9999') <= z and (t.get('deadline') or '0000') >= a
        if not live and not evs:
            continue
        sg = stage_at(t, ref_s)
        nxt_stage = None
        if sg:
            stl = [x for x in (t.get('stages') or []) if x.get('start')]
            for i_, x in enumerate(stl):
                if x is sg and i_ + 1 < len(stl):
                    nxt_stage = stl[i_ + 1]
        banks = list(t.get('department_ids') or [])
        lead = t.get('lead_department') or ''
        if lead in banks:
            banks.remove(lead); banks.insert(0, lead)
        ex_list = [{'id': x['id'], 'name': x.get('name') or '', 'status': st_lbl(x.get('status')),
                    'load': x.get('load_coef')} for x in extras.get(t['id'], [])
                   if x.get('status') not in ('cancelled',)]
        cm = week_comments(t)
        dr = [{'bank_id': b, 'bank': dname.get(b, b), 'lead': b == lead,
               **diary.get((t['id'], b), {'done': '', 'moved': '', 'author': '', 'updated_at': ''})} for b in banks]
        stage_key = (sg or {}).get('key') or ''
        task_rows.append({
            'id': t['id'], 'name': t.get('name') or '', 'status': stt, 'status_label': st_lbl(stt),
            'stage': (sg or {}).get('label') or '', 'stage_key': stage_key,
            'stage_end': (sg or {}).get('end') or '',
            'next_stage': (nxt_stage or {}).get('label') or '', 'next_start': (nxt_stage or {}).get('start') or '',
            'deadline': t.get('deadline') or '', 'lead': dname.get(lead, ''), 'curator': t.get('curator') or '',
            'banks': [dname.get(b, b) for b in banks], 'events': evs, 'problems': prob_map.get(t['id'], []),
            'comments': cm, 'extras': ex_list, 'diary': dr,
            'diary_filled': sum(1 for x in dr if x['done'] or x['moved']),
            'nzh': stage_key == 'проверка_нжя',
        })
    order = {'active': 0, 'approved': 1, 'planning': 2, 'done': 3, 'cancelled': 4}
    task_rows.sort(key=lambda r: (0 if r['nzh'] else 1, order.get(r['status'], 9), r['deadline'] or '9999', r['name'].lower()))
    return {'week': a, 'week_end': z, 'status_changes': status_changes, 'created': created, 'extensions': ext,
            'done': done, 'overloads': over, 'problems': probs, 'deadlines_soon': soon,
            'health': res['kpi'].get('health'), 'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
            'tasks': task_rows}


def _week_report(db, mon):
    """Данные отчёта за неделю mon..mon+6 по текущей модели (проверки, этапы, продления, перегрузы ТБ)."""
    sun = mon + timedelta(days=6)
    a, z = mon.strftime('%Y-%m-%d'), sun.strftime('%Y-%m-%d')
    try:
        rows = db.query("SELECT ts, user_id, username, kind, entity, entity_id, details FROM audit_log "
                        "WHERE entity='task' AND substr(ts,1,10) BETWEEN ? AND ? ORDER BY id", (a, z))
    except Exception:
        rows = []
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
    try:  # дневник по ТБ: таблицы может ещё не быть — тогда блок пустой
        dr = db.query('SELECT task_id, bank_id, done_text, moved_text, author, updated_at FROM svod_task_diary WHERE week=?', (a,))
    except Exception:
        dr = []
    return _slice_compute(_svod(), data, rows, ext, ov, mon, diary_rows=dr)


def _e(v):
    return (str(v if v is not None else '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def _dd(iso):
    iso = str(iso or '')[:10]
    return iso[8:10] + '.' + iso[5:7] if len(iso) == 10 else '—'


def _ddy(iso):
    iso = str(iso or '')[:10]
    return iso[8:10] + '.' + iso[5:7] + '.' + iso[0:4] if len(iso) == 10 else '—'


_EVI = {'status': '🔄', 'new': '🆕', 'ext': '⏳', 'done': '✅'}
_STC = {'planning': '#7e57c2', 'approved': '#d68910', 'active': '#2874a6', 'done': '#239b56', 'cancelled': '#7f8c8d'}

_CSS = (
    'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#1f2937;padding:24px;max-width:1240px;margin:0 auto;font-size:14px}'
    'h1{color:#00695c;font-size:1.55rem;margin:0 0 4px}h2{color:#00695c;font-size:1.12rem;margin:26px 0 8px;border-bottom:2px solid #00897b;padding-bottom:6px;display:flex;align-items:center;gap:10px}'
    '.lbl{color:#374151;font-size:.82rem}.mute{color:#4b5563;font-size:.78rem}.bad{color:#c62828}.cnt{background:#e0f2f1;color:#00695c;border-radius:999px;padding:1px 9px;font-size:.78rem}'
    '.kpi{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0 6px}'
    '.card{border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#f9fafb}.card b{display:block;font-size:1.45rem;line-height:1.2}.card span{font-size:.76rem;color:#4b5563}'
    '.card.ok b{color:#2e7d32}.card.warn b{color:#d68910}.card.bad b{color:#c62828}'
    'table{width:100%;border-collapse:collapse;margin:6px 0}th,td{padding:7px 9px;text-align:left;border-bottom:1px solid #e5e7eb;vertical-align:top}'
    'th{background:#eceff1;font-size:.72rem;text-transform:uppercase;color:#37474f;position:sticky;top:0}'
    '.st{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.72rem;font-weight:700;color:#fff;white-space:nowrap}'
    '.c{text-align:center;white-space:nowrap}.nm{font-weight:700}.nzh{color:#b9770e;font-weight:700}.tag{font-size:.7rem;font-weight:700;padding:1px 8px;border-radius:999px;background:#fdebd0;color:#7e5109}'
    'tr.task>td{border-bottom:none}tr.det>td{padding:0 9px 12px}'
    'details.td>summary{cursor:pointer;color:#00695c;font-weight:600;font-size:.8rem;list-style:none;user-select:none}details.td>summary::-webkit-details-marker{display:none}'
    'details.td>summary:before{content:"▸ "}details.td[open]>summary:before{content:"▾ "}'
    '.box{border-left:3px solid #26a269;background:#f6f8fa;border-radius:0 8px 8px 0;padding:10px 14px;margin-top:6px}'
    '.cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.dh{font-weight:700;font-size:.8rem;margin-bottom:4px}'
    'ul{margin:0;padding-left:18px;line-height:1.5;font-size:.8rem}'
    '.diary{border-top:1px dashed #cbd5e1;margin-top:10px;padding-top:8px}.diary table{font-size:.8rem}.diary th{position:static}'
    'details.more{margin-top:22px}details.more>summary{cursor:pointer;list-style:none;font-weight:700;color:#00695c;font-size:1rem;padding:6px 0}'
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid h3{font-size:.92rem;margin:12px 0 4px}'
    '.btn{border:1px solid #00897b;background:#fff;color:#00695c;border-radius:8px;padding:5px 12px;font-weight:700;cursor:pointer;font-size:.8rem;margin-left:auto}'
    'details.more>summary::-webkit-details-marker{display:none}details.more>summary:before{content:"▸ "}details.more[open]>summary:before{content:"▾ "}'
    '.note{color:#4b5563;font-size:.78rem;margin-top:6px}'
    '@media print{.btn{display:none}details{display:block}body{padding:0}}'
)


def _list(items, empty):
    if not items:
        return '<div class="mute">' + empty + '</div>'
    return '<ul>' + ''.join('<li>' + x + '</li>' for x in items) + '</ul>'


def _task_detail(t):
    ev = [_EVI.get(x['kind'], '•') + ' <b>' + _dd(x['ts']) + '</b> ' + _e(x['text']) for x in t['events']]
    cm = ['<b>' + _dd(x['date']) + '</b> ' + _e(x['text']) for x in t['comments']]
    stl = ['Этап: <b>' + (_e(t['stage']) or '—') + '</b>' + (' до ' + _dd(t['stage_end']) if t['stage_end'] else '')]
    if t['next_stage']:
        stl.append('Далее: ' + _e(t['next_stage']) + ' с ' + _dd(t['next_start']))
    stl.append('Руководитель: ' + (_e(t['lead']) or '—') + ' · куратор ЦА: ' + (_e(t['curator']) or '—'))
    if t['extras']:
        stl.append('Доп. задачи: ' + ', '.join(_e(x['name']) + ' (' + _e(x['status']) + ')' for x in t['extras']))
    if t['problems']:
        stl.append('<span class="bad">🚨 ' + '; '.join(_e(p) for p in t['problems']) + '</span>')
    h = ('<div class="box"><div class="cols">'
         '<div><div class="dh">🗓 События недели</div>' + _list(ev, 'нет') + '</div>'
         '<div><div class="dh">💬 Комментарии за неделю</div>' + _list(cm, 'нет') + '</div>'
         '<div><div class="dh">📌 Состояние</div>' + _list(stl, '—') + '</div></div>')
    h += ('<div class="diary"><div class="dh">📓 Дневник по ТБ за неделю'
          + (' <span class="tag">этап «Проверка НЖЯ»</span>' if t['nzh'] else ' <span class="mute">(основной для этапа «Проверка НЖЯ»)</span>')
          + '</div>')
    if not t['diary']:
        h += '<div class="mute">У проверки нет банков</div>'
    elif not t['diary_filled']:
        h += '<div class="mute">Записей за неделю нет · банки: ' + _e(', '.join(t['banks'])) + '</div>'
    else:
        h += '<table><thead><tr><th>ТБ</th><th>Что сделали</th><th>Что перенесли</th><th>Автор</th></tr></thead><tbody>'
        for d in t['diary']:
            h += ('<tr><td class="nm">' + ('👑 ' if d['lead'] else '') + _e(d['bank']) + '</td><td>'
                  + (_e(d['done']).replace('\n', '<br>') or '<span class="mute">—</span>') + '</td><td>'
                  + (_e(d['moved']).replace('\n', '<br>') or '<span class="mute">—</span>') + '</td><td class="mute">'
                  + (_e(d['author']) or '—') + (' · ' + _e(d['updated_at']) if d['updated_at'] else '') + '</td></tr>')
        h += '</tbody></table>'
    return h + '</div></div>'


def _brief(t):
    parts = []
    if t['events']:
        parts.append(' · '.join(_EVI.get(x['kind'], '•') + ' ' + _e(x['text']) for x in t['events']))
    else:
        parts.append('<span class="mute">без событий за неделю</span>')
    if t['comments']:
        parts.append('💬 ' + _e(t['comments'][-1]['text']))
    return '<br>'.join(parts)


def _build_html(db, mon=None):
    today = date.today()
    mon = mon or (today - timedelta(days=today.weekday()))
    rep = _week_report(db, mon)
    h = rep.get('health') or {}
    idx = h.get('index')
    cls = 'ok' if (idx or 0) >= 80 else 'warn' if (idx or 0) >= 60 else 'bad'
    tl = rep['tasks']
    out = ['<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Недельный отчёт по проверкам '
           + _ddy(rep['week']) + ' — ' + _ddy(rep['week_end']) + '</title><style>' + _CSS + '</style></head><body>']
    out.append('<h1>📊 Недельный отчёт по проверкам</h1><div class="lbl">Неделя: ' + _ddy(rep['week']) + ' — '
               + _ddy(rep['week_end']) + ' · Сформирован: ' + _e(_ddy(rep['generated_at']) + str(rep['generated_at'])[10:16]) + '</div>')
    out.append('<div class="kpi">'
               '<div class="card ' + cls + '"><b>' + ('—' if idx is None else str(idx)) + '</b><span>индекс здоровья</span><span style="display:block">пробл. ' + str(h.get('problem_pct', 0)) + '% · перегруз ' + str(h.get('over_pct', 0)) + '%</span></div>'
               '<div class="card"><b>' + str(len(tl)) + '</b><span>проверок в срезе</span></div>'
               '<div class="card"><b>' + str(len(rep['status_changes'])) + '</b><span>смен статуса</span></div>'
               '<div class="card"><b>' + str(len(rep['extensions'])) + '</b><span>продлений</span></div>'
               '<div class="card ok"><b>' + str(len(rep['done'])) + '</b><span>завершено</span></div>'
               '<div class="card ' + ('bad' if rep['overloads'] else 'ok') + '"><b>' + str(len(rep['overloads'])) + '</b><span>перегрузы ТБ</span></div>'
               '</div>')
    out.append('<h2>📋 Проверки за неделю <span class="cnt">' + str(len(tl)) + '</span>'
               '<button type="button" class="btn" id="tglAll">▸ Раскрыть все</button></h2>')
    if tl:
        out.append('<table><thead><tr><th>Проверка</th><th>Статус</th><th>Этап</th><th>Кратко за неделю</th>'
                   '<th class="c" title="Проблемы">🚨 Пробл.</th><th class="c" title="Дневник по ТБ: заполнено / банков">📓 Дневник</th><th class="c">Срок</th></tr></thead><tbody>')
        for t in tl:
            od = t['deadline'] and t['deadline'] < today.strftime('%Y-%m-%d') and t['status'] in ('planning', 'approved', 'active')
            out.append('<tr class="task"><td><div class="nm">' + _e(t['name']) + '</div><div class="mute">' + _e(', '.join(t['banks'])) + '</div></td>'
                       '<td><span class="st" style="background:' + _STC.get(t['status'], '#777') + '">' + _e(t['status_label']) + '</span></td>'
                       '<td>' + ((('<span class="nzh">' + _e(t['stage']) + '</span>') if t['nzh'] else _e(t['stage'])) if t['stage'] else '<span class="mute">—</span>') + '</td>'
                       '<td>' + _brief(t) + '</td>'
                       '<td class="c">' + ('<span class="bad" title="' + _e('; '.join(t['problems'])) + '">' + str(len(t['problems'])) + '</span>' if t['problems'] else '') + '</td>'
                       '<td class="c">' + (str(t['diary_filled']) + '/' + str(len(t['diary'])) if t['diary'] else '') + '</td>'
                       '<td class="c' + (' bad' if od else '') + '">' + _ddy(t['deadline']) + '</td></tr>'
                       '<tr class="det"><td colspan="7"><details class="td"><summary>Подробнее: события, комментарии, дневник по ТБ</summary>'
                       + _task_detail(t) + '</details></td></tr>')
        out.append('</tbody></table><div class="note">По умолчанию показана краткая версия. «Подробнее» раскрывает события, '
                   'комментарии и дневник по каждому ТБ (что сделали, что перенесли). Проверки на этапе «Проверка НЖЯ» стоят первыми. 👑 — банк-руководитель.</div>')
    else:
        out.append('<div class="mute">За неделю нет активных проверок и событий</div>')

    def sec(title, items, empty):
        return '<div><h3>' + title + ' <span class="cnt">' + str(len(items)) + '</span></h3>' + _list(items, empty) + '</div>'
    ov = ['<b>' + _e(x['bank']) + '</b> — пик ' + str(x['peak']).replace('.', ',') + ' при ёмкости '
          + str(x['capacity']).replace('.', ',') + ' (' + str(x['pct']) + '%)' for x in rep['overloads']]
    sn = ['<b>' + _ddy(x['deadline']) + '</b> ' + _e(x['name']) + ' <span class="mute">' + _e(x['status']) + '</span>' for x in rep['deadlines_soon']]
    cr = ['<b>' + _dd(x['ts']) + '</b> ' + _e(x['name']) + ' <span class="mute">' + _e(x['who']) + '</span>' for x in rep['created']]
    dn = ['<b>' + _dd(x['date']) + '</b> ' + _e(x['name']) for x in rep['done']]
    st = ['<b>' + _dd(x['ts']) + '</b> ' + _e(x['name']) + ': ' + _e(x['from']) + ' → ' + _e(x['to'])
          + ' <span class="mute">' + _e(x['who']) + '</span>' for x in rep['status_changes']]
    ex = ['<b>' + _dd(x['date']) + '</b> ' + _e(x['name']) + ': +' + str(x['days'] or 0) + ' дн., ' + _ddy(x['from']) + ' → ' + _ddy(x['to'])
          + (' · ' + _e(x['comment']) if x['comment'] else '') for x in rep['extensions']]
    out.append('<details class="more"><summary>Сводка по ТБ и прочее: перегрузы, дедлайны, новые и завершённые, смены статуса, продления</summary>'
               '<div class="grid">' + sec('🔥 Перегрузы ТБ (эта и следующая неделя)', ov, 'Перегрузов нет')
               + sec('📅 Дедлайны в ближайшие 14 дней', sn, 'Дедлайнов нет') + '</div>'
               '<div class="grid">' + sec('🆕 Новые проверки', cr, 'Новых проверок нет') + sec('✅ Завершены', dn, 'Завершённых нет') + '</div>'
               '<div class="grid">' + sec('🔄 Смена статуса', st, 'Статусы не менялись') + sec('⏳ Продления сроков', ex, 'Продлений не было') + '</div>'
               '</details>')
    out.append('<script>(function(){var b=document.getElementById("tglAll");if(!b)return;b.addEventListener("click",function(){'
               'var ds=document.querySelectorAll("details.td"),all=true;ds.forEach(function(d){if(!d.open)all=false;});'
               'ds.forEach(function(d){d.open=!all;});b.textContent=all?"▸ Раскрыть все":"▾ Свернуть все";});})();</script>')
    out.append('</body></html>')
    return ''.join(out)


def _generate(db, base_dir):
    rdir = _reports_dir(base_dir)
    today = date.today()
    iso_week = today.strftime('%G-W%V')
    fname = 'report_' + iso_week + '.html'
    content = _build_html(db)
    path = rdir / fname
    path.write_text(content, encoding='utf-8')
    # Чистка старых
    cfg = _cfg()
    files = sorted(rdir.glob('report_*.html'), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[cfg.get('keep', 26):]:
        try: old.unlink()
        except Exception: pass
    return fname


def _worker(db, base_dir, stop):
    cfg = _cfg()
    stop.wait(int(cfg.get('first_run_after_seconds', 120)))
    while not stop.is_set():
        try:
            cfg = _cfg()
            if cfg.get('enabled'):
                now = datetime.now()
                if now.weekday() == int(cfg.get('weekday', 4)) and now.hour == int(cfg.get('hour', 18)):
                    _generate(db, base_dir)
                    print('[weekly_report] отчёт сформирован: ' + now.strftime('%Y-%m-%d %H:%M'))
                    stop.wait(3600)
        except Exception as e:
            print('[weekly_report] ошибка: ' + str(e))
        stop.wait(600)


def _page(csrf_token=''):
    # PATCH v1.0.13: CSRF-токен прокидывается в HTML, чтобы fetch(POST)
    # проходил before_request-проверку в app.py (иначе 400 csrf).
    return r'''<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Недельные отчёты</title>
<script>window.REESTR_CSRF = "__CSRF__";</script>
<script src="/static/plugin_theme.js"></script>
<script src="/static/plugin_mask.js"></script>
<style>body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#e8e8e8;padding:24px;max-width:900px;margin:0 auto}h1{color:#f5d76e;font-size:1.4rem}a.back{color:#c8c8c8;text-decoration:none;font-size:0.85rem;padding:6px 14px;border:1px solid rgba(245,215,110,0.22);border-radius:20px;display:inline-block;margin-bottom:16px}.toolbar{display:flex;gap:8px;align-items:center;margin:16px 0}button{padding:8px 16px;border-radius:10px;background:linear-gradient(135deg,#f5d76e,#e6a81a);color:#0a0a0a;font-weight:700;border:none;cursor:pointer;font-family:inherit}button:hover{transform:scale(1.02)}.row{display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:10px 14px;background:rgba(20,20,20,0.6);border:1px solid rgba(245,215,110,0.18);border-radius:10px;margin-bottom:6px}.name{font-family:monospace;font-weight:700}.mtime{font-size:0.75rem;color:#8a8a8a}.dl{font-size:0.8rem;color:#6dc2f0;text-decoration:none;padding:4px 10px;border:1px solid rgba(52,152,219,0.4);border-radius:8px}.empty{text-align:center;padding:40px;color:#8a8a8a;font-style:italic}</style></head><body>
<a class="back" href="/">← К трекеру</a>
<h1>📊 Недельные отчёты</h1>
<div class="toolbar"><button id="genBtn">🔄 Сформировать сейчас</button><span id="msg" style="font-size:0.85rem;color:#8a8a8a;"></span></div>
<div id="list"><div class="empty">Загрузка…</div></div>
<script>
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function load(){fetch('/api/plugins/weekly_report/list',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(d){var el=document.getElementById('list');if(!d.success||!d.items.length){el.innerHTML='<div class="empty">Отчётов пока нет</div>';return;}el.innerHTML=d.items.map(function(it){return '<div class="row"><span class="name">'+esc(it.name)+'</span><span class="mtime">'+esc(it.mtime)+'</span><a class="dl" href="/api/plugins/weekly_report/download?name='+encodeURIComponent(it.name)+'">⬇ Скачать</a></div>';}).join('');});}
document.getElementById('genBtn').addEventListener('click',function(){
    var b=this;
    b.disabled=true;
    document.getElementById('msg').textContent='Генерация…';
    // PATCH v1.0.13: X-CSRF-Token для POST-запроса
    var _hdrs = {};
    if (window.REESTR_CSRF) _hdrs['X-CSRF-Token'] = window.REESTR_CSRF;
    fetch('/api/plugins/weekly_report/generate',{
        method:'POST',
        credentials:'same-origin',
        headers:_hdrs
    })
    .then(function(r){return r.json();})
    .then(function(d){
        b.disabled=false;
        if (d && d.success) {
            document.getElementById('msg').textContent='Готово: '+d.name;
        } else {
            document.getElementById('msg').textContent='Ошибка: '+((d&&d.error)||'?');
        }
        load();
    })
    .catch(function(){b.disabled=false;document.getElementById('msg').textContent='Ошибка соединения';});
});
load();
</script></body></html>'''


def register(app, db, hooks):
    print('[weekly_report] v' + __version__ + ' · ' + __description__)
    base_dir = Path(app.root_path)
    stop = threading.Event()

    def _auth():
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u: return None
            if not user_has(db, u, 'plugin.weekly.use'): return None
            return u
        except Exception:
            return None

    @app.route('/plugins/weekly_report/', methods=['GET'])
    def _wr_page():
        if not _auth(): return redirect('/login')
        # PATCH v1.0.13: прокидываем CSRF в страницу
        try:
            from auth import ensure_csrf
            _tok = ensure_csrf() or ''
        except Exception:
            _tok = ''
        _html = _page(_tok).replace('__CSRF__', _tok)
        return Response(_html, mimetype='text/html')

    @app.route('/api/plugins/weekly_report/list', methods=['GET'])
    def _wr_list():
        if not _auth(): return jsonify({'success': False}), 403
        rdir = _reports_dir(base_dir)
        items = []
        for f in sorted(rdir.glob('report_*.html'), key=lambda x: x.stat().st_mtime, reverse=True)[:26]:
            items.append({'name': f.name, 'size': f.stat().st_size, 'mtime': datetime.fromtimestamp(f.stat().st_mtime).strftime('%Y-%m-%d %H:%M')})
        return jsonify({'success': True, 'items': items})

    @app.route('/api/plugins/weekly_report/generate', methods=['POST'])
    def _wr_gen():
        if not _auth(): return jsonify({'success': False}), 403
        try:
            name = _generate(db, base_dir)
            return jsonify({'success': True, 'name': name})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/plugins/weekly_report/download', methods=['GET'])
    def _wr_dl():
        if not _auth(): return jsonify({'success': False}), 403
        name = str(request.args.get('name', '')).strip()
        if not name or '/' in name or '\\' in name or '..' in name:
            return jsonify({'success': False}), 400
        p = _reports_dir(base_dir) / name
        if not p.exists(): return jsonify({'success': False}), 404
        return send_file(str(p), as_attachment=True, download_name=name)

    def on_startup(**ctx):
        t = threading.Thread(target=_worker, args=(db, base_dir, stop), daemon=True)
        t.start()
        print('[weekly_report] планировщик запущен')

    def on_shutdown(**ctx):
        stop.set()

    hooks.on('on_startup', on_startup)
    hooks.on('on_shutdown', on_shutdown)
