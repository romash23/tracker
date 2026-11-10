"""plugins/gantt.py — План проверок (Гант) для трекера."""

__version__ = '2.0'
__description__ = 'Диаграмма Ганта: sticky-заголовок, sticky-колонка задач, крупные полосы, светлая/тёмная тема'

import io
from datetime import date, datetime, timedelta
from flask import request, jsonify, Response, redirect


# ============================================================
# Тепловая карта сотрудников — расчёт нагрузки
# Модель (согласована с владельцем):
#   нагрузка_сотр(период) =
#       dir_retail * Σ(розничные проверки банка)/числ_розн_банка
#     + dir_corp   * Σ(корпоратив. проверки банка)/числ_корп_банка
#     + Σ(load_coef задач «Другое», где сотрудник назначен)   (фикс, не делится)
#   Численность направления = сумма долей dir_retail / dir_corp по банку
#   (гибрид 0.5/0.5 даёт 0.5 в каждое). Нагрузка считается ОДИН раз и
#   не зависит от фильтра направления (фильтр влияет только на показ строк).
# ============================================================
_OV_SCOPES = ('oam', 'корпоративная', 'розничная', 'розничная_без_пвр')


def _heatmap_compute(data, d1, d2, mode):
    def _d(s):
        try:
            return datetime.strptime(s, '%Y-%m-%d').date()
        except Exception:
            return None
    emps = data.get('employees', [])
    tasks = data.get('tasks', [])
    dept_name = {x['id']: (x.get('name') or '') for x in data.get('departments', [])}
    emp_by_dep = {}
    for e in emps:
        if e.get('fired'):
            continue
        emp_by_dep.setdefault(e.get('department_id') or '', []).append(e)

    def dir_counts(dep):
        es = emp_by_dep.get(dep, [])
        r = sum(float(e.get('dir_retail') or 0) for e in es)
        c = sum(float(e.get('dir_corp') or 0) for e in es)
        return r, c

    def lead_coef(t, bank_id):
        if (t.get('lead_department') or '') != bank_id:
            return 1.0
        tp = t.get('task_type') or ''
        if tp == 'розничная':
            return 2.0
        if tp == 'корпоративная':
            return 1.5
        return 1.0

    # Столбцы-периоды
    periods = []
    if mode == 'week':
        cur = d1 - timedelta(days=d1.weekday())
        while cur <= d2:
            periods.append((cur, cur + timedelta(days=6), cur.strftime('%d.%m')))
            cur += timedelta(days=7)
    else:
        cur = d1
        while cur <= d2:
            periods.append((cur, cur, cur.strftime('%d.%m')))
            cur += timedelta(days=1)

    def _ov(a, b, ps, pe):
        return a is not None and b is not None and a <= pe and b >= ps

    def audit_weight(t, ps, pe):
        # Вес активного на периоде этапа проверки (как в плане проверок).
        w = 0.0
        for s in t.get('stages') or []:
            if not s.get('start'):
                continue
            a = _d(s['start'])
            b = _d(s.get('end') or t.get('deadline') or s['start'])
            if _ov(a, b, ps, pe):
                w = max(w, float(s.get('weight') or 0))
        return w

    def other_active(t, ps, pe):
        a = _d(t.get('start_date'))
        b = _d(t.get('deadline'))
        if a is None:
            a = ps
        if b is None:
            b = pe
        return _ov(a, b, ps, pe)

    def _day_meta(e, day):
        wd = day.weekday()
        holidays = data.get('holidays') or {}
        is_holiday = str(day) in holidays or wd >= 5
        absent = False
        if not is_holiday:
            for v in (e.get('vacations') or []):
                if (v.get('type') or 'vacation') == 'remote':
                    continue
                a = _d(v.get('from'))
                b = _d(v.get('to'))
                if a is None or b is None:
                    continue
                if a <= day <= b:
                    absent = True
                    break
        return {'weekend': wd >= 5, 'holiday': is_holiday, 'absent': absent, 'working': (not is_holiday) and (not absent)}

    def _absence_availability(e, ps, pe):
        # Доля доступности сотрудника в периоде. Выходные/праздники имеют вес 0.
        workdays = 0
        available_days = 0
        cur = ps
        while cur <= pe:
            meta = _day_meta(e, cur)
            if meta['holiday']:
                cur += timedelta(days=1)
                continue
            workdays += 1
            if meta['working']:
                available_days += 1
            cur += timedelta(days=1)
        if workdays <= 0:
            return 1.0
        return max(0.0, available_days / workdays)

    banks = []
    for dep in sorted(emp_by_dep.keys(), key=lambda d: dept_name.get(d, d).lower()):
        if not dep:
            continue
        es = emp_by_dep[dep]
        r_cnt, c_cnt = dir_counts(dep)  # штатная численность направлений (без учёта отпусков)

        # Нагрузка банка по периодам (как в таблице «Нагрузка по тер банкам»):
        # сумма веса активных этапов аудиторских проверок * leadCoef.
        bank_load = []
        for (ps, pe, _lab) in periods:
            bl = 0.0
            for t in tasks:
                if dep not in (t.get('department_ids') or []):
                    continue
                if (t.get('task_kind') or 'audit') != 'audit':
                    continue
                w = audit_weight(t, ps, pe)
                if w > 0:
                    bl += w * lead_coef(t, dep)
            bank_load.append(round(bl, 2))

        rows = []
        for e in sorted(es, key=lambda x: (x.get('name') or '').lower()):
            dr = float(e.get('dir_retail') or 0)
            dc = float(e.get('dir_corp') or 0)
            cells = []
            cell_flags = []
            for pi, (ps, pe, _lab) in enumerate(periods):
                cell_meta = _day_meta(e, ps) if mode != 'week' else None
                emp_av = _absence_availability(e, ps, pe)
                eff_dr = dr * emp_av
                eff_dc = dc * emp_av
                if eff_dr <= 0 and eff_dc <= 0:
                    cells.append(0.0)
                    if mode != 'week':
                        cell_flags.append(cell_meta)
                    continue
                r_av = sum(float(e2.get('dir_retail') or 0) * _absence_availability(e2, ps, pe) for e2 in es)
                c_av = sum(float(e2.get('dir_corp') or 0) * _absence_availability(e2, ps, pe) for e2 in es)
                lr = 0.0
                lc = 0.0
                oth = 0.0
                for t in tasks:
                    if dep not in (t.get('department_ids') or []):
                        continue
                    kind = t.get('task_kind') or 'audit'
                    if kind == 'audit':
                        w = audit_weight(t, ps, pe)
                        if w <= 0:
                            continue
                        contrib = w * lead_coef(t, dep)
                        if t.get('task_type') == 'розничная':
                            lr += contrib
                        elif t.get('task_type') == 'корпоративная':
                            lc += contrib
                    else:
                        if e['id'] in (t.get('assignees') or []) and other_active(t, ps, pe):
                            oth += float(t.get('load_coef') or 0) * emp_av
                val = (eff_dr * (lr / r_av if r_av > 0 else 0)
                       + eff_dc * (lc / c_av if c_av > 0 else 0)
                       + oth)
                if mode != 'week' and cell_meta and cell_meta['holiday']:
                    val = 0.0
                cells.append(round(val, 2))
                if mode != 'week':
                    cell_flags.append(cell_meta)
            kind = ('hybrid' if (dr > 0 and dc > 0)
                    else ('retail' if dr > 0 else ('corp' if dc > 0 else 'none')))
            row = {'id': e['id'], 'name': e.get('name', ''),
                   'kind': kind, 'cells': cells}
            if mode != 'week':
                row['cell_flags'] = cell_flags
            rows.append(row)
        banks.append({'id': dep, 'name': dept_name.get(dep, dep),
                      'total': round(r_cnt + c_cnt, 2),
                      'retail': round(r_cnt, 2), 'corp': round(c_cnt, 2),
                      'load': bank_load,
                      'rows': rows})
    return {'periods': [p[2] for p in periods], 'banks': banks}


# ============================================================
# JS — инжектор кнопки в шапку трекера
# ============================================================
_JS = r'''
(function(){
'use strict';
function register(){
    if (typeof window.__trkRegisterPlugin !== 'function') {
        setTimeout(register, 200);
        return;
    }
    /* PATCH: «План проверок» теперь отдельная кнопка в верхнем ряду (buildGanttTab).
       Пункт в выпадающем меню «Статистика» убран, чтобы не дублировался. */
    if (false) {
    window.__trkRegisterPlugin({
        id: 'gantt',
        icon: '📊',
        name: 'Текущая загрузка',
        url: '/plugins/gantt/',
        perm: 'plugin.gantt.use'
    });
    }
}
register();
})();
'''


# ============================================================
# HTML-страница
# ============================================================
def _page_html():
    return r'''<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Текущая загрузка</title>
<script src="/static/plugin_theme.js"></script>
<script src="/static/plugin_mask.js"></script>
<style>
* { box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    margin: 0;
    padding: 16px;
    font-size: 14px;
    background: var(--pg-bg, #0f0f0f);
    background-attachment: fixed;
    color: var(--pg-text, #e8e8e8);
    min-height: 100vh;
}
.wrap {
    max-width: none;
    padding: 0 16px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    zoom: 0.85;
}
@supports not (zoom: 1) {
    .wrap {
        transform: scale(0.85);
        transform-origin: top left;
        width: 117.6471%;
    }
}

/* Шапка */
.head {
    display: flex; flex-direction: column; gap: 10px;
    padding: 14px 18px;
    background: var(--pg-card-bg, #1a1a1a);
    border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22));
    border-radius: 14px;
}
.head-top { display: flex; align-items: center; gap: 14px; }
.head-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.head h1 {
    margin: 0; font-size: 1.6rem; font-weight: 800;
    color: var(--pg-accent, #f5d76e);
}
.back {
    color: var(--pg-desc, #c8c8c8);
    text-decoration: none;
    padding: 6px 14px;
    border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22));
    border-radius: 20px;
    font-size: 0.85rem;
    transition: all 0.15s;
}
.back:hover {
    background: var(--pg-accent-bg, rgba(245,215,110,0.14));
    color: var(--pg-accent, #f5d76e);
    border-color: var(--pg-accent, #f5d76e);
}
.head label { font-size: 0.75rem; color: var(--pg-meta, #a0a0a0); display: inline-flex; align-items: center; gap: 4px; }
.ms-dd-group { display: inline-flex; flex-direction: column; gap: 2px; }
.ms-dd-label { font-size: 0.62rem; letter-spacing: .04em; text-transform: uppercase; color: var(--pg-muted, #6b7280); font-weight: 700; padding-left: 2px; display: block; margin-bottom: 2px; }
.head input[type="date"],
.head select {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--pg-input-border, rgba(245,215,110,0.26));
    background: var(--pg-input-bg, #232323);
    color: var(--pg-text, #e8e8e8);
    font-family: inherit;
    font-size: 0.82rem;
}
.head input:focus, .head select:focus { outline: none; border-color: var(--pg-accent, #f5d76e); }
.head button.apply {
    padding: 6px 16px;
    border-radius: 8px;
    border: none;
    background: linear-gradient(135deg, var(--pg-accent, #f5d76e), var(--pg-accent-2, #e6a81a));
    color: #0a0a0a;
    font-weight: 800;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.82rem;
    transition: transform 0.15s;
}
.head button.apply:hover { transform: scale(1.05); }

/* Мультивыбор-дропдаун (карман / тер банк) — как в Excel */
.ms-dd { position: relative; display: inline-block; font-size: 0.82rem; }
.ms-dd-btn {
    padding: 6px 26px 6px 10px; border-radius: 8px;
    border: 1px solid var(--pg-input-border, rgba(245,215,110,0.26));
    background: var(--pg-input-bg, #232323); color: var(--pg-text, #e8e8e8);
    font-family: inherit; font-size: 0.82rem; cursor: pointer;
    min-width: 120px; max-width: 220px; text-align: left;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative;
}
.ms-dd-btn::after {
    content: '▾'; position: absolute; right: 9px; top: 50%;
    transform: translateY(-50%); color: var(--pg-meta, #a0a0a0); font-size: 0.7rem;
}
.ms-dd-btn:hover { border-color: var(--pg-accent, #f5d76e); }
.ms-dd.open .ms-dd-btn { border-color: var(--pg-accent, #f5d76e); }
.ms-dd-panel {
    display: none; position: absolute; z-index: 50; top: calc(100% + 4px); left: 0;
    min-width: 100%; max-height: 260px; overflow-y: auto;
    background: var(--pg-input-bg, #232323);
    border: 1px solid var(--pg-accent, #f5d76e); border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); padding: 4px;
}
.ms-dd.open .ms-dd-panel { display: block; }
.ms-dd-item {
    display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border-radius: 6px; cursor: pointer; color: var(--pg-text, #e8e8e8);
    white-space: nowrap;
}
.ms-dd-item:hover { background: var(--pg-accent-bg, rgba(245,215,110,0.14)); }
.ms-dd-item input { margin: 0; cursor: pointer; }
.ms-dd-empty { padding: 8px; color: var(--pg-meta, #a0a0a0); font-style: italic; }

/* Основной контейнер диаграммы */
.gantt-box {
    border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22));
    border-radius: 14px;
    background: var(--pg-card-bg, #1a1a1a);
    overflow: auto;
    max-height: 76vh;
    position: relative;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
}

/* Внутренний layout */
.gantt-inner {
    display: inline-block;
    min-width: 100%;
}

/* Шапка (sticky top) */
.gg-header {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 30;
    height: 58px;
    background: var(--pg-inner-bg, #232323);
    border-bottom: 2px solid var(--pg-card-border, rgba(245,215,110,0.22));
}
.gg-corner {
    flex: 0 0 320px;
    width: 320px;
    position: sticky;
    left: 0;
    z-index: 31;
    background: var(--pg-inner-bg, #232323);
    border-right: 2px solid var(--pg-card-border, rgba(245,215,110,0.22));
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-weight: 800;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    color: var(--pg-meta, #a0a0a0);
}
.gg-days { display: flex; }
.gg-day {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border-right: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12));
    padding: 6px 0;
    line-height: 1.15;
    transition: background 0.15s;
}
.gg-day.weekend { background: rgba(128,128,128,0.10); }
.gg-day.today {
    background: rgba(46,204,113,0.18);
    box-shadow: inset 0 -3px 0 #2ecc71;
}
.gg-dow {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--pg-meta, #a0a0a0);
}
.gg-date {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--pg-text, #e8e8e8);
}
.gg-day.weekend .gg-date { color: var(--pg-meta, #a0a0a0); }
.gg-day.today .gg-date { color: #2ecc71; font-weight: 800; }

/* Тело */
.gg-body { position: relative; }

/* Фон: выходные + сегодня */
.gg-bg {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 320px;
    pointer-events: none;
    z-index: 0;
}
.gg-bg-cell {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(128,128,128,0.07);
}
.gg-bg-cell.gg-bg-today { background: rgba(46,204,113,0.06); }
.gg-today-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #2ecc71;
    box-shadow: 0 0 8px rgba(46,204,113,0.6);
    opacity: 0.8;
}

/* Строка задачи */
.gg-row {
    display: flex;
    height: 42px;
    border-bottom: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12));
    position: relative;
    z-index: 1;
    transition: background 0.12s;
}
/* П.3: высота строки = 1.5× ширины столбца (день 44→66, неделя 92→138) */
.gg-mode-day .gg-row { height: 40px; }
.gg-mode-week .gg-row { height: 70px; }
/* П.7: число нагрузки в ячейке недели */
.gg-wk-load {
    position: absolute; top: 3px; right: 4px;
    font-size: 0.66rem; font-weight: 800;
    color: rgba(0,0,0,0.75);
    pointer-events: none;
}
.gg-row:hover { background: rgba(245,215,110,0.04); }

.gg-name {
    flex: 0 0 320px;
    width: 320px;
    position: sticky;
    left: 0;
    z-index: 5;
    background: var(--pg-card-bg, #1a1a1a);
    border-right: 2px solid var(--pg-card-border, rgba(245,215,110,0.22));
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    transition: background 0.12s;
}
.gg-row:hover .gg-name { background: var(--pg-inner-bg, #232323); }
.gg-edit {
    margin-left: 6px; flex: 0 0 auto;
    opacity: 0.55; text-decoration: none;
    font-size: 0.95rem; cursor: pointer;
    transition: opacity 0.12s, background 0.12s, transform 0.12s;
    border: 1px solid transparent;
    background: transparent;
    color: var(--pg-text, #e8e8e8);
    border-radius: 5px; padding: 1px 5px; line-height: 1.4;
    font-family: inherit; white-space: nowrap;
}
.gg-row:hover .gg-edit { opacity: 1; }
.gg-edit:hover { opacity: 1; background: var(--pg-accent-soft, rgba(245,215,110,0.22)); transform: scale(1.12); }
body.trk-theme-light .gg-edit { color:#1b5e20; background:#eef3ee; border-color:rgba(0,0,0,0.15); }
body.trk-theme-light .gg-edit:hover { background:#dceadc; }
.gg-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 6px currentColor;
}
.gg-dot-active { background: #5dade2; color: #5dade2; }
.gg-dot-done { background: #58d68d; color: #58d68d; }
.gg-dot-paused { background: #f7dc6f; color: #f7dc6f; }
.gg-dot-archived { background: #aab7b8; color: #aab7b8; }
.gg-dot-overdue { background: #ec7063; color: #ec7063; }
.gg-dot-planned { background: #95a5a6; color: #95a5a6; }
.gg-ico { font-size: 1rem; flex-shrink: 0; }
.gg-task-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 0.82rem;
    color: var(--pg-text, #e8e8e8);
}
.gg-task-name.gg-expandable {
    font-size: 0.92rem;
    font-style: italic;
}

.gg-track {
    position: relative;
    flex: 0 0 auto;
    height: 70px;
}
.gg-stage-seg {
    position: absolute;
    top: 0;
    height: 100%;
    opacity: 0.92;
    border-right: 1px solid rgba(0,0,0,0.25);
}
.gg-stage-seg:last-child { border-right: none; }
.gg-stage-legend {
    display: flex; flex-wrap: wrap; gap: 10px 16px;
    padding: 10px 14px; margin-top: 4px;
    background: var(--pg-card-bg, #1a1a1a);
    border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22));
    border-radius: 12px; font-size: 0.82rem;
}
.gg-stage-legend .lg-item { display: inline-flex; align-items: center; gap: 6px; }
.gg-stage-legend .lg-chip { width: 13px; height: 13px; border-radius: 3px; display: inline-block; }
.gg-bar {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 24px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    color: #fff;
    font-weight: 700;
    overflow: hidden;
    box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.3),
        0 2px 8px rgba(0,0,0,0.35);
    cursor: pointer;
    z-index: 2;
    transition: filter 0.15s, box-shadow 0.15s;
}
.gg-bar:hover {
    filter: brightness(1.15);
    box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.4),
        0 6px 16px rgba(0,0,0,0.45);
}
.gg-bar-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.72rem;
    text-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.gg-bar-active { background: linear-gradient(180deg, #6dc2f0, #2874a6); }
.gg-bar-done { background: linear-gradient(180deg, #7be0a0, #239b56); }
.gg-bar-paused { background: linear-gradient(180deg, #fadc8a, #d4ac0d); color: #221a00; }
.gg-bar-paused .gg-bar-label { text-shadow: none; }
.gg-bar-archived { background: linear-gradient(180deg, #bcc7c8, #7b8a8b); }
.gg-bar-overdue {
    background: linear-gradient(180deg, #f08b80, #b03a2e);
    box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.3),
        0 0 14px rgba(231,76,60,0.4),
        0 2px 8px rgba(0,0,0,0.35);
}
.gg-bar-planned { background: linear-gradient(180deg, #b0bec5, #607d8b); }

/* Пустое состояние и загрузка */
.empty, .loading {
    text-align: center;
    padding: 60px 20px;
    color: var(--pg-meta, #a0a0a0);
    font-style: italic;
    font-size: 0.9rem;
}

/* Легенда */
.legend {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    padding: 12px 16px;
    font-size: 0.78rem;
    color: var(--pg-meta, #a0a0a0);
    border-top: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12));
    background: var(--pg-card-bg, #1a1a1a);
}
.legend .it { display: flex; align-items: center; gap: 6px; }
.legend .sw {
    width: 16px; height: 10px; border-radius: 3px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
}
.legend .sw.active { background: linear-gradient(180deg, #6dc2f0, #2874a6); }
.legend .sw.done { background: linear-gradient(180deg, #7be0a0, #239b56); }
.legend .sw.paused { background: linear-gradient(180deg, #fadc8a, #d4ac0d); }
.legend .sw.overdue { background: linear-gradient(180deg, #f08b80, #b03a2e); }
.legend .sw.archived { background: linear-gradient(180deg, #bcc7c8, #7b8a8b); }

/* Светлая тема — override поверх plugin_theme.js */
body.trk-theme-light .gantt-box { background: #ffffff; border-color: rgba(0,0,0,0.14); box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
body.trk-theme-light .gg-header { background: #eceff1; border-bottom-color: rgba(0,0,0,0.14); }
body.trk-theme-light .gg-corner { background: #eceff1; border-right-color: rgba(0,0,0,0.14); color: #546e7a; }
body.trk-theme-light .gg-day { border-right-color: rgba(0,0,0,0.08); }
body.trk-theme-light .gg-day.weekend { background: rgba(96,125,139,0.12); }
body.trk-theme-light .gg-day.today { background: rgba(46,125,50,0.14); box-shadow: inset 0 -3px 0 #2e7d32; }
body.trk-theme-light .gg-date { color: #212121; }
body.trk-theme-light .gg-day.weekend .gg-date { color: #546e7a; }
body.trk-theme-light .gg-day.today .gg-date { color: #1b5e20; }
body.trk-theme-light .gg-bg-cell { background: rgba(96,125,139,0.08); }
body.trk-theme-light .gg-bg-cell.gg-bg-today { background: rgba(46,125,50,0.06); }
body.trk-theme-light .gg-today-line { background: #2e7d32; box-shadow: 0 0 8px rgba(46,125,50,0.5); }
body.trk-theme-light .gg-row { border-bottom-color: rgba(0,0,0,0.08); }
body.trk-theme-light .gg-row:hover { background: rgba(0,137,123,0.04); }
body.trk-theme-light .gg-name { background: #ffffff; border-right-color: rgba(0,0,0,0.14); }
body.trk-theme-light .gg-row:hover .gg-name { background: #f7f9fa; }
body.trk-theme-light .gg-task-name { color: #212121; }
body.trk-theme-light .gg-bar-active { background: linear-gradient(180deg, #4fc3f7, #1976d2); }
body.trk-theme-light .gg-bar-done { background: linear-gradient(180deg, #66bb6a, #2e7d32); }
body.trk-theme-light .gg-bar-paused { background: linear-gradient(180deg, #ffd54f, #f9a825); color: #3e2723; }
body.trk-theme-light .gg-bar-overdue { background: linear-gradient(180deg, #ef5350, #c62828); }
body.trk-theme-light .gg-bar-planned { background: linear-gradient(180deg, #b0bec5, #546e7a); }
body.trk-theme-light .gg-bar-archived { background: linear-gradient(180deg, #cfd8dc, #78909c); }
body.trk-theme-light .legend { background: #ffffff; border-top-color: rgba(0,0,0,0.08); }

/* --- Слайдер прокрутки --- */
.gg-slider-wrap {
    padding: 4px 18px 10px;
    background: var(--pg-card-bg, #1a1a1a);
    border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22));
    border-radius: 14px;
}
.gg-slider-wrap input[type="range"] {
    width: 100%;
    accent-color: var(--pg-accent, #f5d76e);
    cursor: pointer;
}

/* --- Недельный режим: двухслойная шапка --- */
.gg-wk-head { display: flex; flex-direction: column; }
.gg-wk-months, .gg-wk-weeks { display: flex; }
.gg-wk-month {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    height: 26px;
    font-size: 0.72rem; font-weight: 800; text-transform: capitalize;
    letter-spacing: 0.4px;
    color: #0a0a0a;
    border-right: 2px solid rgba(0,0,0,0.25);
}
.gg-wk-week {
    flex: 0 0 auto;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 44px;
    font-size: 0.74rem; font-weight: 700; line-height: 1.05;
    text-align: center;
    color: var(--pg-text, #e8e8e8);
    border-right: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12));
}
.gg-wk-week.today { box-shadow: inset 0 -3px 0 #2ecc71; color: #2ecc71; }
.gg-wk-cell {
    position: absolute; top: 4px; bottom: 4px;
    border-radius: 4px;
    border-right: 1px solid rgba(0,0,0,0.18);
    opacity: 0.95;
    cursor: default;
}
.gg-wk-cell .gg-wk-load-c {
    position: absolute; left: 0; right: 0; bottom: 4px;
    text-align: center;
    font-size: 0.72rem; font-weight: 800;
    color: rgba(0,0,0,0.78);
}
.gg-wk-cell.empty { background: transparent !important; border: none; }
body.trk-theme-light .gg-slider-wrap { background:#fff; }
body.trk-theme-light .gg-wk-week { color:#212121; }

/* --- Колбаски: направление и отображение --- */
.gg-seg-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.gg-seg {
    display: inline-flex; gap: 2px; padding: 3px;
    border-radius: 999px;
    background: rgba(255,255,255,0.07);
    border: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12));
}
.gg-seg button {
    border: none; background: transparent; cursor: pointer;
    padding: 5px 14px; border-radius: 999px;
    font-family: inherit; font-size: 0.8rem; font-weight: 600;
    color: var(--pg-meta, #a0a0a0); white-space: nowrap;
    transition: background .15s, color .15s;
}
.gg-seg button:hover { color: var(--pg-text, #e8e8e8); }
.gg-seg button.active {
    background: #f4f4f4; color: #111;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
}
body.trk-theme-light .gg-seg { background: #dfe3e8; border-color: rgba(0,0,0,0.08); }
body.trk-theme-light .gg-seg button { color: #6b7280; }
body.trk-theme-light .gg-seg button:hover { color: #111; }
body.trk-theme-light .gg-seg button.active { background: #ffffff; color: #111; font-weight: 700; box-shadow: 0 0 0 1px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.16); }
/* Отображение: «Проверки» прячет нагрузку, «Банки» прячет Гант */
body.gg-show-tasks #banksTitle, body.gg-show-tasks #banksBox { display: none !important; }
body.gg-show-banks #ganttBox, body.gg-show-banks #ggLegend, body.gg-show-banks #tasksTitle { display: none !important; }

/* --- Вторая таблица: нагрузка по тер банкам --- */
.banks-title {
    font-size: 1.1rem; font-weight: 800;
    color: var(--pg-accent, #f5d76e);
    padding: 2px 4px;
}
.gg-bank-cell {
    position: absolute; top: 6px; bottom: 6px;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    font-size: 0.82rem; font-weight: 800;
    color: var(--pg-text, #e8e8e8);
    background: var(--pg-input-bg, #232323);
    border: 1px solid var(--pg-card-border-soft, rgba(245,215,110,0.18));
}
/* П.2/П.3: раскрытие банков-участников под названием проверки */
.gg-task-name.gg-expandable { cursor: pointer; user-select: none; }
.gg-task-name.gg-expandable:hover { text-decoration: underline; }
.gg-caret {
    display: inline-block; width: 0.9em; margin-right: 2px;
    font-size: 0.7rem; color: var(--pg-meta, #999);
    transition: transform 0.12s ease;
}
.gg-row.gg-sub-row { background: rgba(255,255,255,0.025); }
.gg-row.gg-sub-row .gg-name { padding-left: 18px; }
.gg-sub-name .gg-sub-bullet { margin-right: 10px; opacity: 0.75; }
.gg-sub-name .gg-task-name { padding-left: 14px; }
.gg-sub-mark { margin-left: auto; flex: 0 0 auto; opacity: 0.92; font-size: 0.95rem; }
.gg-row.gg-sub-lead { background: rgba(245,215,110,0.07); }
.gg-row.gg-sub-lead .gg-task-name { font-weight: 700; }
body.trk-theme-light .gg-row.gg-sub-row { background: rgba(0,0,0,0.03); }
body.trk-theme-light .gg-row.gg-sub-lead { background: rgba(245,215,110,0.14); }
.gg-bank-cell.gg-offday {
    background: repeating-linear-gradient(-45deg, rgba(140,140,140,0.18) 0 6px, rgba(140,140,140,0.08) 6px 12px) !important;
    color: transparent !important;
    text-shadow: none !important;
    border-color: rgba(160,160,160,0.18) !important;
}
body.trk-theme-light .gg-bank-cell.gg-offday {
    background: repeating-linear-gradient(-45deg, rgba(180,180,180,0.30) 0 6px, rgba(230,230,230,0.75) 6px 12px) !important;
    color: transparent !important;
    border-color: rgba(160,160,160,0.35) !important;
}

/* Урезанная модалка редактирования внутри gantt */
.gg-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.48); display: none; align-items: center; justify-content: center; z-index: 2000; padding: 20px; }
.gg-modal-mask.open { display: flex; }
.gg-modal { width: min(1180px, 96vw); max-height: 92vh; overflow: auto; background: var(--pg-card-bg, #1a1a1a); color: var(--pg-text, #e8e8e8); border: 1px solid var(--pg-card-border, rgba(245,215,110,0.22)); border-radius: 16px; box-shadow: 0 18px 60px rgba(0,0,0,0.38); }
.gg-modal-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12)); position: sticky; top: 0; background: inherit; z-index: 2; }
.gg-modal-title { font-size: 1.05rem; font-weight: 800; }
.gg-modal-close { border:1px solid var(--pg-input-border, rgba(245,215,110,0.26)); background: var(--pg-input-bg, #232323); color: var(--pg-text, #e8e8e8); border-radius: 8px; padding: 6px 10px; cursor:pointer; }
.gg-modal-body { padding: 16px 18px 18px; display:flex; flex-direction:column; gap:16px; }
.gg-form-grid { display:grid; grid-template-columns: repeat(12, minmax(0,1fr)); gap: 12px; }
.gg-field { display:flex; flex-direction:column; gap:6px; }
.gg-field label { font-size:0.76rem; text-transform:uppercase; letter-spacing:0.5px; color: var(--pg-meta, #a0a0a0); font-weight:700; }
.gg-span-2 { grid-column: span 2; } .gg-span-3 { grid-column: span 3; } .gg-span-4 { grid-column: span 4; } .gg-span-6 { grid-column: span 6; } .gg-span-10 { grid-column: span 10; } .gg-span-12 { grid-column: span 12; }
.gg-field input[type="text"], .gg-field input[type="date"], .gg-field select { padding: 8px 10px; border-radius: 8px; border:1px solid var(--pg-input-border, rgba(245,215,110,0.26)); background: var(--pg-input-bg, #232323); color: var(--pg-text, #e8e8e8); font-family: inherit; font-size: 0.92rem; }
.gg-field input[readonly] { opacity: 0.85; cursor: default; }
.gg-box { border:1px solid var(--pg-card-border-soft, rgba(245,215,110,0.12)); border-radius: 12px; padding: 12px; background: rgba(255,255,255,0.02); }
.gg-box-title { font-size:0.82rem; font-weight:800; margin:0 0 10px; color: var(--pg-accent, #f5d76e); }
.gg-help { color: var(--pg-meta, #a0a0a0); font-size:0.78rem; font-style: italic; margin-top:4px; }
.gg-check-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:8px 12px; }
.gg-check { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; background: rgba(255,255,255,0.03); }
.gg-check input { margin:0; }
.gg-stage-grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; }
.gg-modal-actions { display:flex; justify-content:flex-end; gap:10px; padding-top: 4px; }
.gg-btn { border:1px solid var(--pg-input-border, rgba(245,215,110,0.26)); background: var(--pg-input-bg, #232323); color: var(--pg-text, #e8e8e8); border-radius: 8px; padding: 8px 12px; cursor:pointer; font-family:inherit; }
.gg-btn-primary { border:none; background: linear-gradient(135deg, var(--pg-accent, #f5d76e), var(--pg-accent-2, #e6a81a)); color:#0a0a0a; font-weight:800; }
.gg-error { display:none; color:#ffb3b3; background: rgba(231,76,60,0.12); border:1px solid rgba(231,76,60,0.24); border-radius:10px; padding:10px 12px; }
.gg-error.open { display:block; }
.gg-saving { opacity: 0.7; pointer-events:none; }
body.trk-theme-light .gg-modal { background:#fbfcfb; color:#13351a; border-color:#cfe1cf; }
body.trk-theme-light .gg-box { background:#f6faf6; }
body.trk-theme-light .gg-check { background:#eef5ee; }
@media (max-width: 980px) { .gg-check-grid, .gg-stage-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .gg-span-2,.gg-span-3,.gg-span-4,.gg-span-6,.gg-span-10 { grid-column: span 12; } }
/* Тепловая заливка по величине нагрузки */
.gg-bank-cell.lvl0 { background: transparent; border-color: transparent; color: var(--pg-meta,#888); }
.gg-bank-cell.lvl1 { background: rgba(129,199,132,0.28); color:#dfeede; }  /* <2 — светло-зелёный */
.gg-bank-cell.lvl2 { background: rgba(255,224,130,0.30); color:#2a2300; }  /* 2..3 — светло-жёлтый */
.gg-bank-cell.lvl3 { background: rgba(239,154,154,0.32); color:#2a0a06; }  /* >=3 — светло-красный */
.gg-bank-total {
    font-weight: 800; color: var(--pg-accent, #f5d76e);
}
body.trk-theme-light .banks-title { color:#1b5e20; }
body.trk-theme-light .gg-bank-cell { color:#212121; background:#f1f3f4; border-color:rgba(0,0,0,0.1); }
body.trk-theme-light .gg-bank-cell.lvl0 { background:transparent; border-color:transparent; color:#999; }
body.trk-theme-light .gg-bank-cell.lvl1 { background:#d7efd8; color:#1b5e20; }
body.trk-theme-light .gg-bank-cell.lvl2 { background:#fff3c4; color:#7a5c00; }
body.trk-theme-light .gg-bank-cell.lvl3 { background:#fcdada; color:#9b1c1c; }

/* ===== Нагрузка по ТБ: % к ёмкости ===== */
body.gg-show-tasks #banksLegend { display: none !important; }
.gg-load-tbl .gg-load-cell { cursor: pointer; background-image: none; }
.gg-load-tbl .gg-load-cell.gg-lp0 { background-color: transparent; border-color: transparent; color: var(--pg-meta,#888); }
.gg-load-tbl .gg-load-cell.gg-lp1, .gg-load-legend .sw.gg-lp1 { background-color: rgba(165,214,167,0.30); border-color: rgba(165,214,167,0.45); color: #dff2df; }
.gg-load-tbl .gg-load-cell.gg-lp2, .gg-load-legend .sw.gg-lp2 { background-color: rgba(67,160,71,0.55); border-color: rgba(67,160,71,0.8); color: #fff; }
.gg-load-tbl .gg-load-cell.gg-lp3, .gg-load-legend .sw.gg-lp3 { background-color: rgba(251,192,45,0.65); border-color: rgba(251,192,45,0.9); color: #2a2000; }
.gg-load-tbl .gg-load-cell.gg-lp4, .gg-load-legend .sw.gg-lp4 { background-color: rgba(239,154,154,0.55); border-color: rgba(239,154,154,0.8); color: #2a0606; }
.gg-load-tbl .gg-load-cell.gg-lp5, .gg-load-legend .sw.gg-lp5 { background-color: #c62828; border: 2px solid #ff5252; color: #fff; box-shadow: 0 0 0 1px #7f0000; }
.gg-load-tbl .gg-load-cell.gg-lpna, .gg-load-legend .sw.gg-lpna { background-color: transparent; border: 1px dashed rgba(160,160,160,0.7); color: var(--pg-text,#e8e8e8); }
.gg-load-tbl .gg-load-cell.gg-offweek, .gg-load-legend .sw.gg-offweek-sw {
    background-image: repeating-linear-gradient(-45deg, rgba(140,140,140,0.16) 0 3px, transparent 3px 10px);
}
.gg-load-legend .sw.gg-offweek-sw { border: 1px solid rgba(160,160,160,0.5); }
.gg-load-tbl .gg-load-cell:hover { outline: 2px solid rgba(46,204,113,0.7); outline-offset: 1px; }
.gg-load-tbl .gg-load-cell.gg-sel { outline: 3px solid #ffffff; outline-offset: 1px; z-index: 4; box-shadow: 0 0 0 5px #1e88e5; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-sel { outline-color: #0d2a5c; box-shadow: 0 0 0 5px #64b5f6; }
.gg-load-tbl .gg-now-col { position: absolute; top: 0; bottom: 0; background: transparent; border-left: 2px solid #2ecc71; border-right: 2px solid #2ecc71; z-index: 2; pointer-events: none; }
.gg-wk-week { position: relative; }
.gg-load-tbl .gg-wk-week.today { justify-content: flex-end; padding-bottom: 3px; }
.gg-wk-week .gg-now-tag { position: absolute; top: 1px; left: 50%; transform: translateX(-50%); font-size: 0.56rem; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; color: #fff; background: #1e9e55; border-radius: 5px; padding: 0 4px; line-height: 1.25; white-space: nowrap; }
.gg-wk-week.gg-wk-off { background-image: repeating-linear-gradient(-45deg, rgba(140,140,140,0.22) 0 4px, transparent 4px 9px); }
.gg-load-tbl .gg-cap-chip { margin-left: auto; flex-shrink: 0; font-size: 0.72rem; font-weight: 700; padding: 1px 7px; border-radius: 10px; background: rgba(46,204,113,0.14); color: #7fdc9f; border: 1px solid rgba(46,204,113,0.35); }
.gg-load-tbl .gg-cap-chip.na { background: transparent; color: var(--pg-meta,#999); border-style: dashed; border-color: rgba(160,160,160,0.6); }
.gg-load-tbl .gg-load-total { border-top: 2px solid rgba(46,204,113,0.55); background: rgba(46,204,113,0.05); }
.gg-load-tbl .gg-load-total .gg-task-name { font-weight: 800; }
.gg-load-tbl .gg-load-total .gg-ico { font-weight: 800; color: #2ecc71; width: 18px; text-align: center; }
.gg-load-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 8px 4px 2px; font-size: 0.8rem; color: var(--pg-text,#e8e8e8); }
.gg-load-legend .it { display: inline-flex; align-items: center; gap: 6px; }
.gg-load-legend .sw { display: inline-block; width: 22px; height: 14px; border-radius: 3px; border: 1px solid transparent; box-sizing: border-box; }
.gg-load-legend .gg-ll-t { font-weight: 700; }
.gg-load-legend .gg-ll-note { flex-basis: 100%; font-size: 0.78rem; color: var(--pg-meta,#b0b0b0); font-style: italic; }
.gg-load-tip { position: fixed; z-index: 2600; display: none; max-width: 320px; padding: 8px 10px; border-radius: 8px; font-size: 0.8rem; line-height: 1.4; pointer-events: none;
    background: #1d2a21; color: #eef6ef; border: 1px solid #2ecc71; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
.gg-load-tip .gg-tip-h { font-weight: 800; }
.gg-load-tip .gg-tip-sub, .gg-load-tip .gg-tip-hint { color: #a9c3ae; font-size: 0.74rem; }
.gg-load-tip .gg-tip-off { color: #c9b27a; }
.gg-neg { color: #ff6b6b; }
.gg-load-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 400px; max-width: 92vw; z-index: 1900; display: flex; flex-direction: column;
    background: var(--pg-card-bg,#1a1a1a); color: var(--pg-text,#e8e8e8); border-left: 3px solid #2ecc71; box-shadow: -8px 0 24px rgba(0,0,0,0.35);
    transform: translateX(105%); transition: transform .18s ease; }
.gg-load-panel.open { transform: translateX(0); }
.gg-lp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 14px 16px 10px; border-bottom: 1px solid rgba(46,204,113,0.3); }
.gg-lp-title { font-size: 1.05rem; font-weight: 800; }
.gg-lp-sub { font-size: 0.8rem; color: var(--pg-meta,#a0a0a0); margin-top: 2px; }
.gg-lp-close { width: 30px; height: 30px; flex-shrink: 0; border-radius: 8px; border: 1px solid rgba(46,204,113,0.45); background: transparent; color: inherit; cursor: pointer; font-size: 0.95rem; }
.gg-lp-close:hover { background: rgba(229,57,53,0.15); border-color: #e53935; color: #e53935; }
.gg-lp-body { overflow-y: auto; padding: 12px 16px 18px; }
.gg-lp-sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
.gg-lp-sum > div { background: var(--pg-inner-bg,#232323); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.gg-lp-sum span { font-size: 0.7rem; color: var(--pg-meta,#a0a0a0); }
.gg-lp-sum b { font-size: 1rem; }
.gg-lp-pct { border-radius: 5px; padding: 0 4px; align-self: flex-start; }
.gg-lp-pct.gg-lp1 { background: rgba(165,214,167,0.35); } .gg-lp-pct.gg-lp2 { background: rgba(67,160,71,0.55); color:#fff; }
.gg-lp-pct.gg-lp3 { background: rgba(251,192,45,0.7); color:#2a2000; } .gg-lp-pct.gg-lp4 { background: rgba(229,57,53,0.6); color:#fff; }
.gg-lp-pct.gg-lp5 { background: rgba(229,57,53,0.85); color:#fff; outline: 2px solid #b71c1c; }
.gg-lp-note { font-size: 0.78rem; color: #c9b27a; margin: 4px 0; }
.gg-lp-sec { font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; color: var(--pg-meta,#a0a0a0); margin: 12px 0 6px; }
.gg-lp-empty { font-size: 0.82rem; color: var(--pg-meta,#a0a0a0); }
.gg-lp-item { background: var(--pg-inner-bg,#232323); border-radius: 8px; padding: 7px 9px; margin-bottom: 6px; border-left: 3px solid #2ecc71; }
.gg-lp-item.idle { opacity: 0.88; border-left-color: #7f8c8d; }
.gg-lp-row1 { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.gg-lp-name { font-weight: 700; font-size: 0.86rem; word-break: break-word; }
.gg-lp-val { font-size: 0.95rem; }
.gg-lp-row2 { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0 2px; }
.gg-lp-st { color: #fff; border-radius: 9px; padding: 0 7px; font-size: 0.7rem; font-weight: 700; }
.gg-lp-tag { border-radius: 9px; padding: 0 7px; font-size: 0.72rem; background: rgba(255,255,255,0.16); color: #ffffff; font-weight: 600; }
body.trk-theme-light .gg-lp-tag { background: #dde7dd; color: #13351a; }
.gg-lp-part { font-size: 0.76rem; color: var(--pg-meta,#b0b0b0); }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp0 { background-color: transparent; border-color: transparent; color: #999; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp1, body.trk-theme-light .gg-load-legend .sw.gg-lp1 { background-color: #dcf1dd; border-color: #b9e0bb; color: #1b5e20; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp2, body.trk-theme-light .gg-load-legend .sw.gg-lp2 { background-color: #81c784; border-color: #5fb563; color: #0d3b12; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp3, body.trk-theme-light .gg-load-legend .sw.gg-lp3 { background-color: #ffe082; border-color: #f4c430; color: #5c4300; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp4, body.trk-theme-light .gg-load-legend .sw.gg-lp4 { background-color: #f8bbbb; border-color: #ef9a9a; color: #7f0000; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lp5, body.trk-theme-light .gg-load-legend .sw.gg-lp5 { background-color: #d32f2f; border: 2px solid #7f0000; color: #fff; box-shadow: 0 0 0 1px #ffcdd2; }
body.trk-theme-light .gg-load-tbl .gg-load-cell.gg-lpna, body.trk-theme-light .gg-load-legend .sw.gg-lpna { background-color: transparent; border: 1px dashed #9e9e9e; color: #333; }
body.trk-theme-light .gg-load-tbl .gg-cap-chip { background: #e8f5e9; color: #1b5e20; border-color: #a5d6a7; }
body.trk-theme-light .gg-load-legend { color: #213a25; }
body.trk-theme-light .gg-load-tip { background: #ffffff; color: #13351a; box-shadow: 0 6px 18px rgba(0,0,0,0.18); }
body.trk-theme-light .gg-load-tip .gg-tip-sub, body.trk-theme-light .gg-load-tip .gg-tip-hint { color: #5d7a63; }
body.trk-theme-light .gg-load-panel { background: #fbfcfb; color: #13351a; }
body.trk-theme-light .gg-lp-sum > div, body.trk-theme-light .gg-lp-item { background: #eef5ee; }
body.trk-theme-light .gg-lp-part { color: #4d6b52; }
body.trk-theme-light .gg-lp-note { color: #8a6d1f; }
body.trk-theme-light .gg-neg { color: #c62828; }

@media (max-width: 700px) {
    .gg-corner, .gg-name { flex-basis: 220px; width: 220px; }
    .gg-bg { left: 220px; }
    .head { padding: 12px 14px; }
    .head h1 { font-size: 1.05rem; }
}

/* ===== Этап 3: панель управления нагрузкой, KPI, ручные правки ===== */
.gg-load-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 4px 4px 6px; }
.gg-plan-tgl { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--pg-meta, #a0a0a0); cursor: pointer; user-select: none; }
.gg-plan-tgl input { accent-color: #7e57c2; width: 15px; height: 15px; cursor: pointer; }
.gg-xls-btn { margin-left: auto; border: 1px solid rgba(46,204,113,0.55); background: rgba(46,204,113,0.10); color: var(--pg-text, #e8e8e8); border-radius: 8px; padding: 5px 12px; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
.gg-xls-btn:hover { background: rgba(46,204,113,0.22); }
.gg-xls-btn:disabled { opacity: .6; cursor: wait; }
body.trk-theme-light .gg-plan-tgl { color: #4b5563; }
body.trk-theme-light .gg-xls-btn { color: #14532d; background: #ecfdf3; border-color: #86d6a6; }
/* плашка статистики видна во всех режимах */
.gg-kpi { margin: 0 4px 8px; }
.gg-kpi-cards { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 8px; }
.gg-kpi-card { border: 1px solid var(--pg-card-border-soft, rgba(255,255,255,0.10)); background: var(--pg-card-bg, #1a1a1a); border-radius: 10px; padding: 8px 12px; }
.gg-kpi-card.bad { border-color: rgba(229,57,53,0.75); box-shadow: inset 3px 0 0 #e53935; }
.gg-kpi-card.ok { box-shadow: inset 3px 0 0 #43a047; }
.gg-kpi-lbl { font-size: 0.72rem; color: var(--pg-meta, #a0a0a0); font-weight: 600; }
.gg-kpi-val { font-size: 1.25rem; font-weight: 800; margin: 2px 0; }
.gg-kpi-sub { font-size: 0.72rem; color: var(--pg-meta, #a0a0a0); }
.gg-kpi-warn { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; font-size: 0.78rem; }
.gg-kpi-warn-t { font-weight: 700; color: #ef5350; }
.gg-kpi-chip { border: 1px solid rgba(229,57,53,0.6); background: rgba(229,57,53,0.12); color: inherit; border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 0.76rem; cursor: pointer; }
.gg-kpi-chip:hover { background: rgba(229,57,53,0.25); }
.gg-kpi-okline { margin-top: 6px; font-size: 0.78rem; color: #43a047; font-weight: 600; }
body.trk-theme-light .gg-kpi-card { background: #fff; border-color: #e5e7eb; }
@media (max-width: 900px) { .gg-kpi-cards { grid-template-columns: repeat(2, 1fr); } }
/* ячейки: предварительные (уголок), ручные (✎), протягивание */
.gg-load-tbl .gg-load-cell.gg-has-plan::before { content: ''; position: absolute; left: 0; top: 0; border-style: solid; border-width: 10px 10px 0 0; border-color: #b388ff transparent transparent transparent; border-top-left-radius: 3px; filter: drop-shadow(0 0 1px rgba(0,0,0,0.6)); }
.gg-load-tbl .gg-load-cell.gg-man { box-shadow: inset 0 0 0 2px #7986cb; }
.gg-load-tbl .gg-load-cell.gg-man::after { content: '✎'; position: absolute; right: 2px; top: 1px; width: 12px; height: 12px; line-height: 12px; text-align: center; border-radius: 50%; background: #3949ab; color: #fff; font-size: 9px; font-style: normal; font-weight: 700; }
.gg-load-tbl .gg-load-cell.gg-neg-free { color: #b71c1c; font-weight: 800; }
.gg-load-tbl .gg-load-cell.gg-lp5.gg-neg-free { color: #fff; }
.gg-fill-h { position: absolute; right: -1px; bottom: -1px; width: 8px; height: 8px; background: #2e7d32; border: 1px solid #fff; border-radius: 2px; cursor: crosshair; display: none; z-index: 3; }
.gg-load-tbl .gg-load-cell:hover .gg-fill-h { display: block; }
.gg-load-tbl .gg-load-cell.gg-fill-sel { outline: 2px dashed #2e7d32 !important; outline-offset: -1px; }
body.gg-filling, body.gg-filling * { cursor: crosshair !important; user-select: none !important; }
.gg-load-legend .sw.gg-plan-sw { position: relative; background: transparent; border: 1px solid rgba(160,160,160,0.6); overflow: hidden; }
.gg-load-legend .sw.gg-plan-sw::before { content: ''; position: absolute; left: 0; top: 0; border-style: solid; border-width: 10px 10px 0 0; border-color: #b388ff transparent transparent transparent; }
.gg-load-legend .sw.gg-man-sw { background: #3949ab; box-shadow: inset 0 0 0 2px #7986cb; font-size: 9px; line-height: 12px; text-align: center; color: #fff; font-weight: 700; }
/* панель: ручная правка */
.gg-lp-man { margin: 10px 0 4px; padding: 8px 10px; border: 1px dashed rgba(92,107,192,0.7); border-radius: 8px; }
.gg-lp-man-h { font-size: 0.78rem; font-weight: 700; margin-bottom: 6px; }
.gg-lp-man-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.gg-lp-man-row input { width: 80px; padding: 4px 6px; border-radius: 6px; border: 1px solid rgba(160,160,160,0.6); background: transparent; color: inherit; font: inherit; }
.gg-lp-btn { border: 1px solid rgba(92,107,192,0.7); background: rgba(92,107,192,0.15); color: inherit; border-radius: 6px; padding: 4px 10px; font: inherit; font-size: 0.78rem; cursor: pointer; }
.gg-lp-btn:hover { background: rgba(92,107,192,0.3); }
.gg-lp-man-hint { font-size: 0.72rem; color: var(--pg-meta, #a0a0a0); margin-top: 5px; }
.gg-flash { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 30000; background: #fff; color: #14532d; border: 3px solid #2e7d32; border-radius: 12px; padding: 14px 24px; font-weight: 700; box-shadow: 0 10px 40px rgba(0,0,0,0.35); display: none; }
.gg-flash.bad { color: #7f1d1d; border-color: #c62828; }

/* Таблица проверок в 2 раза ниже (компактно) */
#ganttBox .gg-mode-week .gg-row, #ganttBox .gg-mode-week .gg-track { height: 35px; }
#ganttBox .gg-mode-day .gg-row, #ganttBox .gg-mode-day .gg-track { height: 22px; }
#ganttBox .gg-mode-day .gg-bar { height: 16px; border-radius: 5px; padding: 0 8px; font-size: 0.72rem; }
#ganttBox .gg-wk-cell, #ganttBox .gg-mo-cell { top: 3px; bottom: 3px; }
#ganttBox .gg-wk-cell .gg-wk-load-c { bottom: auto; top: 50%; transform: translateY(-50%); font-size: 0.66rem; }
#ganttBox .gg-bank-cell { top: 3px; bottom: 3px; font-size: 0.7rem; }
#ganttBox .gg-mode-day .gg-bank-cell { top: 2px; bottom: 2px; font-size: 0.62rem; }
#ganttBox .gg-mode-day .gg-edit { font-size: 0.72rem; padding: 0 4px; line-height: 1.2; }
#ganttBox .gg-mode-day .gg-task-name { font-size: 0.76rem; }
#tasksTitle { margin-top: 10px; }
/* ручная правка нагрузки по проверке */
body.gg-can-ov #ganttBox .gg-task-row .gg-track, body.gg-can-ov #ganttBox .gg-sub-row .gg-track { cursor: cell; }
#ganttBox .gg-wk-cell.gg-man, #ganttBox .gg-bank-cell.gg-man, #ganttBox .gg-mo-cell.gg-man { outline: 2px solid #3949ab; outline-offset: -2px; }
#ganttBox .gg-wk-cell.gg-man::after, #ganttBox .gg-bank-cell.gg-man::after { content: '✎'; position: absolute; right: 1px; top: 0; font-size: 9px; color: #fff; background: #3949ab; border-radius: 50%; width: 11px; height: 11px; line-height: 11px; text-align: center; }
.gg-tov { max-width: 560px; width: 100%; }
.gg-tov-sub { font-size: 0.8rem; color: var(--pg-meta, #a0a0a0); margin: -4px 0 10px; }
.gg-tov-row { display: grid; grid-template-columns: 1fr 90px 90px 28px; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(160,160,160,0.18); font-size: 0.85rem; }
.gg-tov-row.h { font-weight: 700; font-size: 0.74rem; color: var(--pg-meta, #a0a0a0); }
.gg-tov-row input { width: 80px; padding: 4px 6px; border-radius: 6px; border: 1px solid rgba(160,160,160,0.6); background: transparent; color: inherit; font: inherit; }
.gg-tov-row input.man { border-color: #3949ab; box-shadow: 0 0 0 1px #3949ab; }
.gg-tov-rs { cursor: pointer; border: none; background: transparent; color: inherit; font-size: 0.95rem; opacity: .7; }
.gg-tov-rs:hover { opacity: 1; }
.gg-tov-hint { font-size: 0.74rem; color: var(--pg-meta, #a0a0a0); margin-top: 8px; }
.gg-lp-ov-btn { margin-top: 4px; border: 1px solid rgba(92,107,192,0.7); background: rgba(92,107,192,0.15); color: inherit; border-radius: 6px; padding: 2px 8px; font: inherit; font-size: 0.74rem; cursor: pointer; }
.gg-lp-ov-btn:hover { background: rgba(92,107,192,0.3); }
.gg-cf-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; z-index: 2600; }
.gg-cf-box { background: #fff; color: #13351a; border: 3px solid #2e7d32; border-radius: 14px; padding: 18px 22px; max-width: 560px; width: calc(100% - 40px); max-height: 80vh; overflow: auto; box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
.gg-cf-box h3 { margin: 0 0 10px; font-size: 1rem; }
.gg-cf-box ul { margin: 0 0 12px; padding-left: 18px; font-size: 0.86rem; line-height: 1.45; }
.gg-cf-q { font-weight: 700; margin: 6px 0 12px; }
.gg-cf-act { display: flex; gap: 10px; justify-content: flex-end; }
.gg-cf-act button { border-radius: 8px; padding: 6px 18px; font: inherit; font-weight: 700; cursor: pointer; border: 1px solid #2e7d32; }
.gg-cf-yes { background: #2e7d32; color: #fff; }
.gg-cf-no { background: #fff; color: #2e7d32; }
body:not(.trk-theme-light) .gg-cf-box { background: #1d241e; color: #e6efe7; }
body:not(.trk-theme-light) .gg-cf-no { background: transparent; color: #8fd19e; }
/* шаг «Месяцы» */
.gg-mode-week .gg-mo-cell { position: absolute; top: 4px; bottom: 4px; border-radius: 4px; overflow: hidden; display: flex; }
.gg-mo-cell > i { flex: 1 1 0; height: 100%; display: block; }
.gg-mo-cell > i[style] + i[style] { border-left: 1px solid rgba(0,0,0,0.35); }
</style>
</head>
<body>
<div class="wrap">
    <div class="head">
        <div class="head-top">
            <a class="back" href="/">← К трекеру</a>
            <h1>📅 Текущая загрузка</h1>
        </div>
        <div class="head-filters">
            <div class="ms-dd-group" id="fKindGroup">
                <span class="ms-dd-label">Направление</span>
                <div class="ms-dd" id="fKindDD">
                    <button type="button" class="ms-dd-btn" id="fKindBtn">Аудиторская проверка</button>
                    <div class="ms-dd-panel" id="fKindPanel"></div>
                </div>
            </div>
            <select id="fType" style="display:none;" aria-hidden="true">
                <option value="">Все типы проверок</option>
                <option value="розничная">Розничная</option>
                <option value="розничная_без_пвр">Розничная без ПВР</option>
                <option value="корпоративная">Корпоративная</option>
            </select>
            <div class="ms-dd" id="fPocketDD">
                <button type="button" class="ms-dd-btn" id="fPocketBtn">Все карманы</button>
                <div class="ms-dd-panel" id="fPocketPanel"></div>
            </div>
            <div class="ms-dd" id="fDeptDD">
                <button type="button" class="ms-dd-btn" id="fDeptBtn">Все тер банки</button>
                <div class="ms-dd-panel" id="fDeptPanel"></div>
            </div>
            <select id="fTeam"><option value="">Все команды</option></select>
            <label>С <input type="date" id="fFrom"></label>
            <label>По <input type="date" id="fTo"></label>
            <select id="fStatus">
                <option value="">Все статусы</option>
                <option value="active">Активные</option>
                <option value="paused">Приостановленные</option>
                <option value="done">Выполненные</option>
                <option value="archived">Архив</option>
            </select>
            <label>Вид <select id="fView">
                <option value="week">Недели</option>
                <option value="day">Дни</option>
                <option value="month">Месяцы</option>
            </select></label>
            <button class="apply" id="fApply">✓ Показать</button>
        </div>
        <div class="gg-seg-row">
            <div class="gg-seg" id="ggTypeSeg" role="group" aria-label="Направление">
                <button type="button" data-v="">Всего ОАМ</button>
                <button type="button" data-v="корпоративная">Корпоративное</button>
                <button type="button" data-v="розничная">Розничное с ПВР</button>
                <button type="button" data-v="розничная_без_пвр">Розничное без ПВР</button>
            </div>
            <div class="gg-seg" id="ggShowSeg" role="group" aria-label="Отображение">
                <button type="button" data-v="banks">Банки</button>
                <button type="button" data-v="tasks">Проверки</button>
                <button type="button" data-v="all">Все</button>
            </div>
        </div>
    </div>
    <div class="gg-load-bar" id="ggLoadBar">
        <div class="gg-seg" id="ggMetricSeg" role="group" aria-label="Показатель">
            <button type="button" data-v="load">Загрузка</button>
            <button type="button" data-v="free">Свободно</button>
            <button type="button" data-v="pct">%</button>
        </div>
        <div class="gg-seg" id="ggHcSeg" role="group" aria-label="Численность">
            <button type="button" data-v="norm" title="Ёмкость = экспертный коэффициент × нормативная численность">Нормативная</button>
            <button type="button" data-v="fact" title="Ёмкость = экспертный коэффициент × фактическая численность (работающие сотрудники)">Фактическая</button>
        </div>
        <label class="gg-plan-tgl" title="Учитывать проверки в статусе «Планирование»"><input type="checkbox" id="ggPlanChk"> с предварительными</label>
        <button type="button" class="gg-xls-btn" id="ggXlsBtn" title="Выгрузить таблицу в Excel">⬇ Excel</button>
    </div>
    <div class="gg-kpi" id="ggKpi" style="display:none;"></div>
    <div class="gg-slider-wrap" id="ggSliderWrap" style="display:none;">
        <input type="range" id="ggSlider" min="0" max="1000" value="0" step="1">
    </div>
    <div class="banks-title" id="banksTitle" style="display:none;">Нагрузка по ТБ</div>
    <div class="gantt-box" id="banksBox" style="display:none;">
        <div class="loading">Загрузка…</div>
    </div>
    <div class="gg-load-legend" id="banksLegend" style="display:none;">
        <span class="gg-ll-t">% к ёмкости:</span>
        <span class="it"><span class="sw gg-lp1"></span>0–50%</span>
        <span class="it"><span class="sw gg-lp2"></span>50–75%</span>
        <span class="it"><span class="sw gg-lp3"></span>75–100%</span>
        <span class="it"><span class="sw gg-lp4"></span>100–125%</span>
        <span class="it"><span class="sw gg-lp5"></span>&gt;125%</span>
        <span class="it"><span class="sw gg-lpna"></span>ёмкость не задана</span>
        <span class="it"><span class="sw gg-offweek-sw"></span>нерабочая неделя</span>
        <span class="it"><span class="sw gg-plan-sw"></span>есть предварительные</span>
        <span class="it"><span class="sw gg-man-sw">✎</span>задано вручную</span>
        <span class="gg-ll-note">Ёмкость = экспертный коэффициент × нормативная численность. Наведите на ячейку — подробности, клик — список проверок.</span>
    </div>
    <div class="banks-title" id="tasksTitle">Проверки</div>
    <div class="gantt-box" id="ganttBox">
        <div class="loading">Загрузка…</div>
    </div>
    <div class="legend" id="ggLegend">
        <div class="it"><span class="sw active"></span>В работе</div>
        <div class="it"><span class="sw done"></span>Готово</div>
        <div class="it"><span class="sw paused"></span>Приостановлено</div>
        <div class="it"><span class="sw overdue"></span>Просрочено</div>
        <div class="it"><span class="sw archived"></span>Архив</div>
        <div class="it" style="margin-left:auto;font-style:italic;">Сегодняшний день выделен зелёным</div>
    </div>
    <div class="gg-modal-mask" id="ggTaskMask">
    <div class="gg-modal" role="dialog" aria-modal="true" aria-labelledby="ggTaskTitle">
        <div class="gg-modal-head">
            <div class="gg-modal-title" id="ggTaskTitle">Редактирование проверки</div>
            <button type="button" class="gg-modal-close" id="ggTaskClose">✕</button>
        </div>
        <div class="gg-modal-body" id="ggTaskBody">
            <div class="gg-error" id="ggTaskErr"></div>
            <div class="gg-form-grid">
                <div class="gg-field gg-span-2"><label>Иконка</label><input type="text" id="ggFIcon" maxlength="8"></div>
                <div class="gg-field gg-span-10"><label>Название</label><input type="text" id="ggFName" readonly></div>
                <div class="gg-field gg-span-3"><label>Направление</label><select id="ggFType"><option value="">Выберите направление</option><option value="розничная">Розничная</option><option value="корпоративная">Корпоративная</option></select></div>
                <div class="gg-field gg-span-3"><label>Карман</label><input type="text" id="ggFPocket" maxlength="200"></div>
            </div>
            <div class="gg-box">
                <div class="gg-box-title">Этапы задачи</div>
                <div class="gg-stage-grid" id="ggStages"></div>
                <div class="gg-help">Указывается только дата начала этапа. Конец подтягивается автоматически на сервере; у последнего этапа — дедлайн задачи.</div>
            </div>
            <div class="gg-box">
                <div class="gg-box-title">Отделы / тер банки</div>
                <div class="gg-check-grid" id="ggDeptChecks"></div>
            </div>
            <div class="gg-box">
                <div class="gg-box-title">Назначено</div>
                <div class="gg-check-grid" id="ggAssignChecks"></div>
            </div>
            <div class="gg-box">
                <div class="gg-box-title">Руководитель проверки</div>
                <div class="gg-form-grid">
                    <div class="gg-field gg-span-6"><label>Банк-руководитель *</label><select id="ggFLeadDept"></select></div>
                    <div class="gg-field gg-span-6"><label>Сотрудник</label><select id="ggFLeadEmp"></select></div>
                </div>
            </div>
            <div class="gg-modal-actions">
                <button type="button" class="gg-btn" id="ggTaskCancel">Отмена</button>
                <button type="button" class="gg-btn gg-btn-primary" id="ggTaskSave">Сохранить</button>
            </div>
        </div>
    </div>
</div>
</div>

<script>
(function(){
'use strict';

var DAY_W = 44;
var ROW_H = 42;
var NAME_W = 320;
var DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
}
function fmtD(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1];
}
function isoAddDays(iso, n) {
    // PATCH v1.0.5: не используем toISOString (UTC-сдвиг на день)
    var p = iso.split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    d.setDate(d.getDate() + n);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
}

/* Инициализация диапазона — полгода от понедельника текущей недели */
function initDates() {
    var t = new Date();
    var wd = t.getDay();
    var diff = (wd === 0) ? -6 : (1 - wd);
    var mon = new Date(t.getTime() + diff * 86400000);
    var end = new Date(mon.getFullYear(), mon.getMonth() + 6, mon.getDate());
    // PATCH v1.0.5: toISOString даёт UTC-сдвиг; пишем вручную
    var iso = function(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + dd;
    };
    document.getElementById('fFrom').value = iso(mon);
    document.getElementById('fTo').value = iso(end);
}

var WEEK_W = 46;         /* ширина недельной колонки (уже, подпись в 2 строки) */
var MONTH_COLORS = ['#3b5ba5','#2e8b7a','#a5683b','#6a4ba5','#a53b5b','#5b8b2e','#8b7a2e','#2e6aa5','#a53b8b','#4ba58b','#a5a53b','#7a2ea5'];
var MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

/* ISO-понедельник недели, в которую попадает дата iso */
function mondayOf(iso) {
    var p = iso.split('-');
    var d = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10));
    var wd = d.getDay();
    var diff = (wd === 0) ? -6 : (1 - wd);
    d.setDate(d.getDate() + diff);
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+dd;
}
/* Список недель (понедельников) перекрывающих диапазон days[] */
function buildWeeks(days) {
    if (!days.length) return [];
    var first = mondayOf(days[0]);
    var lastMon = mondayOf(days[days.length-1]);
    var weeks = [];
    var cur = first;
    var guard = 0;
    while (cur <= lastMon && guard < 520) {
        var sun = isoAddDays(cur, 6);
        weeks.push({ mon: cur, sun: sun });
        cur = isoAddDays(cur, 7);
        guard++;
    }
    return weeks;
}
/* Этап, активный в понедельник недели: stage.start <= mon <= stage.end */
function stageAtMonday(stages, mon) {
    if (!stages) return null;
    for (var i = 0; i < stages.length; i++) {
        var st = stages[i];
        if (!st.start) continue;
        var end = st.end || st.start;
        if (st.start <= mon && mon <= end) return st;
    }
    return null;
}

/* П.2: коэффициент руководителя проверки.
   Применяется ТОЛЬКО к банку-руководителю этой задачи:
   розничная -> x2, корпоративная -> x1.5, иначе (или рядовой банк) -> x1. */
function leadCoef(task, bankId) {
    if (!task || !bankId) return 1;
    if ((task.lead_department || '') !== bankId) return 1;
    var tp = task.task_type || '';
    if (tp === 'розничная') return 2;
    if (tp === 'корпоративная') return 1.5;
    return 1;
}
/* Нагрузка задачи в неделю для КОНКРЕТНОГО банка (с учётом коэффициента). */
function taskBankLoadAtMonday(task, bankId, mon) {
    var _ov = ggTovGet(task.id, bankId, mondayOf(mon));
    if (_ov != null) return _ov;
    var st = stageAtMonday(task.stages, mon);
    if (!st) return 0;
    var wt = (st.weight != null ? st.weight : 1);
    return wt * leadCoef(task, bankId);
}
function round2(v) { return Math.round(v * 100) / 100; }

/* Множество раскрытых задач (id). Клик по названию переключает. */
var ggExpanded = {};
var ggDeptNames = {};
var ggHolidays = {};
/* Ручные правки нагрузки по конкретной проверке: ключ task|bank|понедельник */
var ggTaskOv = {}, ggTaskOvAny = {}, ggTasksById = {}, ggCanOv = false;
function ggTovGet(tid, did, mon) { var k = tid + '|' + did + '|' + mon; return ggTaskOv.hasOwnProperty(k) ? ggTaskOv[k] : null; }
function ggTovAny(tid, mon) { return !!ggTaskOvAny[tid + '|' + mon]; }
/* Расчётная нагрузка проверки на банк в неделю (без ручной правки) */
function ggTaskCalcAt(t, did, mon) {
    if ((t.task_kind || 'audit') === 'other') {
        var lc = (t.load_coef != null ? +t.load_coef : 0) || 0;
        if (lc <= 0) return 0;
        if (t.start_date && mon < mondayOf(t.start_date)) return 0;
        if (t.deadline && mon > t.deadline) return 0;
        return lc;
    }
    var st = stageAtMonday(t.stages, mon);
    if (!st) return 0;
    return (st.weight != null ? +st.weight : 1) * leadCoef(t, did);
}
function ggPeriodWeeks(mode, p) {
    if (mode === 'week') return [p.mon];
    if (mode === 'month') return (p.mons || []).slice();
    return [mondayOf(p)];
}
var ggTaskState = { loaded:false, tasksById:{}, employees:[], departments:[] };
var ggTaskCurrent = null;
var GG_STAGE_ORDER = ['подготовка','проверка_нжя','проверка_соглЦА','ос_проф','реализация_возражения','реализация_согласования','запас','оценка_тб'];
var GG_STAGE_LABELS = { 'подготовка':'Подготовка', 'проверка_нжя':'Проверка НЖЯ', 'проверка_соглЦА':'Проверка согл. ЦА', 'ос_проф':'ОС проф.', 'реализация_возражения':'Реализация возражения', 'реализация_согласования':'Реализация согласования', 'запас':'Запас', 'оценка_тб':'Оценка ТБ' };

function isOffDay(iso) {
    if (!iso) return false;
    var dt = new Date(iso + 'T00:00:00');
    var wd = dt.getDay();
    return wd === 0 || wd === 6 || !!ggHolidays[iso];
}

/* Подстроки «банки-участники» задачи для верхней таблицы.
   mode='week' -> периоды=weeks (у каждого .mon), mode='day' -> периоды=days (iso).
   Для каждого банка задачи выводим его нагрузку по периодам с коэффициентом
   руководителя (у банка-руководителя 👑 и бонус x2/x1.5). cellW — ширина колонки. */
function participantRowsHtml(t, periods, mode, trackW, cellW) {
    if (!ggExpanded[t.id]) return '';
    var dids = t.dept_ids || [];
    if (!dids.length) return '';
    var lead = t.lead_department || '';
    /* руководитель первым, остальные по алфавиту имени */
    var ordered = dids.slice().sort(function(a, b) {
        if (a === lead && b !== lead) return -1;
        if (b === lead && a !== lead) return 1;
        var na = ggDeptNames[a] || a, nb = ggDeptNames[b] || b;
        return na.localeCompare(nb, 'ru');
    });
    var html = '';
    ordered.forEach(function(did) {
        var isLead = (did === lead);
        var nm = ggDeptNames[did] || did;
        html += '<div class="gg-row gg-sub-row' + (isLead ? ' gg-sub-lead' : '') + '" data-tid="' + esc(t.id) + '" data-bank="' + esc(did) + '">';
        html +=   '<div class="gg-name gg-sub-name">';
        html +=     '<span class="gg-sub-bullet">•</span>';
        html +=     '<span class="gg-task-name" title="' + esc(nm) + '">' + esc(nm) + '</span>';
        html +=     '<span class="gg-sub-mark">' + (isLead ? '\ud83d\udc51' : '\ud83d\ude42') + '</span>';
        html +=   '</div>';
        html +=   '<div class="gg-track" style="width:' + trackW + 'px">';
        periods.forEach(function(p, i) {
            var mon = (mode === 'week') ? p.mon : p;
            var v = taskBankLoadAtMonday(t, did, mon);
            if (v <= 0) return;
            var txt = round2(v).toString();
            var lvl = v >= 3 ? 3 : (v < 2 ? 1 : 2);
            var _isMan = ggTovGet(t.id, did, mondayOf(mon)) != null;
            html += '<div class="gg-bank-cell lvl' + lvl + (_isMan ? ' gg-man' : '') + '" style="left:' + (i * cellW + 2) +
                    'px;width:' + (cellW - 4) + 'px" title="' + esc(nm) +
                    (isLead ? ' 👑' : '') + ' · нагрузка ' + txt + (_isMan ? ' · ✎ задано вручную' : '') + '">' + txt + '</div>';
        });
        html +=   '</div>';
        html += '</div>';
    });
    return html;
}

/* ---- Мультивыбор (Excel-стиль, чекбоксы) для карман / тер банк ---- */
/* Состояние: Set выбранных значений. Пусто = «все». */
var msSelected = { dept: {}, pocket: {}, kind: { audit: true } };
/* Справочник доступных пунктов: [{value,label}] */
var msOptions  = { dept: [], pocket: [], kind: [
    { value: 'audit', label: 'Аудиторская проверка' },
    { value: 'other', label: 'Другое' }
] };
/* Конфиг панелей мультивыбора: id панели/кнопки и подпись «все». */
var MS_CFG = {
    dept:   { panel: 'fDeptPanel',   btn: 'fDeptBtn',   all: 'Все тер банки' },
    pocket: { panel: 'fPocketPanel', btn: 'fPocketBtn', all: 'Все карманы' },
    kind:   { panel: 'fKindPanel',   btn: 'fKindBtn',   all: 'Все типы задач' }
};

function msRenderPanel(kind) {
    var cfg = MS_CFG[kind] || {};
    var panelId = cfg.panel;
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var opts = msOptions[kind] || [];
    if (!opts.length) {
        panel.innerHTML = '<div class="ms-dd-empty">Нет вариантов</div>';
        return;
    }
    var html = '';
    opts.forEach(function(o) {
        var checked = msSelected[kind][o.value] ? ' checked' : '';
        html += '<label class="ms-dd-item">' +
                '<input type="checkbox" value="' + esc(o.value) + '"' + checked + '>' +
                '<span>' + esc(o.label) + '</span></label>';
    });
    panel.innerHTML = html;
    // Клик внутри панели не должен закрывать её (мультивыбор подряд).
    panel.addEventListener('click', function(e) { e.stopPropagation(); });
    panel.querySelectorAll('input[type=checkbox]').forEach(function(cb) {
        cb.addEventListener('change', function() {
            if (cb.checked) msSelected[kind][cb.value] = true;
            else delete msSelected[kind][cb.value];
            msUpdateBtn(kind);
            load();
        });
    });
}

function msUpdateBtn(kind) {
    var cfg = MS_CFG[kind] || {};
    var btn = document.getElementById(cfg.btn);
    if (!btn) return;
    var sel = Object.keys(msSelected[kind]);
    var allLabel = cfg.all || 'Все';
    if (!sel.length) { btn.textContent = allLabel; return; }
    if (sel.length === 1) {
        var o = (msOptions[kind] || []).find(function(x) { return x.value === sel[0]; });
        btn.textContent = o ? o.label : sel[0];
        return;
    }
    btn.textContent = 'Выбрано: ' + sel.length;
}

function msSetOptions(kind, opts) {
    msOptions[kind] = opts || [];
    // убираем из выбранного то, чего больше нет в списке
    var valid = {};
    msOptions[kind].forEach(function(o) { valid[o.value] = true; });
    Object.keys(msSelected[kind]).forEach(function(v) {
        if (!valid[v]) delete msSelected[kind][v];
    });
    msRenderPanel(kind);
    msUpdateBtn(kind);
}

function msGetSelected(kind) { return Object.keys(msSelected[kind]); }

/* Открытие/закрытие панелей по клику на кнопку и клику вне */
function msInit() {
    [['fKindDD','fKindBtn'], ['fDeptDD','fDeptBtn'], ['fPocketDD','fPocketBtn']].forEach(function(pair) {
        var dd = document.getElementById(pair[0]);
        var btn = document.getElementById(pair[1]);
        if (!dd || !btn) return;
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var wasOpen = dd.classList.contains('open');
            document.querySelectorAll('.ms-dd.open').forEach(function(x) { x.classList.remove('open'); });
            if (!wasOpen) dd.classList.add('open');
        });
    });
    document.addEventListener('click', function() {
        document.querySelectorAll('.ms-dd.open').forEach(function(x) { x.classList.remove('open'); });
    });
}

function ggTaskMask(){ return document.getElementById('ggTaskMask'); }
function ggTaskErr(msg) {
    var e = document.getElementById('ggTaskErr');
    if (!msg) { e.classList.remove('open'); e.textContent = ''; return; }
    e.textContent = msg; e.classList.add('open');
}
function ggNormList(v) { return Array.isArray(v) ? v.slice() : []; }
function ggTaskClone(o) { return JSON.parse(JSON.stringify(o || {})); }
function ggTaskSelectedChecks(boxId) {
    return Array.from(document.querySelectorAll('#' + boxId + ' input[type="checkbox"]:checked')).map(function(x){ return x.value; });
}
function ggTaskBuildStages(stages) {
    var box = document.getElementById('ggStages'); box.innerHTML = '';
    GG_STAGE_ORDER.forEach(function(k){
        var v = ''; (stages || []).forEach(function(st){ if (st && st.key === k) v = st.start || ''; });
        box.insertAdjacentHTML('beforeend', '<div class="gg-field"><label>' + esc(GG_STAGE_LABELS[k] || k) + '</label><input type="date" data-stage-key="' + esc(k) + '" value="' + esc(v) + '"></div>');
    });
}
function ggTaskBuildDeptChecks(selected) {
    var box = document.getElementById('ggDeptChecks'); var sel = {}; (selected || []).forEach(function(x){ sel[x] = true; }); box.innerHTML = '';
    (ggTaskState.departments || []).forEach(function(d){ box.insertAdjacentHTML('beforeend', '<label class="gg-check"><input type="checkbox" class="gg-dept-chk" value="' + esc(d.id) + '"' + (sel[d.id] ? ' checked' : '') + '><span>' + esc(d.name) + '</span></label>'); });
}
function ggTaskBuildAssignChecks(selected) {
    var box = document.getElementById('ggAssignChecks'); var deptSel = {}; ggTaskSelectedChecks('ggDeptChecks').forEach(function(x){ deptSel[x] = true; }); var sel = {}; (selected || []).forEach(function(x){ sel[x] = true; }); box.innerHTML = '';
    (ggTaskState.employees || []).filter(function(e){ return !Object.keys(deptSel).length || deptSel[e.department_id]; }).forEach(function(e){ var dep = e.department || ''; box.insertAdjacentHTML('beforeend', '<label class="gg-check"><input type="checkbox" class="gg-asg-chk" value="' + esc(e.id) + '"' + (sel[e.id] ? ' checked' : '') + '><span>' + esc(e.name) + (dep ? ' · ' + esc(dep) : '') + '</span></label>'); });
}
function ggTaskRebuildLeadOptions(preserveEmp) {
    var deptSel = ggTaskSelectedChecks('ggDeptChecks'); var ld = document.getElementById('ggFLeadDept'); var le = document.getElementById('ggFLeadEmp'); var curDept = ld.value; var curEmp = le.value;
    ld.innerHTML = deptSel.length ? '' : '<option value="">Сначала выберите банки-участники</option>';
    deptSel.forEach(function(id){ var d = (ggTaskState.departments || []).find(function(x){ return x.id === id; }); ld.insertAdjacentHTML('beforeend', '<option value="' + esc(id) + '">' + esc(d ? d.name : id) + '</option>'); });
    if (deptSel.indexOf(curDept) >= 0) ld.value = curDept; else if (deptSel.length) ld.value = deptSel[0]; else ld.value = '';
    var leadDept = ld.value; le.innerHTML = '<option value="">Не выбран</option>';
    (ggTaskState.employees || []).filter(function(e){ return leadDept && e.department_id === leadDept; }).forEach(function(e){ le.insertAdjacentHTML('beforeend', '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'); });
    if (preserveEmp && curEmp) le.value = curEmp; if (le.value !== curEmp && preserveEmp && curEmp) le.value = '';
}
function ggTaskFillForm(task) {
    ggTaskCurrent = ggTaskClone(task);
    document.getElementById('ggFIcon').value = task.icon || '📋';
    document.getElementById('ggFName').value = task.name || '';
    document.getElementById('ggFType').value = task.task_type || '';
    document.getElementById('ggFPocket').value = task.pocket || '';
    ggTaskBuildStages(task.stages || []);
    ggTaskBuildDeptChecks(ggNormList(task.department_ids));
    ggTaskBuildAssignChecks(ggNormList(task.assignees));
    ggTaskRebuildLeadOptions(false);
    document.getElementById('ggFLeadDept').value = task.lead_department || document.getElementById('ggFLeadDept').value || '';
    ggTaskRebuildLeadOptions(true);
    document.getElementById('ggFLeadEmp').value = task.lead_employee || '';
    ggTaskErr(''); ggTaskMask().classList.add('open');
}
function ggTaskLoadState() {
    if (ggTaskState.loaded) return Promise.resolve(ggTaskState);
    return fetch('/api/tracker/state?log_days=0', {credentials:'same-origin'}).then(function(r){ return r.json(); }).then(function(d){
        if (!d || !d.success) throw new Error('Не удалось загрузить данные задач');
        ggTaskState.loaded = true; ggTaskState.employees = d.employees || []; ggTaskState.departments = d.departments || []; ggTaskState.tasksById = {};
        (d.tasks || []).forEach(function(t){ ggTaskState.tasksById[t.id] = t; }); return ggTaskState;
    });
}
function ggTaskOpen(taskId) {
    ggTaskLoadState().then(function(){ var t = ggTaskState.tasksById[taskId]; if (!t) throw new Error('Задача не найдена'); ggTaskFillForm(t); }).catch(function(err){ ggTaskErr(err && err.message ? err.message : 'Ошибка загрузки формы'); ggTaskMask().classList.add('open'); });
}
function ggTaskClose() { ggTaskMask().classList.remove('open'); ggTaskErr(''); }
function ggTaskPayload() {
    var t = ggTaskClone(ggTaskCurrent || {});
    t.icon = document.getElementById('ggFIcon').value.trim() || '📋';
    t.name = t.name || document.getElementById('ggFName').value.trim();
    t.task_type = document.getElementById('ggFType').value;
    t.pocket = document.getElementById('ggFPocket').value.trim();
    t.department_ids = ggTaskSelectedChecks('ggDeptChecks');
    t.assignees = ggTaskSelectedChecks('ggAssignChecks');
    t.lead_department = document.getElementById('ggFLeadDept').value;
    t.lead_employee = document.getElementById('ggFLeadEmp').value;
    var stages = {}; Array.from(document.querySelectorAll('#ggStages input[data-stage-key]')).forEach(function(inp){ stages[inp.getAttribute('data-stage-key')] = inp.value || ''; });
    t.stages = stages;
    if ((t.task_kind || 'audit') === 'other') { t.lead_department = ''; t.lead_employee = ''; t.stages = {}; }
    return t;
}
function ggTaskSave() {
    var body = document.getElementById('ggTaskBody'); var p = ggTaskPayload();
    var isOther = (p.task_kind || 'audit') === 'other';
    if (!isOther) {
        if (!p.department_ids.length) { ggTaskErr('Нужно выбрать минимум один банк-участник.'); return; }
        if (!p.lead_department) { ggTaskErr('Нужно выбрать банк-руководитель.'); return; }
        if (p.department_ids.indexOf(p.lead_department) < 0) { ggTaskErr('Банк-руководитель должен входить в состав участников.'); return; }
    }
    ggTaskErr(''); body.classList.add('gg-saving');
    var _hdrs = {'Content-Type':'application/json'};
    if (window.__ggCsrf) _hdrs['X-CSRF-Token'] = window.__ggCsrf;
    fetch('/api/tracker/task/save', { method:'POST', credentials:'same-origin', headers:_hdrs, body: JSON.stringify(p) })
        .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
        .then(function(res){ body.classList.remove('gg-saving'); if (!res.ok || !res.data || !res.data.success) throw new Error((res.data && (res.data.error || res.data.message)) || 'Ошибка сохранения'); ggTaskState.loaded = false; ggTaskClose(); load(); })
        .catch(function(err){ body.classList.remove('gg-saving'); ggTaskErr(err && err.message ? err.message : 'Ошибка сохранения'); });
}

function loadMeta() {
    fetch('/api/plugins/gantt/meta', {credentials: 'same-origin'})
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d.success) return;
            if (d.csrf_token) window.__ggCsrf = d.csrf_token;
            msSetOptions('dept', (d.departments || []).map(function(x) {
                return { value: x.id, label: x.name };
            }));
            var ts = document.getElementById('fTeam');
            (d.teams || []).forEach(function(x) {
                ts.insertAdjacentHTML('beforeend', '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>');
            });
        });
}

/* Карман ПВР: сравнение без учёта регистра и пробелов («ПВР», «пвр », «Пвр»). */
function ggIsPvrPocket(p) {
    return String(p || '').replace(/\s+/g, '').toLowerCase() === 'пвр';
}
/* Фильтр «Розничная без ПВР»: карман ПВР в списке карманов недоступен. */
var GG_TYPE_NO_PVR = 'розничная_без_пвр';
var ggPocketsAll = [];
function fillPocketFilter(pockets) {
    ggPocketsAll = (pockets || []).slice();
    var noPvr = document.getElementById('fType').value === GG_TYPE_NO_PVR;
    var opts = [];
    ggPocketsAll.forEach(function(p) {
        if (!p) return;
        if (noPvr && ggIsPvrPocket(p)) return;
        opts.push({ value: p, label: p });
    });
    msSetOptions('pocket', opts);
}

function load() {
    var box = document.getElementById('ganttBox');
    box.innerHTML = '<div class="loading">Загрузка…</div>';
    var q = '?from=' + encodeURIComponent(document.getElementById('fFrom').value) +
            '&to=' + encodeURIComponent(document.getElementById('fTo').value);
    msGetSelected('dept').forEach(function(v) {
        q += '&department=' + encodeURIComponent(v);
    });
    var team = document.getElementById('fTeam').value;
    if (team) q += '&team=' + encodeURIComponent(team);
    var sts = document.getElementById('fStatus').value;
    if (sts) q += '&status=' + encodeURIComponent(sts);
    msGetSelected('kind').forEach(function(v) {
        q += '&task_kind=' + encodeURIComponent(v);
    });
    var fty = document.getElementById('fType').value;
    if (fty) q += '&task_type=' + encodeURIComponent(fty);
    if (document.getElementById('fView').value === 'month') q += '&view=month';
    msGetSelected('pocket').forEach(function(v) {
        q += '&pocket=' + encodeURIComponent(v);
    });
    fetch('/api/plugins/gantt/data' + q, {credentials: 'same-origin'})
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (!d || !d.success) { box.innerHTML = '<div class="empty">Ошибка загрузки</div>'; return; }
            fillPocketFilter(d.pockets || []);
            render(d);
        })
        .catch(function() {
            box.innerHTML = '<div class="empty">Ошибка соединения</div>';
        });
}

function render(d) {
    window.__ggLastData = d;
    ggDeptNames = d.dept_names || {};
    ggHolidays = d.holidays || {};
    ggTaskOv = {}; ggTaskOvAny = {}; ggTasksById = {};
    (d.task_overrides || []).forEach(function(o) { ggTaskOv[o.task + '|' + o.bank + '|' + o.week] = +o.value || 0; ggTaskOvAny[o.task + '|' + o.week] = 1; });
    (d.tasks || []).forEach(function(t) { ggTasksById[t.id] = t; });
    ggCanOv = !!d.can_override;
    document.body.classList.toggle('gg-can-ov', ggCanOv);
    var view = document.getElementById('fView').value;
    if (view === 'week') { renderWeek(d); }
    else if (view === 'month') { renderMonth(d); }
    else { renderDay(d); }
    if (ggKeepScroll) {
        var _gb = document.getElementById('ganttBox'), _bb = document.getElementById('banksBox');
        if (_gb) _gb.scrollLeft = ggKeepScroll.g;
        if (_bb) _bb.scrollLeft = ggKeepScroll.b;
        ggKeepScroll = null;
    }
    setupSlider();
}

function setupSlider() {
    var box = document.getElementById('ganttBox');
    var wrap = document.getElementById('ggSliderWrap');
    var sl = document.getElementById('ggSlider');
    var banks = document.getElementById('banksBox');
    /* В режиме «Банки» Гант скрыт, ползунок управляет таблицей нагрузки */
    var master = (ggShowMode === 'banks' && banks) ? banks : box;
    function syncSl() {
        sl.max = String(Math.round(Math.max(0, master.scrollWidth - master.clientWidth)));
        sl.value = String(Math.round(master.scrollLeft));
    }
    var maxScroll = master.scrollWidth - master.clientWidth;
    if (master.offsetParent === null || maxScroll <= 2) { wrap.style.display = 'none'; }
    else { wrap.style.display = 'block'; syncSl(); }
    sl.oninput = function() {
        var v = parseInt(sl.value, 10);
        master.scrollLeft = v;
        if (master === box) { if (banks) banks.scrollLeft = v; } else { box.scrollLeft = v; }
    };
    box.onscroll = function() {
        if (master === box) syncSl();
        if (banks && banks.style.display !== 'none') banks.scrollLeft = box.scrollLeft;
    };
    if (banks) {
        banks.onscroll = function() {
            if (master === banks) syncSl();
            box.scrollLeft = banks.scrollLeft;
        };
    }
}

function renderDay(d) {
    var box = document.getElementById('ganttBox');
    var tasks = d.tasks || [];
    var days = d.days || [];
    var today = d.today || '';

    if (!tasks.length) {
        box.innerHTML = '<div class="empty">Нет задач за выбранный период</div>';
        clearBanks();
        return;
    }
    if (!days.length) {
        box.innerHTML = '<div class="empty">Пустой диапазон дат</div>';
        return;
    }

    var trackW = days.length * DAY_W;
    var html = '<div class="gantt-inner gg-mode-day">';

    /* --- Шапка --- */
    html += '<div class="gg-header">';
    html += '<div class="gg-corner">Задача</div>';
    html += '<div class="gg-days">';
    days.forEach(function(dk) {
        var dt = new Date(dk + 'T00:00:00');
        var wd = dt.getDay();
        var cls = 'gg-day';
        if (wd === 0 || wd === 6) cls += ' weekend';
        if (dk === today) cls += ' today';
        html += '<div class="' + cls + '" style="width:' + DAY_W + 'px">';
        html += '<span class="gg-dow">' + DOW[wd] + '</span>';
        html += '<span class="gg-date">' + fmtD(dk) + '</span>';
        html += '</div>';
    });
    html += '</div></div>';

    /* --- Тело --- */
    html += '<div class="gg-body">';

    /* Фон — выходные и сегодня */
    html += '<div class="gg-bg" style="width:' + trackW + 'px">';
    days.forEach(function(dk, i) {
        var dt = new Date(dk + 'T00:00:00');
        var wd = dt.getDay();
        if (wd === 0 || wd === 6) {
            html += '<div class="gg-bg-cell" style="left:' + (i * DAY_W) + 'px;width:' + DAY_W + 'px"></div>';
        }
        if (dk === today) {
            html += '<div class="gg-bg-cell gg-bg-today" style="left:' + (i * DAY_W) + 'px;width:' + DAY_W + 'px"></div>';
            html += '<div class="gg-today-line" style="left:' + (i * DAY_W + DAY_W - 1) + 'px"></div>';
        }
    });
    html += '</div>';

    /* Этапы задачи (зеркало db.py TASK_STAGE_*) */
    var STAGE_ORDER = ['подготовка','проверка_нжя','проверка_соглЦА','ос_проф','реализация_возражения','реализация_согласования','запас','оценка_тб'];
    var STAGE_COLORS = {'подготовка':'#C9CDCC','проверка_нжя':'#DFD4BD','проверка_соглЦА':'#D4B64B','ос_проф':'#747677','реализация_возражения':'#9BB393','реализация_согласования':'#7D9B6E','запас':'#A8A9AB','оценка_тб':'#A3A4A7'};
    var STAGE_LABELS = {'подготовка':'Подготовка','проверка_нжя':'Проверка НЖЯ','проверка_соглЦА':'Проверка согл. ЦА','ос_проф':'ОС проф.','реализация_возражения':'Реализация возражения','реализация_согласования':'Реализация согласования','запас':'Запас','оценка_тб':'Оценка ТБ'};
    function dayIndex(ds) {
        if (!ds) return -1;
        for (var i = 0; i < days.length; i++) { if (days[i] >= ds) return i; }
        return -1;
    }

    /* Строки задач */
    tasks.forEach(function(t) {
        var cls = t.overdue ? 'overdue' : (t.status || 'active');
        var sIdx = -1, eIdx = -1;
        for (var i = 0; i < days.length; i++) {
            if (sIdx < 0 && days[i] >= t.start_date) sIdx = i;
            if (days[i] <= t.deadline) eIdx = i;
        }
        if (sIdx < 0) sIdx = 0;
        if (eIdx < 0) eIdx = days.length - 1;
        if (eIdx < sIdx) eIdx = sIdx;

        var barLeft = sIdx * DAY_W + 3;
        var barWidth = (eIdx - sIdx + 1) * DAY_W - 6;
        if (barWidth < 16) barWidth = 16;

        var title = t.name + ' · ' + t.start_date + ' — ' + t.deadline +
                    (t.overdue ? ' · ПРОСРОЧЕНО' : '');

        html += '<div class="gg-row gg-task-row" data-tid="' + esc(t.id) + '">';
        html +=   '<div class="gg-name">';
        html +=     '<span class="gg-dot gg-dot-' + cls + '"></span>';
        html +=     '<span class="gg-ico">' + esc(t.icon || '📋') + '</span>';
        html +=     '<span class="gg-task-name gg-expandable" data-exp-tid="' + esc(t.id) + '" title="Показать банки-участники">' +
                      '<span class="gg-caret">\u25b8</span>' + esc(t.name) + '</span>';
        html +=     '<button type="button" class="gg-edit" data-edit-tid="' + esc(t.id) + '" title="Редактировать" aria-label="Редактировать">\u270f\ufe0f</button>';
        html +=   '</div>';
        html +=   '<div class="gg-track" style="width:' + trackW + 'px">';
        html +=     '<div class="gg-bar gg-bar-' + cls + '" style="left:' + barLeft + 'px;width:' + barWidth + 'px" title="' + esc(title) + '">';
        // Цветные сегменты этапов внутри бара
        if (t.stages && t.stages.length) {
            t.stages.forEach(function(st) {
                if (!st.start) return;
                var ssi = dayIndex(st.start);
                if (ssi < 0) return;
                var sei = st.end ? dayIndex(st.end) : eIdx;
                if (sei < 0) sei = eIdx;
                if (sei < ssi) sei = ssi;
                var segLeft = (ssi - sIdx) * DAY_W;
                var segWidth = (sei - ssi + 1) * DAY_W;
                if (segLeft < 0) { segWidth += segLeft; segLeft = 0; }
                if (segWidth <= 0) return;
                var col = STAGE_COLORS[st.key] || '#888';
                var stTitle = (STAGE_LABELS[st.key] || st.key) + ': ' + st.start + (st.end ? ' — ' + st.end : '');
                html += '<div class="gg-stage-seg" style="left:' + segLeft + 'px;width:' + segWidth + 'px;background:' + col + '" title="' + esc(stTitle) + '"></div>';
            });
        }
        if (barWidth > 80) {
            html +=     '<span class="gg-bar-label" style="position:relative;z-index:2">' + esc(t.name) + '</span>';
        }
        html +=     '</div>';
        html +=   '</div>';
        html += '</div>';
        /* П.3: раскрытые банки-участники под задачей (дневной режим) */
        html += participantRowsHtml(t, days, 'day', trackW, DAY_W);
    });

    html += '</div>';  /* gg-body */
    html += '</div>';  /* gantt-inner */

    /* Легенда этапов */
    html += '<div class="gg-stage-legend">';
    STAGE_ORDER.forEach(function(k) {
        html += '<span class="lg-item"><span class="lg-chip" style="background:' + STAGE_COLORS[k] + '"></span>' + STAGE_LABELS[k] + '</span>';
    });
    html += '</div>';

    box.innerHTML = html;

    /* П.3: вторая таблица «Нагрузка по тер банкам» в дневном режиме */
    renderBanks(d, days, 'day', DAY_W, STAGE_COLORS, STAGE_LABELS);
}

function renderWeek(d) {
    var box = document.getElementById('ganttBox');
    var tasks = d.tasks || [];
    var days = d.days || [];
    var today = d.today || '';

    if (!tasks.length) { box.innerHTML = '<div class="empty">Нет задач за выбранный период</div>'; clearBanks(); return; }
    if (!days.length) { box.innerHTML = '<div class="empty">Пустой диапазон дат</div>'; return; }

    var STAGE_ORDER = ['подготовка','проверка_нжя','проверка_соглЦА','ос_проф','реализация_возражения','реализация_согласования','запас','оценка_тб'];
    var STAGE_COLORS = {'подготовка':'#C9CDCC','проверка_нжя':'#DFD4BD','проверка_соглЦА':'#D4B64B','ос_проф':'#747677','реализация_возражения':'#9BB393','реализация_согласования':'#7D9B6E','запас':'#A8A9AB','оценка_тб':'#A3A4A7'};
    var STAGE_LABELS = {'подготовка':'Подготовка','проверка_нжя':'Проверка НЖЯ','проверка_соглЦА':'Проверка согл. ЦА','ос_проф':'ОС проф.','реализация_возражения':'Реализация возражения','реализация_согласования':'Реализация согласования','запас':'Запас','оценка_тб':'Оценка ТБ'};

    var weeks = buildWeeks(days);
    if (!weeks.length) { box.innerHTML = '<div class="empty">Пустой диапазон дат</div>'; return; }
    var todayMon = today ? mondayOf(today) : '';
    var trackW = weeks.length * WEEK_W;

    /* Группировка недель по месяцам (по месяцу понедельника) для верхнего слоя */
    var monthSpans = [];
    weeks.forEach(function(w) {
        var mi = parseInt(w.mon.split('-')[1], 10) - 1;
        var yr = w.mon.split('-')[0];
        var key = yr + '-' + mi;
        var last = monthSpans[monthSpans.length - 1];
        if (last && last.key === key) { last.count++; }
        else { monthSpans.push({ key: key, mi: mi, yr: yr, count: 1 }); }
    });

    var html = '<div class="gantt-inner gg-mode-week">';

    /* Шапка: двухслойная */
    html += '<div class="gg-header" style="height:70px;">';
    html += '<div class="gg-corner">Задача</div>';
    html += '<div class="gg-wk-head">';
    /* слой месяцев */
    html += '<div class="gg-wk-months">';
    monthSpans.forEach(function(m, idx) {
        var col = MONTH_COLORS[m.mi % MONTH_COLORS.length];
        html += '<div class="gg-wk-month" style="width:' + (m.count * WEEK_W) + 'px;background:' + col + '">' + MONTH_NAMES[m.mi] + '</div>';
    });
    html += '</div>';
    /* слой недель */
    html += '<div class="gg-wk-weeks">';
    weeks.forEach(function(w) {
        var cls = 'gg-wk-week' + (w.mon === todayMon ? ' today' : '');
        html += '<div class="' + cls + '" style="width:' + WEEK_W + 'px" title="' + w.mon + ' — ' + w.sun + '">' + fmtD(w.mon) + '–<br>' + fmtD(w.sun) + '</div>';
    });
    html += '</div>';
    html += '</div></div>';

    /* Тело */
    html += '<div class="gg-body">';
    /* фон недели "сегодня" */
    html += '<div class="gg-bg" style="width:' + trackW + 'px">';
    weeks.forEach(function(w, i) {
        if (w.mon === todayMon) {
            html += '<div class="gg-bg-cell gg-bg-today" style="left:' + (i * WEEK_W) + 'px;width:' + WEEK_W + 'px"></div>';
        }
    });
    html += '</div>';

    tasks.forEach(function(t) {
        html += '<div class="gg-row gg-task-row" data-tid="' + esc(t.id) + '">';
        html +=   '<div class="gg-name">';
        html +=     '<span class="gg-dot gg-dot-' + (t.overdue ? 'overdue' : (t.status||'active')) + '"></span>';
        html +=     '<span class="gg-ico">' + esc(t.icon || '📋') + '</span>';
        html +=     '<span class="gg-task-name gg-expandable" data-exp-tid="' + esc(t.id) + '" title="Показать банки-участники">' +
                      '<span class="gg-caret">\u25b8</span>' + esc(t.name) + '</span>';
        html +=     '<button type="button" class="gg-edit" data-edit-tid="' + esc(t.id) + '" title="Редактировать" aria-label="Редактировать">\u270f\ufe0f</button>';
        html +=   '</div>';
        html +=   '<div class="gg-track" style="width:' + trackW + 'px">';
        /* По каждой неделе — цвет этапа, активного в понедельник (свёрнуто = x1) */
        weeks.forEach(function(w, i) {
            var st = stageAtMonday(t.stages, w.mon);
            if (!st) return;
            var col = STAGE_COLORS[st.key] || '#888';
            var wt = (st.weight != null ? st.weight : 1);
            var wtTxt = round2(wt).toString();
            var ttl = (STAGE_LABELS[st.key] || st.key) + ' · неделя ' + fmtD(w.mon) + '–' + fmtD(w.sun) + ' · нагрузка ' + wtTxt;
            html += '<div class="gg-wk-cell' + (ggTovAny(t.id, w.mon) ? ' gg-man' : '') + '" style="left:' + (i * WEEK_W + 2) + 'px;width:' + (WEEK_W - 4) + 'px;background:' + col + '" title="' + esc(ttl) + '">' +
                    '<span class="gg-wk-load-c">' + wtTxt + '</span></div>';
        });
        html +=   '</div>';
        html += '</div>';
        /* П.2/П.3: раскрытые банки-участники под задачей */
        html += participantRowsHtml(t, weeks, 'week', trackW, WEEK_W);
    });

    html += '</div>';  /* gg-body */
    html += '</div>';  /* gantt-inner */

    /* Легенда этапов */
    html += '<div class="gg-stage-legend">';
    STAGE_ORDER.forEach(function(k) {
        html += '<span class="lg-item"><span class="lg-chip" style="background:' + STAGE_COLORS[k] + '"></span>' + STAGE_LABELS[k] + '</span>';
    });
    html += '</div>';

    box.innerHTML = html;

    /* П.6 обновления: вторая таблица — нагрузка по тер банкам */
    renderBanks(d, weeks, 'week', WEEK_W, STAGE_COLORS, STAGE_LABELS);
}

/* Шаг «Месяцы»: колонка = календарный месяц; полоса проверки делится на недели месяца */
function buildMonths(days) {
    if (!days.length) return [];
    var weeks = buildWeeks(days), out = [];
    var y = +days[0].slice(0, 4), mi = +days[0].slice(5, 7) - 1;
    var ly = +days[days.length - 1].slice(0, 4), lmi = +days[days.length - 1].slice(5, 7) - 1, guard = 0;
    while ((y < ly || (y === ly && mi <= lmi)) && guard < 40) {
        var mm = String(mi + 1).padStart(2, '0');
        var start = y + '-' + mm + '-01';
        var nd = new Date(y, mi + 1, 0);
        var end = y + '-' + mm + '-' + String(nd.getDate()).padStart(2, '0');
        var mons = weeks.filter(function(w) { return w.mon.slice(0, 7) === y + '-' + mm; }).map(function(w) { return w.mon; });
        out.push({ start: start, end: end, mi: mi, yr: y, mons: mons, mon: start });
        mi++; if (mi > 11) { mi = 0; y++; } guard++;
    }
    return out;
}
function renderMonth(d) {
    var box = document.getElementById('ganttBox');
    var tasks = d.tasks || [], days = d.days || [], today = d.today || '';
    if (!tasks.length) { box.innerHTML = '<div class="empty">Нет задач за выбранный период</div>'; clearBanks(); return; }
    var months = buildMonths(days);
    if (!months.length) { box.innerHTML = '<div class="empty">Пустой диапазон дат</div>'; return; }
    var STAGE_COLORS = {'подготовка':'#C9CDCC','проверка_нжя':'#DFD4BD','проверка_соглЦА':'#D4B64B','ос_проф':'#747677','реализация_возражения':'#9BB393','реализация_согласования':'#6E8F6A','запас':'#B0BEC5','оценка_тб':'#8FA9C9'};
    var SL = GG_STAGE_LABELS;
    var trackW = months.length * MONTH_W;
    var ySpans = [];
    months.forEach(function(p) { var l = ySpans[ySpans.length - 1]; if (l && l.yr === p.yr) l.count++; else ySpans.push({ yr: p.yr, count: 1 }); });
    var html = '<div class="gantt-inner gg-mode-week">';
    html += '<div class="gg-header" style="height:70px;"><div class="gg-corner">Задача</div><div class="gg-wk-head"><div class="gg-wk-months">';
    ySpans.forEach(function(y, yi) { html += '<div class="gg-wk-month" style="width:' + (y.count * MONTH_W) + 'px;background:' + MONTH_COLORS[(yi * 5) % MONTH_COLORS.length] + '">' + y.yr + '</div>'; });
    html += '</div><div class="gg-wk-weeks">';
    months.forEach(function(p) {
        var now = today && p.start <= today && today <= p.end;
        html += '<div class="gg-wk-week' + (now ? ' today' : '') + '" style="width:' + MONTH_W + 'px" title="' + p.start + ' — ' + p.end + '">' + MONTH_NAMES[p.mi].slice(0, 3) + '</div>';
    });
    html += '</div></div></div><div class="gg-body"><div class="gg-bg" style="width:' + trackW + 'px">';
    months.forEach(function(p, i) {
        if (today && p.start <= today && today <= p.end) html += '<div class="gg-bg-cell gg-bg-today" style="left:' + (i * MONTH_W) + 'px;width:' + MONTH_W + 'px"></div>';
    });
    html += '</div>';
    tasks.forEach(function(t) {
        html += '<div class="gg-row gg-task-row" data-tid="' + esc(t.id) + '"><div class="gg-name">';
        html += '<span class="gg-dot gg-dot-' + (t.overdue ? 'overdue' : (t.status || 'active')) + '"></span>';
        html += '<span class="gg-ico">' + esc(t.icon || '📋') + '</span>';
        html += '<span class="gg-task-name" title="' + esc(t.name) + '">' + esc(t.name) + '</span>';
        html += '<button type="button" class="gg-edit" data-edit-tid="' + esc(t.id) + '" title="Редактировать" aria-label="Редактировать">✏️</button>';
        html += '</div><div class="gg-track" style="width:' + trackW + 'px">';
        months.forEach(function(p, i) {
            var parts = [], any = false, ttl = [];
            p.mons.forEach(function(mn) {
                var st = stageAtMonday(t.stages, mn);
                if (st) { any = true; parts.push('<i style="background:' + (STAGE_COLORS[st.key] || '#888') + '"></i>'); ttl.push(fmtD(mn) + ': ' + (SL[st.key] || st.key)); }
                else parts.push('<i></i>');
            });
            if (!any) return;
            html += '<div class="gg-mo-cell' + (p.mons.some(function(mn) { return ggTovAny(t.id, mn); }) ? ' gg-man' : '') + '" style="left:' + (i * MONTH_W + 2) + 'px;width:' + (MONTH_W - 4) + 'px" title="' + esc(ttl.join('\n')) + '">' + parts.join('') + '</div>';
        });
        html += '</div></div>';
    });
    html += '</div></div>';
    html += '<div class="gg-stage-legend">';
    Object.keys(SL).forEach(function(k) { html += '<span class="lg-item"><span class="lg-chip" style="background:' + (STAGE_COLORS[k] || '#888') + '"></span>' + SL[k] + '</span>'; });
    html += '</div>';
    box.innerHTML = html;
    renderBanks(d, months, 'month', MONTH_W, STAGE_COLORS, SL);
}
/* Строит таблицу "Нагрузка по тер банкам": строки — банки,
   столбцы — те же периоды (недели ИЛИ дни), значение = сумма весов
   этапов всех задач банка, активных в этом периоде, с коэффициентом
   руководителя (x2 розн / x1.5 корп у банка-руководителя). mode='week'|'day'.
   Фильтры уже применены на бэке. */
function clearBanks() {
    var t = document.getElementById('banksTitle');
    var b = document.getElementById('banksBox');
    var l = document.getElementById('banksLegend');
    if (t) t.style.display = 'none';
    if (b) { b.style.display = 'none'; b.innerHTML = ''; }
    if (l) l.style.display = 'none';
    ggLoadPanelClose();
    ggShowLoadBar(false);
}

/* ===== Нагрузка по ТБ: цвет по % к ёмкости, итог ОАМ, подсказка, панель ===== */
var GG_STATUS_LBL = { planning:'Планирование', approved:'Утверждена', active:'Активна', done:'Завершена', cancelled:'Отменена', paused:'Приостановлена', archived:'Архив' };
var GG_STATUS_COL = { planning:'#7e57c2', approved:'#d68910', active:'#2874a6', done:'#239b56', cancelled:'#7f8c8d', paused:'#7f8c8d', archived:'#7f8c8d' };
var ggMetric = (function() { try { var v = localStorage.getItem('gg.metric'); return ['load', 'free', 'pct'].indexOf(v) >= 0 ? v : 'load'; } catch (e) { return 'load'; } })();
var ggHcMode = (function() { try { return localStorage.getItem('gg.hc') === 'fact' ? 'fact' : 'norm'; } catch (e) { return 'norm'; } })();
var ggIncPlan = (function() { try { return localStorage.getItem('gg.plan') !== '0'; } catch (e) { return true; } })();
var ggFill = null, ggSuppressClick = false, ggKeepScroll = null;
var MONTH_W = 64;
var ggLoadModel = null;      /* данные последней отрисовки для подсказки и панели */
var ggLoadSel = null;        /* выбранная ячейка {row, idx} */

function ggNum(v) {
    var r = Math.round((+v || 0) * 100) / 100;
    return String(r).replace('.', ',');
}
function ggPctLevel(load, cap) {
    if (!(load > 0)) return 'gg-lp0';
    if (cap == null) return 'gg-lpna';
    if (!(cap > 0)) return 'gg-lp5';
    var pc = Math.round(load / cap * 100);  /* как в подписи: 49,7% -> 50% */
    if (pc < 50) return 'gg-lp1';
    if (pc < 75) return 'gg-lp2';
    if (pc <= 100) return 'gg-lp3';
    if (pc <= 125) return 'gg-lp4';
    return 'gg-lp5';
}
function ggPctText(load, cap) {
    if (cap == null) return 'ёмкость не задана';
    if (!(cap > 0)) return (load > 0 ? 'ёмкость 0' : '0%');
    return Math.round(load / cap * 100) + '%';
}
function ggAddDays(iso, n) {
    var dt = new Date(iso + 'T00:00:00');
    dt.setDate(dt.getDate() + n);
    var m = dt.getMonth() + 1, d = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function renderBanks(d, periods, mode, cellW, STAGE_COLORS, STAGE_LABELS) {
    window.__ggPer = { mode: mode, periods: periods, cellW: cellW };
    var titleEl = document.getElementById('banksTitle');
    var box = document.getElementById('banksBox');
    var legend = document.getElementById('banksLegend');
    var banks = d.banks || [];
    var tasks = d.tasks || [];
    ggLoadPanelClose();

    if (!banks.length || !periods.length) {
        titleEl.style.display = 'none';
        box.style.display = 'none';
        box.innerHTML = '';
        if (legend) legend.style.display = 'none';
        ggShowLoadBar(false);
        ggLoadModel = null;
        return;
    }
    titleEl.style.display = 'block';
    box.style.display = 'block';
    if (legend) legend.style.display = 'flex';
    ggShowLoadBar(true);

    var isWeek = (mode === 'week');
    var isMonth = (mode === 'month');
    var todayMon = d.today ? mondayOf(d.today) : '';
    var today = d.today || '';
    var trackW = periods.length * cellW;
    var SL = STAGE_LABELS || GG_STAGE_LABELS;
    function pMon(p) { return isWeek ? p.mon : p; }

    /* Периоды: границы, «сейчас», нерабочие дни */
    var pinfo = periods.map(function(p) {
        if (isMonth) {
            var offM = 0;
            p.mons.forEach(function(mn) { var o = 0; for (var k = 0; k < 5; k++) { if (isOffDay(ggAddDays(mn, k))) o++; } if (o >= 5) offM++; });
            return { start: p.start, end: p.end, now: !!(today && p.start <= today && today <= p.end), offDays: 0, offWeek: false, offDay: false,
                     label: MONTH_NAMES[p.mi] + ' ' + p.yr + ' (среднее по ' + p.mons.length + ' нед.)', mons: p.mons, short: MONTH_NAMES[p.mi].slice(0, 3) + ' ' + String(p.yr).slice(2) };
        }
        if (isWeek) {
            var off = 0;
            for (var k = 0; k < 5; k++) { if (isOffDay(ggAddDays(p.mon, k))) off++; }
            return { start: p.mon, end: p.sun, now: p.mon === todayMon, offDays: off, offWeek: off >= 5, offDay: false,
                     label: 'неделя ' + fmtD(p.mon) + '–' + fmtD(p.sun) };
        }
        return { start: p, end: p, now: p === today, offDays: 0, offWeek: false, offDay: isOffDay(p), label: fmtD(p) };
    });

    /* load[bankId][i] и вклад каждой задачи contrib[bankId][i] */
    var load = {}, contrib = {}, plan = {}, manual = {}, calc = {};
    var ovMap = {};
    /* правки на уровне банка отключены: нагрузку меняют только по конкретной проверке */
    banks.forEach(function(b) {
        load[b.id] = []; contrib[b.id] = []; plan[b.id] = []; manual[b.id] = []; calc[b.id] = [];
        for (var i = 0; i < periods.length; i++) { load[b.id].push(0); contrib[b.id].push([]); plan[b.id].push(0); manual[b.id].push(false); calc[b.id].push(0); }
    });
    /* вклад проверки в банк на дату day (понедельник недели / день) */
    function ggContribAt(t, did, day) {
        var _ov = ggTovGet(t.id, did, (isWeek || isMonth) ? day : mondayOf(day));
        if (_ov != null) {
            var _st = stageAtMonday(t.stages, day);
            return { base: _ov, k: 1, man: true, stLbl: (_st ? (SL[_st.key] || _st.key) : 'вне этапов') + ' · ✎ вручную' };
        }
        var isOther = (t.task_kind || 'audit') === 'other';
        if (isOther) {
            var lc = (t.load_coef != null ? +t.load_coef : 0) || 0;
            if (lc <= 0) return null;
            if (t.start_date && day < t.start_date) return null;
            if (t.deadline && day > t.deadline) return null;
            return { base: lc, k: 1, stLbl: 'Другое (коэф. нагрузки)' };
        }
        var st = stageAtMonday(t.stages, day);
        if (!st) return null;
        return { base: (st.weight != null ? +st.weight : 1), k: leadCoef(t, did), stLbl: SL[st.key] || st.key || 'Этап' };
    }
    var useTasks = tasks.filter(function(t) { return ggIncPlan || t.status !== 'planning'; });
    useTasks.forEach(function(t) {
        var dids = t.dept_ids || [];
        if (!dids.length) return;
        periods.forEach(function(p, i) {
            var days = isMonth ? p.mons : [pMon(p)];
            var div = isMonth ? (p.mons.length || 1) : 1;
            dids.forEach(function(did) {
                if (!load[did]) return;
                var sum = 0, first = null, wk = 0, anyMan = false;
                days.forEach(function(day) {
                    var c = ggContribAt(t, did, day);
                    if (!c) return;
                    if (c.man) anyMan = true;
                    var v = c.base * c.k;
                    if (!(v > 0)) return;
                    sum += v; wk++;
                    if (!first) first = c;
                });
                if (anyMan) manual[did][i] = true;
                if (!(sum > 0)) return;
                var v = sum / div;
                load[did][i] += v;
                if (t.status === 'planning') plan[did][i] += v;
                contrib[did][i].push({ task: t, bank: did, stage: first.stLbl + (isMonth ? ' (' + wk + ' из ' + div + ' нед.)' : ''),
                    weight: first.base, coef: first.k, lead: (t.lead_department || '') === did, value: v, man: anyMan });
            });
        });
    });
    /* ручные правки (только недельные; в «Месяцах» заменяют расчёт своих недель) */
    function ggWeekCalc(did, mon) {
        var s = 0;
        useTasks.forEach(function(t) {
            if ((t.dept_ids || []).indexOf(did) < 0) return;
            var c = ggContribAt(t, did, mon); if (c) s += c.base * c.k;
        });
        return s;
    }
    banks.forEach(function(b) {
        periods.forEach(function(p, i) {
            calc[b.id][i] = load[b.id][i];
            if (isWeek) {
                var k = b.id + '|' + p.mon;
                if (ovMap.hasOwnProperty(k)) { load[b.id][i] = ovMap[k]; manual[b.id][i] = true; }
            } else if (isMonth) {
                var adj = 0, hit = false;
                p.mons.forEach(function(mn) {
                    var k2 = b.id + '|' + mn;
                    if (ovMap.hasOwnProperty(k2)) { hit = true; adj += ovMap[k2] - ggWeekCalc(b.id, mn); }
                });
                if (hit) { load[b.id][i] = Math.max(0, load[b.id][i] + adj / (p.mons.length || 1)); manual[b.id][i] = true; }
            }
        });
    });

    /* Итог: сумма по показанным банкам, ёмкость — по всем банкам ОАМ (или выбранным) */
    var totLoad = [], totContrib = [], totPlan = [], totMan = [], totCalc = [];
    for (var i = 0; i < periods.length; i++) {
        var s = 0, c = [], pl = 0, mn = false, cc = 0;
        banks.forEach(function(b) { s += load[b.id][i]; c = c.concat(contrib[b.id][i]); pl += plan[b.id][i]; cc += calc[b.id][i]; if (manual[b.id][i]) mn = true; });
        totLoad.push(s); totContrib.push(c); totPlan.push(pl); totMan.push(mn); totCalc.push(cc);
    }
    var isFact = (ggHcMode === 'fact');
    function capOf(v) { return (v == null ? null : +v); }
    var dirs = d.capacity_dirs || ['retail', 'corp'];
    var totName = 'Итого ОАМ' + (dirs.length === 1 ? (dirs[0] === 'retail' ? ' · розница' : ' · корпоратив') : '');
    var rows = banks.map(function(b) {
        return { id: b.id, name: b.name, cap: capOf(isFact ? b.capacity_fact : b.capacity), load: load[b.id], contrib: contrib[b.id], plan: plan[b.id], manual: manual[b.id], calc: calc[b.id], total: false };
    });
    var totRow = { id: '__total', name: totName, cap: capOf(isFact ? d.total_capacity_fact : d.total_capacity), load: totLoad, contrib: totContrib, plan: totPlan, manual: totMan, calc: totCalc, total: true };
    rows.push(totRow);
    ggLoadModel = { rows: rows, pinfo: pinfo, tasks: tasks, isWeek: isWeek, isMonth: isMonth, mode: mode, dirs: dirs,
                    canOv: !!d.can_override, periods: periods, scope: d.ov_scope || 'oam', today: today };

    var html = '<div class="gantt-inner gg-mode-' + ((isWeek || isMonth) ? 'week' : 'day') + ' gg-load-tbl">';
    html += '<div class="gg-header"' + ((isWeek || isMonth) ? ' style="height:70px;"' : '') + '>';
    html += '<div class="gg-corner">Тер банк · ёмкость' + (isFact ? ' (факт)' : '') + '</div>';
    if (isMonth) {
        var ySpans = [];
        periods.forEach(function(p) { var l = ySpans[ySpans.length - 1]; if (l && l.yr === p.yr) l.count++; else ySpans.push({ yr: p.yr, count: 1 }); });
        html += '<div class="gg-wk-head"><div class="gg-wk-months">';
        ySpans.forEach(function(y, yi) { html += '<div class="gg-wk-month" style="width:' + (y.count * cellW) + 'px;background:' + MONTH_COLORS[(yi * 5) % MONTH_COLORS.length] + '">' + y.yr + '</div>'; });
        html += '</div><div class="gg-wk-weeks">';
        periods.forEach(function(p, i) {
            var pi = pinfo[i];
            html += '<div class="gg-wk-week' + (pi.now ? ' today' : '') + '" style="width:' + cellW + 'px" title="' + p.start + ' — ' + p.end + '">'
                + (pi.now ? '<span class="gg-now-tag">сейчас</span>' : '') + MONTH_NAMES[p.mi].slice(0, 3) + '</div>';
        });
        html += '</div></div></div>';
    } else
    if (isWeek) {
        var monthSpans = [];
        periods.forEach(function(w) {
            var mi = parseInt(w.mon.split('-')[1], 10) - 1;
            var yr = w.mon.split('-')[0];
            var key = yr + '-' + mi;
            var last = monthSpans[monthSpans.length - 1];
            if (last && last.key === key) { last.count++; }
            else { monthSpans.push({ key: key, mi: mi, yr: yr, count: 1 }); }
        });
        html += '<div class="gg-wk-head"><div class="gg-wk-months">';
        monthSpans.forEach(function(m) {
            var col = MONTH_COLORS[m.mi % MONTH_COLORS.length];
            html += '<div class="gg-wk-month" style="width:' + (m.count * cellW) + 'px;background:' + col + '">' + MONTH_NAMES[m.mi] + '</div>';
        });
        html += '</div><div class="gg-wk-weeks">';
        periods.forEach(function(w, i) {
            var pi = pinfo[i];
            var cls = 'gg-wk-week' + (pi.now ? ' today' : '') + (pi.offWeek ? ' gg-wk-off' : '');
            html += '<div class="' + cls + '" style="width:' + cellW + 'px" title="' + w.mon + ' — ' + w.sun + (pi.offDays ? ' · нерабочих будних дней: ' + pi.offDays : '') + '">'
                 + (pi.now ? '<span class="gg-now-tag">сейчас</span>' : '')
                 + fmtD(w.mon) + '–<br>' + fmtD(w.sun) + '</div>';
        });
        html += '</div></div></div>';
    } else {
        html += '<div class="gg-days">';
        periods.forEach(function(dk) {
            var dt = new Date(dk + 'T00:00:00');
            var wd = dt.getDay();
            var cls = 'gg-day';
            if (wd === 0 || wd === 6) cls += ' weekend';
            if (dk === today) cls += ' today';
            html += '<div class="' + cls + '" style="width:' + cellW + 'px">';
            html += '<span class="gg-dow">' + DOW[wd] + '</span>';
            html += '<span class="gg-date">' + fmtD(dk) + '</span>';
            html += '</div>';
        });
        html += '</div></div>';
    }

    html += '<div class="gg-body">';
    rows.forEach(function(r, ri) {
        html += '<div class="gg-row' + (r.total ? ' gg-load-total' : '') + '">';
        html +=   '<div class="gg-name">';
        html +=     '<span class="gg-ico">' + (r.total ? 'Σ' : '🏦') + '</span>';
        html +=     '<span class="gg-task-name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>';
        html +=     '<span class="gg-cap-chip' + (r.cap == null ? ' na' : '') + '" title="Ёмкость = экспертный коэффициент × нормативная численность">' + (r.cap == null ? 'нет ёмк.' : ggNum(r.cap)) + '</span>';
        html +=   '</div>';
        html +=   '<div class="gg-track" style="width:' + trackW + 'px">';
        pinfo.forEach(function(pi, i) {
            if (pi.now) html += '<div class="gg-now-col" style="left:' + (i * cellW) + 'px;width:' + cellW + 'px"></div>';
            var v = r.load[i];
            var cls = 'gg-bank-cell gg-load-cell ' + (pi.offDay ? 'gg-lp0' : ggPctLevel(v, r.cap));
            if (pi.offDay) cls += ' gg-offday';
            if (pi.offWeek) cls += ' gg-offweek';
            if (!pi.offDay && r.plan && r.plan[i] > 0) cls += ' gg-has-plan';
            if (r.manual && r.manual[i] && !r.total) cls += ' gg-man';
            /* итог: тоже без рамки ручной правки */
            var txt = pi.offDay ? '' : ggCellText(v, r.cap);
            if (ggMetric === 'free' && r.cap != null && r.cap - v < 0 && !pi.offDay) cls += ' gg-neg-free';
            var fh = false ? '<span class="gg-fill-h" title="Протяните, чтобы скопировать значение на соседние недели"></span>' : '';
            html += '<div class="' + cls + '" data-lrow="' + ri + '" data-lidx="' + i + '" style="left:' + (i * cellW + 2) + 'px;width:' + (cellW - 4) + 'px">' + txt + fh + '</div>';
        });
        html +=   '</div>';
        html += '</div>';
    });
    html += '</div></div>';
    box.innerHTML = html;
    ggRenderKpi();
}

function ggCellText(v, cap) {
    if (ggMetric === 'free') {
        if (cap == null) return v > 0 ? ggNum(v) : '';
        var f = cap - v;
        return (v > 0 || f !== cap) ? ggNum(f) : ggNum(cap);
    }
    if (ggMetric === 'pct') {
        if (!(v > 0)) return '';
        if (cap == null || !(cap > 0)) return ggNum(v);
        return Math.round(v / cap * 100) + '%';
    }
    return v > 0 ? ggNum(v) : '';
}
function ggShowLoadBar(on) {
    var bar = document.getElementById('ggLoadBar'), k = document.getElementById('ggKpi');
    if (bar) bar.style.display = 'flex';
    if (k && !on) { k.style.display = 'none'; k.innerHTML = ''; }
    if (on) { ggLoadBarSync(); ggRenderKpi(); }
}
function ggLoadBarSync() {
    ggSegMark('ggMetricSeg', ggMetric);
    ggSegMark('ggHcSeg', ggHcMode);
    var ch = document.getElementById('ggPlanChk'); if (ch) ch.checked = ggIncPlan;
}
/* KPI: горизонт 12 недель (или 3 месяца / 30 дней) от текущего периода */
function ggRenderKpi() {
    var box = document.getElementById('ggKpi'), m = ggLoadModel;
    if (!box) return;
    if (!m) { box.style.display = 'none'; return; }
    var H = m.isMonth ? 3 : (m.isWeek ? 12 : 30);
    var startI = 0;
    for (var i = 0; i < m.pinfo.length; i++) { if (m.pinfo[i].end >= m.today) { startI = i; break; } }
    var endI = Math.min(m.pinfo.length, startI + H);
    var unit = m.isMonth ? 'мес.' : (m.isWeek ? 'нед.' : 'дн.');
    var overCells = 0, overBanks = [], capBanks = 0;
    m.rows.forEach(function(r, ri) {
        if (r.total) return;
        if (r.cap != null && r.cap > 0) capBanks++;
        var cnt = 0, peak = 0, peakI = -1;
        for (var i = startI; i < endI; i++) {
            if (m.pinfo[i].offDay || m.pinfo[i].offWeek || r.cap == null || !(r.cap > 0)) continue;
            var pc = r.load[i] / r.cap;
            if (pc > 1.0001) cnt++;
            if (pc > peak) { peak = pc; peakI = i; }
        }
        if (cnt) { overCells += cnt; overBanks.push({ ri: ri, name: r.name, cnt: cnt, peak: peak, peakI: peakI, v: r.load[peakI], cap: r.cap }); }
    });
    var tot = m.rows[m.rows.length - 1], tPeak = 0, tPeakI = -1, tSum = 0, tN = 0;
    for (var j = startI; j < endI; j++) {
        if (m.pinfo[j].offDay || m.pinfo[j].offWeek || tot.cap == null || !(tot.cap > 0)) continue;
        var p2 = tot.load[j] / tot.cap; tSum += p2; tN++;
        if (p2 > tPeak) { tPeak = p2; tPeakI = j; }
    }
    var audits = m.tasks.filter(function(t) { return (t.task_kind || 'audit') === 'audit'; });
    var planN = audits.filter(function(t) { return t.status === 'planning'; }).length;
    var hz = 'ближайшие ' + (endI - startI) + ' ' + unit;
    function card(lbl, val, sub, st) {
        return '<div class="gg-kpi-card' + (st ? ' ' + st : '') + '"><div class="gg-kpi-lbl">' + lbl + '</div><div class="gg-kpi-val">' + val + '</div><div class="gg-kpi-sub">' + sub + '</div></div>';
    }
    var h = '<div class="gg-kpi-cards">';
    var cellWord = m.isMonth ? 'банко-месяцев' : (m.isWeek ? 'банко-недель' : 'банко-дней');
    h += card('Перегруз, ' + hz, overCells ? String(overCells) : 'нет', cellWord + ' с загрузкой > 100%', overCells ? 'bad' : 'ok');
    h += card('ТБ с перегрузом', overBanks.length + ' из ' + capBanks, 'банков с заданной ёмкостью', overBanks.length ? 'bad' : 'ok');
    h += card('Пик ОАМ', tPeakI >= 0 ? Math.round(tPeak * 100) + '%' : '—', tPeakI >= 0 ? esc(m.pinfo[tPeakI].short || m.pinfo[tPeakI].label) + ' · ' + ggNum(tot.load[tPeakI]) + ' из ' + ggNum(tot.cap) : 'ёмкость не задана', tPeak > 1.0001 ? 'bad' : '');
    h += card('Средняя загрузка ОАМ', tN ? Math.round(tSum / tN * 100) + '%' : '—', 'проверок: ' + audits.length + (planN ? ' · в планировании: ' + planN + (ggIncPlan ? '' : ' (не учтены)') : ''), '');
    h += '</div>';
    if (overBanks.length) {
        overBanks.sort(function(a, b) { return b.peak - a.peak; });
        h += '<div class="gg-kpi-warn"><span class="gg-kpi-warn-t">⚠ Перегруз:</span>';
        overBanks.forEach(function(o) {
            h += '<button type="button" class="gg-kpi-chip" data-kri="' + o.ri + '" data-kpi="' + o.peakI + '" title="Открыть расшифровку пиковой ячейки">'
               + esc(o.name) + ' — ' + o.cnt + ' ' + unit + ', пик ' + Math.round(o.peak * 100) + '% (' + ggNum(o.v) + ' из ' + ggNum(o.cap) + ')</button>';
        });
        h += '</div>';
    } else {
        h += '<div class="gg-kpi-okline">✓ На горизонте ' + (endI - startI) + ' ' + unit + ' перегруза нет</div>';
    }
    box.innerHTML = h;
    box.style.display = 'block';
}
document.addEventListener('click', function(ev) {
    var ch = ev.target.closest ? ev.target.closest('.gg-kpi-chip[data-kri]') : null;
    if (!ch) return;
    var ri = +ch.getAttribute('data-kri'), pi = +ch.getAttribute('data-kpi');
    var cell = document.querySelector('.gg-load-cell[data-lrow="' + ri + '"][data-lidx="' + pi + '"]');
    if (cell) cell.scrollIntoView({ block: 'nearest', inline: 'center' });
    ggLoadPanelOpen(ri, pi);
});
function ggFlash(msg, bad) {
    var el = document.getElementById('ggFlash');
    if (!el) { el = document.createElement('div'); el.id = 'ggFlash'; document.body.appendChild(el); }
    el.className = 'gg-flash' + (bad ? ' bad' : '');
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(ggFlash._t); ggFlash._t = setTimeout(function() { el.style.display = 'none'; }, 2200);
}
function ggSaveScroll() {
    var g = document.getElementById('ganttBox'), b = document.getElementById('banksBox');
    ggKeepScroll = { g: g ? g.scrollLeft : 0, b: b ? b.scrollLeft : 0 };
}
function ggReload() { ggSaveScroll(); load(); }
function ggRerender() { if (!window.__ggLastData) return; ggSaveScroll(); ggLoadPanelClose(); render(window.__ggLastData); }
function ggOvSave(bankId, weeks, value) {
    var m = ggLoadModel; if (!m) return;
    var h = { 'Content-Type': 'application/json' };
    if (window.__ggCsrf) h['X-CSRF-Token'] = window.__ggCsrf;
    fetch('/api/plugins/gantt/override', { method: 'POST', credentials: 'same-origin', headers: h,
        body: JSON.stringify({ scope: m.scope, bank_id: bankId, weeks: weeks, value: value }) })
        .then(function(r) { return r.json().catch(function() { return { success: false, error: 'HTTP ' + r.status }; }); })
        .then(function(d) {
            if (!d || !d.success) { ggFlash('❌ Не сохранено: ' + ((d && d.error) || 'ошибка'), true); return; }
            ggLoadPanelClose();
            ggFlash(value == null ? '✅ Возвращён расчёт (' + weeks.length + ' нед.)' : '✅ Загрузка задана вручную (' + weeks.length + ' нед.)');
            ggReload();
        })
        .catch(function() { ggFlash('❌ Ошибка соединения', true); });
}
/* Протягивание за уголок: копирует значение ячейки на соседние недели строки */
document.addEventListener('mousedown', function(ev) {
    var hnd = ev.target.closest ? ev.target.closest('.gg-fill-h') : null;
    if (!hnd || !ggLoadModel || !ggLoadModel.canOv) return;
    var cell = hnd.closest('.gg-load-cell'); if (!cell) return;
    ev.preventDefault(); ev.stopPropagation();
    var ri = +cell.getAttribute('data-lrow'), i = +cell.getAttribute('data-lidx');
    var r = ggLoadModel.rows[ri]; if (!r || r.total) return;
    ggFill = { ri: ri, from: i, to: i, value: Math.round((r.load[i] || 0) * 100) / 100 };
    document.body.classList.add('gg-filling');
    ggTipHide();
});
function ggFillMark() {
    Array.prototype.forEach.call(document.querySelectorAll('.gg-load-cell.gg-fill-sel'), function(c) { c.classList.remove('gg-fill-sel'); });
    if (!ggFill) return;
    var a = Math.min(ggFill.from, ggFill.to), b = Math.max(ggFill.from, ggFill.to);
    for (var k = a; k <= b; k++) {
        var c = document.querySelector('.gg-load-cell[data-lrow="' + ggFill.ri + '"][data-lidx="' + k + '"]');
        if (c) c.classList.add('gg-fill-sel');
    }
}
document.addEventListener('mousemove', function(ev) {
    if (!ggFill) return;
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    var c = el && el.closest ? el.closest('.gg-load-cell') : null;
    if (c && +c.getAttribute('data-lrow') === ggFill.ri) { ggFill.to = +c.getAttribute('data-lidx'); ggFillMark(); }
});
document.addEventListener('mouseup', function() {
    if (!ggFill) return;
    var f = ggFill; ggFill = null;
    document.body.classList.remove('gg-filling');
    ggFillMark();
    ggSuppressClick = true; setTimeout(function() { ggSuppressClick = false; }, 0);
    if (f.to === f.from) return;
    var m = ggLoadModel, r = m.rows[f.ri];
    var a = Math.min(f.from, f.to), b = Math.max(f.from, f.to), weeks = [];
    for (var k = a; k <= b; k++) { if (k !== f.from) weeks.push(m.pinfo[k].start); }
    ggOvSave(r.id, weeks, f.value);
});

/* ===== Ручная правка нагрузки по конкретной проверке ===== */
function ggPerLabel(mode, p) {
    if (mode === 'week') return 'неделя ' + fmtD(p.mon) + '–' + fmtD(p.sun);
    if (mode === 'month') return MONTH_NAMES[p.mi] + ' ' + p.yr;
    return fmtD(p) + ' (неделя с ' + fmtD(mondayOf(p)) + ')';
}
function ggConfirm(title, lines, onYes) {
    var mk = document.createElement('div'); mk.className = 'gg-cf-mask'; mk.id = 'ggConfirm';
    mk.innerHTML = '<div class="gg-cf-box" role="dialog" aria-modal="true"><h3>' + esc(title) + '</h3><ul>'
        + lines.map(function(l) { return '<li>' + l + '</li>'; }).join('') + '</ul>'
        + '<div class="gg-cf-q">Уверены, что хотите внести данные изменения?</div>'
        + '<div class="gg-cf-act"><button type="button" class="gg-cf-no">Нет</button><button type="button" class="gg-cf-yes">Да</button></div></div>';
    document.body.appendChild(mk);
    function close() { document.removeEventListener('keydown', onKey, true); mk.remove(); }
    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    mk.addEventListener('click', function(ev) { if (ev.target === mk) close(); });
    mk.querySelector('.gg-cf-no').addEventListener('click', close);
    mk.querySelector('.gg-cf-yes').addEventListener('click', function() { close(); onYes(); });
    mk.querySelector('.gg-cf-yes').focus();
}
function ggTovOpen(tid, banks, mode, p) {
    var t = ggTasksById[tid]; if (!t || !ggCanOv) return;
    banks = (banks && banks.length ? banks : (t.dept_ids || [])).filter(Boolean);
    if (!banks.length) { ggFlash('❌ У проверки нет банков', true); return; }
    var weeks = ggPeriodWeeks(mode, p);
    var old = document.getElementById('ggTovMask'); if (old) old.remove();
    var mk = document.createElement('div'); mk.className = 'gg-modal-mask open'; mk.id = 'ggTovMask';
    var h = '<div class="gg-modal gg-tov" role="dialog" aria-modal="true"><div class="gg-modal-head"><div class="gg-modal-title">✎ Нагрузка по проверке</div>'
        + '<button type="button" class="gg-modal-close" id="ggTovClose">✕</button></div><div class="gg-modal-body">'
        + '<div class="gg-tov-sub"><b>' + esc((t.icon ? t.icon + ' ' : '') + t.name) + '</b> · ' + esc(ggPerLabel(mode, p)) + '</div>'
        + '<div class="gg-tov-row h"><span>Банк · неделя</span><span>Расчёт</span><span>Значение</span><span></span></div>';
    banks.forEach(function(did) {
        weeks.forEach(function(mon) {
            var calc = ggTaskCalcAt(t, did, mon), ov = ggTovGet(tid, did, mon);
            var cur = (ov != null ? ov : calc);
            h += '<div class="gg-tov-row" data-bank="' + esc(did) + '" data-week="' + mon + '">'
               + '<span>' + esc(ggDeptNames[did] || did) + ((t.lead_department || '') === did ? ' 👑' : '') + (weeks.length > 1 || mode === 'day' ? ' · ' + fmtD(mon) : '') + '</span>'
               + '<span>' + ggNum(calc) + '</span>'
               + '<span><input type="text" inputmode="decimal" value="' + ggNum(cur) + '" data-calc="' + calc + '" data-ov="' + (ov != null ? ov : '') + '"' + (ov != null ? ' class="man"' : '') + '></span>'
               + '<span>' + (ov != null ? '<button type="button" class="gg-tov-rs" title="Вернуть расчёт">↺</button>' : '') + '</span></div>';
        });
    });
    h += '<div class="gg-tov-hint">Значение — нагрузка этой проверки на банк за неделю (вес этапа × коэффициент роли). Ручное значение заменяет расчёт только для этой проверки.</div>'
       + '<div class="gg-modal-actions"><button type="button" class="gg-btn" id="ggTovCancel">Отмена</button><button type="button" class="gg-btn gg-btn-primary" id="ggTovSave">Сохранить</button></div></div></div>';
    mk.innerHTML = h;
    document.body.appendChild(mk);
    function close() { mk.remove(); }
    mk.addEventListener('click', function(ev) { if (ev.target === mk) close(); });
    mk.querySelector('#ggTovClose').addEventListener('click', close);
    mk.querySelector('#ggTovCancel').addEventListener('click', close);
    Array.prototype.forEach.call(mk.querySelectorAll('.gg-tov-rs'), function(b) {
        b.addEventListener('click', function() {
            var inp = b.closest('.gg-tov-row').querySelector('input');
            inp.value = ggNum(+inp.getAttribute('data-calc')); inp.setAttribute('data-reset', '1'); inp.classList.remove('man'); b.remove();
        });
    });
    mk.querySelector('#ggTovSave').addEventListener('click', function() {
        var items = [], lines = [], bad = false;
        Array.prototype.forEach.call(mk.querySelectorAll('.gg-tov-row[data-bank]'), function(row) {
            var inp = row.querySelector('input');
            var calc = +inp.getAttribute('data-calc');
            var ovs = inp.getAttribute('data-ov'), ov = ovs === '' ? null : +ovs;
            var raw = String(inp.value).trim().replace(',', '.');
            var v = raw === '' ? null : parseFloat(raw);
            if (raw !== '' && (!(v >= 0) || v > 100)) { inp.style.borderColor = '#e53935'; bad = true; return; }
            var did = row.getAttribute('data-bank'), mon = row.getAttribute('data-week');
            var nm = esc(ggDeptNames[did] || did) + ' · ' + fmtD(mon);
            var cur = (ov != null ? ov : calc);
            if (inp.getAttribute('data-reset') === '1' || v == null) {
                if (ov != null) { items.push({ bank: did, week: mon, value: null }); lines.push(nm + ': ' + ggNum(ov) + ' → расчёт ' + ggNum(calc)); }
                return;
            }
            v = Math.round(v * 100) / 100;
            if (Math.abs(v - cur) < 0.005) return;
            if (ov == null && Math.abs(v - calc) < 0.005) return;
            items.push({ bank: did, week: mon, value: v });
            lines.push(nm + ': ' + ggNum(cur) + ' → <b>' + ggNum(v) + '</b> (вручную)');
        });
        if (bad) return;
        if (!items.length) { ggFlash('Изменений нет'); return; }
        ggConfirm('Нагрузка по проверке «' + t.name + '»', lines, function() {
            var hd = { 'Content-Type': 'application/json' };
            if (window.__ggCsrf) hd['X-CSRF-Token'] = window.__ggCsrf;
            fetch('/api/plugins/gantt/task_override', { method: 'POST', credentials: 'same-origin', headers: hd,
                body: JSON.stringify({ task_id: tid, items: items }) })
                .then(function(r) { return r.json().catch(function() { return { success: false, error: 'HTTP ' + r.status }; }); })
                .then(function(d) {
                    if (!d || !d.success) { ggFlash('❌ Не сохранено: ' + ((d && d.error) || 'ошибка'), true); return; }
                    close(); ggLoadPanelClose();
                    ggFlash('✅ Нагрузка по проверке сохранена (' + items.length + ')');
                    ggReload();
                })
                .catch(function() { ggFlash('❌ Ошибка соединения', true); });
        });
    });
    var f = mk.querySelector('.gg-tov-row input'); if (f) { f.focus(); f.select(); }
}
/* Кнопка в боковой панели «Нагрузки по ТБ» */
document.addEventListener('click', function(ev) {
    var b = ev.target.closest ? ev.target.closest('.gg-lp-ov-btn[data-tov-tid]') : null;
    if (!b || !ggLoadModel) return;
    var pi = +b.getAttribute('data-tov-pi');
    ggTovOpen(b.getAttribute('data-tov-tid'), (b.getAttribute('data-tov-banks') || '').split(','), ggLoadModel.mode, ggLoadModel.periods[pi]);
});
/* Клик по ячейке в таблице проверок (строка проверки — все банки, строка банка — один банк) */
document.addEventListener('click', function(ev) {
    if (!ggCanOv || !window.__ggPer) return;
    var tr = ev.target.closest ? ev.target.closest('#ganttBox .gg-track') : null;
    if (!tr) return;
    var row = tr.closest('.gg-row[data-tid]'); if (!row) return;
    var per = window.__ggPer;
    var x = ev.clientX - tr.getBoundingClientRect().left;
    var i = Math.floor(x / per.cellW);
    if (i < 0 || i >= per.periods.length) return;
    var tid = row.getAttribute('data-tid'), t = ggTasksById[tid]; if (!t) return;
    var p = per.periods[i];
    if (per.mode === 'day' && isOffDay(p)) return;
    var weeks = ggPeriodWeeks(per.mode, p);
    var inTask = weeks.some(function(mon) { return mon <= (t.deadline || '9999') && isoAddDays(mon, 6) >= (t.start_date || ''); });
    if (!inTask) return;
    var bank = row.getAttribute('data-bank');
    ggTovOpen(tid, bank ? [bank] : null, per.mode, p);
});
/* Выгрузка в Excel */
function ggExportXls() {
    var m = ggLoadModel; if (!m) return;
    var btn = document.getElementById('ggXlsBtn');
    var segTxt = function(id) { var b = document.querySelector('#' + id + ' button.active'); return b ? b.textContent.trim() : ''; };
    var payload = {
        title: 'Нагрузка по ТБ · ' + segTxt('ggTypeSeg') + ' · численность: ' + segTxt('ggHcSeg').toLowerCase()
            + (ggIncPlan ? ' · с предварительными' : ' · без предварительных') + ' · ' + document.getElementById('fFrom').value + ' — ' + document.getElementById('fTo').value,
        periods: m.pinfo.map(function(p) { return p.short || p.label.replace(/^неделя /, ''); }),
        rows: m.rows.map(function(r) {
            return { name: r.name, cap: r.cap, total: r.total,
                     values: r.load.map(function(v, i) { return m.pinfo[i].offDay ? null : Math.round(v * 100) / 100; }),
                     manual: r.manual || [], plan: (r.plan || []).map(function(v) { return Math.round(v * 100) / 100; }) };
        })
    };
    var h = { 'Content-Type': 'application/json' };
    if (window.__ggCsrf) h['X-CSRF-Token'] = window.__ggCsrf;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Excel'; }
    fetch('/api/plugins/gantt/export', { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify(payload) })
        .then(function(r) {
            if (!r.ok) return r.text().then(function(tx) {
                var msg = 'HTTP ' + r.status;
                try { var j = JSON.parse(tx); if (j && j.error) msg += ' · ' + j.error; } catch (e) {}
                throw new Error(msg);
            });
            var ext = (r.headers.get('X-Export-Format') === 'csv') ? 'csv' : 'xlsx';
            return r.blob().then(function(b) { return { blob: b, ext: ext }; });
        })
        .then(function(res) {
            var blob = res.blob;
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'Нагрузка_по_ТБ_' + (m.today || '').replace(/-/g, '') + '.' + res.ext;
            if (res.ext === 'csv') ggFlash('⚠ На сервере не удалось собрать .xlsx, выгружен CSV. Подробности в окне сервера.', true);
            document.body.appendChild(a); a.click();
            setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        })
        .catch(function(e) { ggFlash('❌ Выгрузка не удалась: ' + e.message, true); })
        .then(function() { if (btn) { btn.disabled = false; btn.textContent = '⬇ Excel'; } });
}
function ggCellInfo(ri, i) {
    var m = ggLoadModel; if (!m) return null;
    var r = m.rows[ri], pi = m.pinfo[i];
    if (!r || !pi) return null;
    var v = r.load[i] || 0;
    var plan = 0, planN = {}, allN = {};
    (r.contrib[i] || []).forEach(function(c) {
        allN[c.task.id] = 1;
        if (c.task.status === 'planning') { plan += c.value; planN[c.task.id] = 1; }
    });
    return { r: r, pi: pi, v: v, cap: r.cap, plan: plan, planCnt: Object.keys(planN).length, cnt: Object.keys(allN).length,
             man: !!(r.manual && r.manual[i]), calc: (r.calc ? r.calc[i] : v) };
}
function ggDiffLine(x) {
    if (x.cap == null) return '';
    var diff = x.cap - x.v;
    return diff < 0 ? '<b class="gg-neg">не хватает ' + ggNum(-diff) + '</b>' : 'свободно ' + ggNum(diff);
}
function ggTipEl() {
    var el = document.getElementById('ggLoadTip');
    if (!el) { el = document.createElement('div'); el.id = 'ggLoadTip'; el.className = 'gg-load-tip'; document.body.appendChild(el); }
    return el;
}
function ggTipShow(cell, ev) {
    var x = ggCellInfo(+cell.getAttribute('data-lrow'), +cell.getAttribute('data-lidx'));
    if (!x) return;
    var h = '<div class="gg-tip-h">' + esc(x.r.name) + '</div>';
    h += '<div class="gg-tip-sub">' + esc(x.pi.label) + (x.pi.now ? ' · сейчас' : '') + '</div>';
    if (x.pi.offDay) h += '<div>Выходной / праздник</div>';
    else {
        if (x.pi.offDays) h += '<div class="gg-tip-off">Нерабочих будних дней: ' + x.pi.offDays + '</div>';
        h += '<div>Загрузка: <b>' + ggNum(x.v) + '</b>' + (x.cap != null ? ' из ' + ggNum(x.cap) : '') + ' · ' + ggPctText(x.v, x.cap) + '</div>';
        var dl = ggDiffLine(x); if (dl) h += '<div>' + dl + '</div>';
        if (x.man) h += '<div class="gg-tip-off">✎ ' + (x.r.total ? 'Есть ручные правки банков' : 'Задано вручную') + ' · расчёт: ' + ggNum(x.calc) + '</div>';
        if (!ggIncPlan) h += '<div class="gg-tip-off">Проверки в «Планировании» не учтены</div>';
        h += '<div>Проверок: ' + x.cnt + (x.plan > 0 ? ' · в т. ч. предварительно: ' + ggNum(x.plan) + ' (' + x.planCnt + ')' : '') + '</div>';
        h += '<div class="gg-tip-hint">Клик — расшифровка по проверкам</div>';
    }
    var el = ggTipEl(); el.innerHTML = h; el.style.display = 'block';
    ggTipMove(ev);
}
function ggTipMove(ev) {
    var el = document.getElementById('ggLoadTip'); if (!el || el.style.display !== 'block') return;
    var w = el.offsetWidth, hh = el.offsetHeight;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + hh > window.innerHeight - 8) y = ev.clientY - hh - 14;
    el.style.left = Math.max(4, x) + 'px'; el.style.top = Math.max(4, y) + 'px';
}
function ggTipHide() { var el = document.getElementById('ggLoadTip'); if (el) el.style.display = 'none'; }

function ggLoadPanelEl() {
    var el = document.getElementById('ggLoadPanel');
    if (!el) {
        el = document.createElement('aside');
        el.id = 'ggLoadPanel'; el.className = 'gg-load-panel';
        el.innerHTML = '<div class="gg-lp-head"><div><div class="gg-lp-title" id="ggLpTitle"></div><div class="gg-lp-sub" id="ggLpSub"></div></div>'
            + '<button type="button" class="gg-lp-close" id="ggLpClose" title="Закрыть (Esc)">✕</button></div>'
            + '<div class="gg-lp-body" id="ggLpBody"></div>';
        document.body.appendChild(el);
        el.querySelector('#ggLpClose').addEventListener('click', ggLoadPanelClose);
    }
    return el;
}
function ggLoadPanelClose() {
    var el = document.getElementById('ggLoadPanel');
    if (el) el.classList.remove('open');
    ggLoadSel = null;
    Array.prototype.forEach.call(document.querySelectorAll('.gg-load-cell.gg-sel'), function(c) { c.classList.remove('gg-sel'); });
}
function ggStatusBadge(st) {
    var col = GG_STATUS_COL[st] || '#7f8c8d';
    return '<span class="gg-lp-st" style="background:' + col + '">' + esc(GG_STATUS_LBL[st] || st || '—') + '</span>';
}
function ggLoadPanelOpen(ri, i) {
    var x = ggCellInfo(ri, i); if (!x) return;
    var m = ggLoadModel, r = x.r, pi = x.pi;
    var el = ggLoadPanelEl();
    el.querySelector('#ggLpTitle').textContent = r.name;
    el.querySelector('#ggLpSub').textContent = pi.label + (pi.now ? ' · сейчас' : '') + (pi.offDays ? ' · нерабочих будних дней: ' + pi.offDays : '');
    var lvl = ggPctLevel(x.v, x.cap);
    var h = '<div class="gg-lp-sum">'
        + '<div><span>Загрузка</span><b>' + ggNum(x.v) + '</b></div>'
        + '<div><span>Ёмкость</span><b>' + (x.cap == null ? '—' : ggNum(x.cap)) + '</b></div>'
        + '<div><span>% ёмкости</span><b class="gg-lp-pct ' + lvl + '">' + ggPctText(x.v, x.cap) + '</b></div>'
        + '<div><span>' + (x.cap != null && x.cap - x.v < 0 ? 'Не хватает' : 'Свободно') + '</span><b>' + (x.cap == null ? '—' : ggNum(Math.abs(x.cap - x.v))) + '</b></div>'
        + '</div>';
    if (x.plan > 0) h += '<div class="gg-lp-note">В т. ч. предварительно (Планирование): ' + ggNum(x.plan) + '</div>';
    if (pi.offDay) h += '<div class="gg-lp-note">Выходной / праздничный день, нагрузка не считается.</div>';

    /* Группировка вкладов по проверке */
    var byTask = {}, order = [];
    (r.contrib[i] || []).forEach(function(c) {
        var g = byTask[c.task.id];
        if (!g) { g = byTask[c.task.id] = { task: c.task, value: 0, parts: [] }; order.push(g); }
        g.value += c.value; g.parts.push(c);
    });
    order.sort(function(a, b) { return b.value - a.value; });
    h += '<div class="gg-lp-sec">Проверки с нагрузкой в этом периоде (' + order.length + ')</div>';
    if (!order.length) h += '<div class="gg-lp-empty">Нет активных этапов.</div>';
    order.forEach(function(g) {
        var t = g.task;
        h += '<div class="gg-lp-item"><div class="gg-lp-row1"><span class="gg-lp-name">' + esc((t.icon ? t.icon + ' ' : '') + t.name) + '</span><b class="gg-lp-val">' + ggNum(g.value) + '</b></div>';
        h += '<div class="gg-lp-row2">' + ggStatusBadge(t.status) + (t.task_type ? '<span class="gg-lp-tag">' + esc(t.task_type) + '</span>' : '') + (t.pocket ? '<span class="gg-lp-tag">' + esc(t.pocket) + '</span>' : '') + '</div>';
        g.parts.forEach(function(c) {
            var who = r.total ? esc(ggDeptNames[c.bank] || c.bank) + ': ' : '';
            var role = c.lead ? '👑 руководитель ×' + ggNum(c.coef) : 'участник ×1';
            if (c.man) h += '<div class="gg-lp-part">' + who + esc(c.stage) + ' = <b>' + ggNum(c.value) + '</b></div>';
            else h += '<div class="gg-lp-part">' + who + esc(c.stage) + ' · вес ' + ggNum(c.weight) + ' · ' + role + ' = <b>' + ggNum(c.value) + '</b></div>';
        });
        if (m.canOv && !pi.offDay) {
            var _bk = r.total ? g.parts.map(function(c) { return c.bank; }).filter(function(b, k, a) { return a.indexOf(b) === k; }) : [r.id];
            h += '<button type="button" class="gg-lp-ov-btn" data-tov-tid="' + esc(t.id) + '" data-tov-banks="' + esc(_bk.join(',')) + '" data-tov-pi="' + i + '">✎ Задать нагрузку вручную</button>';
        }
        h += '</div>';
    });

    /* Проверки банка, которые идут в этом периоде, но без активного этапа */
    if (!r.total) {
        var idle = (m.tasks || []).filter(function(t) {
            if ((t.dept_ids || []).indexOf(r.id) < 0 || byTask[t.id]) return false;
            return (t.start_date || '') <= pi.end && (t.deadline || '9999') >= pi.start;
        });
        if (idle.length) {
            h += '<div class="gg-lp-sec">Также идут, без нагрузки в этом периоде (' + idle.length + ')</div>';
            idle.forEach(function(t) {
                h += '<div class="gg-lp-item idle"><div class="gg-lp-row1"><span class="gg-lp-name">' + esc((t.icon ? t.icon + ' ' : '') + t.name) + '</span><b class="gg-lp-val">0</b></div>'
                  + '<div class="gg-lp-row2">' + ggStatusBadge(t.status) + '<span class="gg-lp-tag">' + esc(fmtD(t.start_date) + '–' + fmtD(t.deadline)) + '</span></div>'
                  + ((m.canOv && !pi.offDay) ? '<button type="button" class="gg-lp-ov-btn" data-tov-tid="' + esc(t.id) + '" data-tov-banks="' + esc(r.id) + '" data-tov-pi="' + i + '">✎ Задать нагрузку вручную</button>' : '') + '</div>';
            });
        }
    }
    if (m.canOv && !pi.offDay) h += '<div class="gg-lp-man-hint">✎ Нагрузку банка можно поменять только через конкретную проверку: кнопка «Задать нагрузку вручную» у проверки или клик по её ячейке в таблице «Проверки».</div>';
    if (x.man) h += '<div class="gg-lp-note">✎ В этом периоде есть нагрузка, заданная вручную по проверке.</div>';
    el.querySelector('#ggLpBody').innerHTML = h;
    var _sv = el.querySelector('#ggOvSaveBtn');
    if (_sv) _sv.addEventListener('click', function() {
        var inp = el.querySelector('#ggOvVal'), val = parseFloat(String(inp.value).replace(',', '.'));
        if (!(val >= 0) || val > 1000) { inp.style.borderColor = '#e53935'; inp.focus(); return; }
        ggOvSave(r.id, [pi.start], val);
    });
    var _rs = el.querySelector('#ggOvResetBtn');
    if (_rs) _rs.addEventListener('click', function() { ggOvSave(r.id, [pi.start], null); });
    var _ra = el.querySelector('#ggOvResetAll');
    if (_ra) _ra.addEventListener('click', function() {
        var ws = []; m.rows[ri].manual.forEach(function(f, k) { if (f) ws.push(m.pinfo[k].start); });
        if (ws.length) ggOvSave(r.id, ws, null);
    });
    el.classList.add('open');
    ggLoadSel = { row: ri, idx: i };
    Array.prototype.forEach.call(document.querySelectorAll('.gg-load-cell.gg-sel'), function(c) { c.classList.remove('gg-sel'); });
    var cell = document.querySelector('.gg-load-cell[data-lrow="' + ri + '"][data-lidx="' + i + '"]');
    if (cell) cell.classList.add('gg-sel');
}
document.addEventListener('mouseover', function(ev) {
    var c = ev.target.closest ? ev.target.closest('.gg-load-cell') : null;
    if (c && !ggFill) ggTipShow(c, ev);
});
document.addEventListener('mousemove', function(ev) {
    if (ev.target.closest && ev.target.closest('.gg-load-cell')) ggTipMove(ev);
});
document.addEventListener('mouseout', function(ev) {
    var c = ev.target.closest ? ev.target.closest('.gg-load-cell') : null;
    if (c && !(ev.relatedTarget && c.contains(ev.relatedTarget))) ggTipHide();
});
document.addEventListener('click', function(ev) {
    var c = ev.target.closest ? ev.target.closest('.gg-load-cell') : null;
    if (!c) return;
    if (ggSuppressClick || (ev.target.closest && ev.target.closest('.gg-fill-h'))) return;
    var ri = +c.getAttribute('data-lrow'), i = +c.getAttribute('data-lidx');
    ggTipHide();
    if (ggLoadSel && ggLoadSel.row === ri && ggLoadSel.idx === i) { ggLoadPanelClose(); return; }
    ggLoadPanelOpen(ri, i);
});
document.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape' && ggLoadSel) ggLoadPanelClose();
});

/* --- Запуск --- */
document.getElementById('fApply').addEventListener('click', load);
document.getElementById('fTeam').addEventListener('change', load);
document.getElementById('fStatus').addEventListener('change', load);
document.getElementById('fView').addEventListener('change', function() {
    /* «Месяцы»: период = сегодня … сегодня + 360 дней, конец округляется вверх до воскресенья */
    if (this.value === 'month') {
        var t = new Date(); t.setHours(0, 0, 0, 0);
        var e = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 360);
        while (e.getDay() !== 0) e.setDate(e.getDate() + 1);
        var iso = function(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        document.getElementById('fFrom').value = iso(t);
        document.getElementById('fTo').value = iso(e);
    }
    load();
});
document.getElementById('fType').addEventListener('change', function() {
    // пересобираем список карманов до запроса, чтобы выбранный ПВР не ушёл в фильтр
    fillPocketFilter(ggPocketsAll);
    load();
});

document.getElementById('ggTaskClose').addEventListener('click', ggTaskClose);
document.getElementById('ggTaskCancel').addEventListener('click', ggTaskClose);
document.getElementById('ggTaskSave').addEventListener('click', ggTaskSave);
document.getElementById('ggTaskMask').addEventListener('click', function(ev){ if (ev.target === this) ggTaskClose(); });
document.getElementById('ggDeptChecks').addEventListener('change', function(){ var keepAsg = ggTaskSelectedChecks('ggAssignChecks'); ggTaskBuildAssignChecks(keepAsg); ggTaskRebuildLeadOptions(false); });
document.getElementById('ggFLeadDept').addEventListener('change', function(){ ggTaskRebuildLeadOptions(false); });
document.addEventListener('click', function(ev) {
    var ed = ev.target.closest ? ev.target.closest('.gg-edit[data-edit-tid]') : null;
    if (!ed) return;
    ev.preventDefault(); ev.stopPropagation();
    ggTaskOpen(ed.getAttribute('data-edit-tid'));
});

/* --- Колбаски «Направление» и «Отображение» (выбор хранится в браузере) --- */
var ggShowMode = 'all';
function ggLsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
function ggLsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
function ggSegMark(segId, v) {
    document.querySelectorAll('#' + segId + ' button').forEach(function(b) {
        var on = b.getAttribute('data-v') === v;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}
function ggSetType(v, silent) {
    var sel = document.getElementById('fType');
    var ok = Array.from(sel.options).some(function(o) { return o.value === v; });
    if (!ok) v = '';
    sel.value = v;
    ggSegMark('ggTypeSeg', v);
    ggLsSet('gg.fType', v);
    if (!silent) sel.dispatchEvent(new Event('change'));
}
function ggSetShow(v) {
    if (['tasks', 'banks', 'all'].indexOf(v) < 0) v = 'all';
    var box = document.getElementById('ganttBox');
    var banks = document.getElementById('banksBox');
    var prevMaster = (ggShowMode === 'banks') ? banks : box;
    var pos = prevMaster ? prevMaster.scrollLeft : 0;
    ggShowMode = v;
    document.body.classList.toggle('gg-show-tasks', v === 'tasks');
    document.body.classList.toggle('gg-show-banks', v === 'banks');
    ggSegMark('ggShowSeg', v);
    ggLsSet('gg.show2', v);
    /* скрытая таблица теряет прокрутку, возвращаем ту же позицию обеим */
    if (box) box.scrollLeft = pos;
    if (banks) banks.scrollLeft = pos;
    setupSlider();
}
document.getElementById('ggTypeSeg').addEventListener('click', function(ev) {
    var b = ev.target.closest('button[data-v]'); if (!b) return;
    if (b.classList.contains('active')) return;
    ggSetType(b.getAttribute('data-v'));
});
document.getElementById('ggShowSeg').addEventListener('click', function(ev) {
    var b = ev.target.closest('button[data-v]'); if (!b) return;
    ggSetShow(b.getAttribute('data-v'));
});
document.getElementById('ggMetricSeg').addEventListener('click', function(ev) {
    var b = ev.target.closest('button[data-v]'); if (!b) return;
    ggMetric = b.getAttribute('data-v'); ggLsSet('gg.metric', ggMetric); ggRerender();
});
document.getElementById('ggHcSeg').addEventListener('click', function(ev) {
    var b = ev.target.closest('button[data-v]'); if (!b) return;
    ggHcMode = b.getAttribute('data-v'); ggLsSet('gg.hc', ggHcMode); ggRerender();
});
document.getElementById('ggPlanChk').addEventListener('change', function() {
    ggIncPlan = this.checked; ggLsSet('gg.plan', ggIncPlan ? '1' : '0'); ggRerender();
});
document.getElementById('ggXlsBtn').addEventListener('click', ggExportXls);
ggSetType(ggLsGet('gg.fType') || '', true);
ggSetShow(ggLsGet('gg.show2') || 'banks');

msInit();
msRenderPanel('kind'); msUpdateBtn('kind');
initDates();
loadMeta();
load();

/* П.2/П.3: клик по названию проверки раскрывает/сворачивает банки-участники.
   Делегированный обработчик — строки перерисовываются при каждом load(). */
document.addEventListener('click', function(ev) {
    var el = ev.target.closest ? ev.target.closest('.gg-expandable') : null;
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    var tid = el.getAttribute('data-exp-tid');
    if (!tid) return;
    if (ggExpanded[tid]) delete ggExpanded[tid];
    else ggExpanded[tid] = true;
    if (window.__ggLastData) render(window.__ggLastData);
});

})();
</script>
</body>
</html>'''


# ============================================================
# Регистрация в приложении
# ============================================================
def register(app, db, hooks):
    print('[gantt] v' + __version__ + ' · ' + __description__)

    @app.route('/plugins-assets/gantt.js', methods=['GET'])
    def _g_js():
        resp = app.response_class(_JS, mimetype='application/javascript')
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp

    @app.route('/plugins/gantt/', methods=['GET'])
    def _g_page():
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u:
                return redirect('/login')
            if not user_has(db, u, 'plugin.gantt.use'):
                return redirect('/')
        except Exception:
            return redirect('/login')
        resp = Response(_page_html(), mimetype='text/html')
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return resp

    @app.route('/api/plugins/gantt/meta', methods=['GET'])
    def _g_meta():
        # PATCH v1.0.5: добавлена проверка авторизации
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u:
                return jsonify({'success': False, 'error': 'auth'}), 401
            if not user_has(db, u, 'plugin.gantt.use'):
                return jsonify({'success': False, 'error': 'forbidden'}), 403
        except Exception:
            return jsonify({'success': False, 'error': 'auth'}), 401
        # PATCH v1.0.5: не грузим все данные ради имён отделов/команд
        departments = db.query('SELECT id, name FROM departments ORDER BY name')
        teams = db.query('SELECT id, name FROM teams ORDER BY name')
        try:
            from auth import ensure_csrf as _ensure_csrf
            _csrf = _ensure_csrf()
        except Exception:
            _csrf = ''
        return jsonify({
            'success': True,
            'csrf_token': _csrf,
            'departments': [{'id': d['id'], 'name': d.get('name', '')} for d in departments],
            'teams': [{'id': t['id'], 'name': t.get('name', '')} for t in teams],
        })

    @app.route('/api/plugins/gantt/data', methods=['GET'])
    def _g_data():
        # PATCH v1.0.5: добавлена проверка авторизации
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u:
                return jsonify({'success': False, 'error': 'auth'}), 401
            if not user_has(db, u, 'plugin.gantt.use'):
                return jsonify({'success': False, 'error': 'forbidden'}), 403
        except Exception:
            return jsonify({'success': False, 'error': 'auth'}), 401
        from_d = request.args.get('from', '').strip()
        to_d = request.args.get('to', '').strip()
        try:
            d1 = datetime.strptime(from_d, '%Y-%m-%d').date()
            d2 = datetime.strptime(to_d, '%Y-%m-%d').date()
        except Exception:
            return jsonify({'success': False, 'error': 'bad dates'}), 400
        if d2 < d1:
            d1, d2 = d2, d1
        # Шаг «Месяцы» охватывает год: до 400 дней, остальные виды — до 190.
        _max_span = 400 if request.args.get('view', '') == 'month' else 190
        if (d2 - d1).days > _max_span:
            d2 = d1 + timedelta(days=_max_span)

        # Мультивыбор: department/pocket приходят либо повторами параметра
        # (?department=a&department=b), либо одним CSV (?department=a,b).
        def _multi(name):
            vals = request.args.getlist(name)
            out_v = []
            for v in vals:
                for part in (v or '').split(','):
                    part = part.strip()
                    if part and part not in out_v:
                        out_v.append(part)
            return out_v
        dept_sel = _multi('department')      # список выбранных банков (пусто = все)
        team = request.args.get('team', '').strip()
        status = request.args.get('status', '').strip()
        f_type = request.args.get('task_type', '').strip()
        ov_scope = f_type if f_type in _OV_SCOPES else 'oam'
        # «Розничная без ПВР»: розничные проверки, кроме кармана ПВР
        # (регистр и пробелы в названии кармана не важны).
        def _is_pvr(pk):
            return ''.join((pk or '').split()).lower() == 'пвр'
        no_pvr = (f_type == 'розничная_без_пвр')
        if no_pvr:
            f_type = 'розничная'
        pocket_sel = _multi('pocket')        # список выбранных карманов (пусто = все)
        # Вид задачи: мультивыбор ('audit'|'other'). Если параметр не передан —
        # по умолчанию показываем только аудиторские проверки.
        kind_sel = _multi('task_kind')
        if not kind_sel:
            kind_sel = ['audit']
        kind_set = set(kind_sel)

        data = db.load_all()

        team_ids = None
        if team:
            tm = next((x for x in data.get('teams', []) if x['id'] == team), None)
            if tm:
                team_ids = set(tm.get('member_ids') or [])
                if tm.get('manager_id'):
                    team_ids.add(tm['manager_id'])

        # Сотрудники выбранного банка — нужны для fallback-привязки
        # (задача без прямой привязки task_departments относится к банку
        # через отделы своих исполнителей — как в app._task_matches_dept).
        dept_sel_set = set(dept_sel)
        dept_emp_ids = set()
        if dept_sel_set:
            dept_emp_ids = set(e['id'] for e in data.get('employees', [])
                               if e.get('department_id') in dept_sel_set)

        # Карта сотрудник -> тер банк (отдел) для расчёта нагрузки по банкам.
        emp_dept = {e['id']: (e.get('department_id') or '') for e in data.get('employees', [])}
        dept_name = {d['id']: (d.get('name') or '') for d in data.get('departments', [])}

        days = []
        cur = d1
        while cur <= d2:
            days.append(cur.strftime('%Y-%m-%d'))
            cur += timedelta(days=1)

        today = date.today().strftime('%Y-%m-%d')
        d1_iso = d1.strftime('%Y-%m-%d')
        d2_iso = d2.strftime('%Y-%m-%d')

        logs_by_task = {}
        for l in data.get('log', []):
            tid = l.get('task_id')
            if tid:
                logs_by_task.setdefault(tid, []).append(l)

        out = []
        for t in data.get('tasks', []):
            if status and t.get('status') != status:
                continue
            if ((t.get('task_kind') or 'audit')) not in kind_set:
                continue
            if f_type and (t.get('task_type') or '') != f_type:
                continue
            if no_pvr and _is_pvr(t.get('pocket')):
                continue
            if pocket_sel and (t.get('pocket') or '') not in pocket_sel:
                continue
            assigns = t.get('assignees') or []
            if team_ids is not None and not (set(assigns) & team_ids):
                continue
            if dept_sel_set:
                t_dep_ids = t.get('department_ids') or []
                # OR: задача проходит, если хоть один выбранный банк в прямой привязке,
                # либо (нет прямой привязки) — по отделам исполнителей.
                if dept_sel_set & set(t_dep_ids):
                    pass  # прямая привязка к одному из выбранных банков
                elif not t_dep_ids and (set(assigns) & dept_emp_ids):
                    pass  # fallback: нет прямой привязки -> по отделам исполнителей
                else:
                    continue
            sd = t.get('start_date') or ''
            dl = t.get('deadline') or ''
            if not sd and not dl:
                continue
            # PATCH v1.0.8: не рисуем задачу, если она полностью вне окна.
            # Раньше задача без start_date, но с deadline < d1_iso,
            # растягивалась на всю ширину окна.
            if dl and dl < d1_iso:
                continue
            if sd and sd > d2_iso:
                continue
            active_days = []
            for l in logs_by_task.get(t['id'], []):
                ld = l.get('date') or ''
                if d1_iso <= ld <= d2_iso:
                    try:
                        if float(l.get('hours') or 0) > 0:
                            active_days.append(ld)
                    except Exception:
                        pass
            overdue = bool(dl and dl < today and t.get('status') not in ('done', 'archived'))
            # Тер банки (отделы) задачи — по отделам её исполнителей.
            _direct = [d for d in (t.get('department_ids') or []) if d]
            if _direct:
                t_dept_ids = sorted(set(_direct))
            else:
                t_dept_ids = sorted({emp_dept.get(a, '') for a in assigns if emp_dept.get(a, '')})
            out.append({
                'id': t['id'],
                'name': t.get('name', ''),
                'icon': t.get('icon', '📋'),
                'status': t.get('status', 'active'),
                'start_date': sd or d1_iso,
                'deadline': dl or d2_iso,
                'overdue': overdue,
                'active_days': active_days,
                'stages': t.get('stages') or [],
                'task_type': t.get('task_type') or '',
                'pocket': t.get('pocket') or '',
                'task_kind': t.get('task_kind') or 'audit',
                'load_coef': (lambda v: (float(v) if v not in (None, '') else 0.0))(t.get('load_coef')),
                'dept_ids': t_dept_ids,
                # П.2: руководитель проверки — для коэффициента нагрузки и 👑
                'lead_department': t.get('lead_department') or '',
                'lead_employee': t.get('lead_employee') or '',
            })

        out.sort(key=lambda x: (x['start_date'], x['deadline'], x['name'].lower()))
        pockets = sorted({(_t.get('pocket') or '').strip()
                          for _t in data.get('tasks', [])
                          if (_t.get('pocket') or '').strip()})
        # Тер банки для второй таблицы ("Нагрузка по банкам").
        # Вариант A: если банки выбраны в фильтре — строки = ТОЛЬКО выбранные
        # (и только те из них, что реально встречаются в выборке задач);
        # если фильтр банков пуст — все банки, присутствующие в выборке.
        present = {did for _o in out for did in _o['dept_ids']}
        if dept_sel_set:
            present = present & dept_sel_set
        bank_ids = sorted(present)

        # Ёмкость банка = экспертный коэффициент × нормативная численность
        # по направлению. «Всего ОАМ» = розничная + корпоративная.
        def _num(v):
            try:
                return float(v) if v not in (None, '') else None
            except Exception:
                return None
        dep_by_id = {d['id']: d for d in data.get('departments', [])}
        cap_dirs = (['retail'] if f_type == 'розничная'
                    else ['corp'] if f_type == 'корпоративная'
                    else ['retail', 'corp'])
        # Фактическая численность = сумма долей направлений у работающих сотрудников.
        fact_hc = {}
        for _e in data.get('employees', []):
            if _e.get('fired'):
                continue
            _fd = fact_hc.setdefault(_e.get('department_id') or '', {'retail': 0.0, 'corp': 0.0})
            _fd['retail'] += float(_e.get('dir_retail') or 0)
            _fd['corp'] += float(_e.get('dir_corp') or 0)
        def _cap(dep, fact=False):
            if not dep:
                return None
            tot, has = 0.0, False
            for dr in cap_dirs:
                kf = _num(dep.get('expert_coef_' + dr))
                if fact:
                    hc = (fact_hc.get(dep.get('id')) or {}).get(dr, 0.0)
                else:
                    hc = _num(dep.get('headcount_' + dr))
                if hc is None or kf is None:
                    continue
                tot += hc * kf
                has = True
            return round(tot, 2) if has else None
        banks = [{'id': bid, 'name': dept_name.get(bid, bid),
                  'capacity': _cap(dep_by_id.get(bid)),
                  'capacity_fact': _cap(dep_by_id.get(bid), True)} for bid in bank_ids]
        # Итог ОАМ: ёмкость всех банков (или выбранных в фильтре).
        scope_ids = dept_sel_set if dept_sel_set else set(dep_by_id.keys())
        def _sum_caps(fact):
            cs = [_cap(dep_by_id.get(i), fact) for i in scope_ids]
            cs = [c for c in cs if c is not None]
            return round(sum(cs), 2) if cs else None
        total_capacity = _sum_caps(False)
        total_capacity_fact = _sum_caps(True)
        # Ручные правки загрузки (неделя × банк × срез направления).
        overrides = []
        try:
            _w1 = (d1 - timedelta(days=d1.weekday())).strftime('%Y-%m-%d')
            for _r in db.query('SELECT bank_id, week, value FROM gantt_load_overrides '
                               'WHERE scope = ? AND week >= ? AND week <= ?',
                               (ov_scope, _w1, d2.strftime('%Y-%m-%d'))):
                overrides.append({'bank': _r['bank_id'], 'week': _r['week'],
                                  'value': float(_r['value'] or 0)})
        except Exception:
            overrides = []
        task_overrides = []
        try:
            _tids = {o['id'] for o in out}
            _w1 = (d1 - timedelta(days=d1.weekday() + 7)).strftime('%Y-%m-%d')
            for _r in db.query('SELECT task_id, bank_id, week, value FROM gantt_task_load_overrides '
                               'WHERE week >= ? AND week <= ?', (_w1, d2.strftime('%Y-%m-%d'))):
                if _r['task_id'] in _tids:
                    task_overrides.append({'task': _r['task_id'], 'bank': _r['bank_id'], 'week': _r['week'],
                                           'value': float(_r['value'] or 0)})
        except Exception:
            task_overrides = []
        try:
            can_override = bool(user_has(db, u, 'action.load.override'))
        except Exception:
            can_override = False
        return jsonify({
            'success': True,
            'days': days,
            'tasks': out,
            'today': today,
            'pockets': pockets,
            'banks': banks,
            'total_capacity': total_capacity,
            'total_capacity_fact': total_capacity_fact,
            'overrides': overrides,
            'task_overrides': task_overrides,
            'can_override': can_override,
            'ov_scope': ov_scope,
            'capacity_dirs': cap_dirs,
            'dept_names': dept_name,
            'holidays': data.get('holidays') or {},
        })

    @app.route('/api/plugins/gantt/heatmap', methods=['GET'])
    def _g_heatmap():
        try:
            from auth import current_user, user_has
            u = current_user(db)
            if not u:
                return jsonify({'success': False, 'error': 'auth'}), 401
            if not user_has(db, u, 'plugin.gantt.use'):
                return jsonify({'success': False, 'error': 'forbidden'}), 403
        except Exception:
            return jsonify({'success': False, 'error': 'auth'}), 401
        from_d = request.args.get('from', '').strip()
        to_d = request.args.get('to', '').strip()
        mode = request.args.get('mode', 'week').strip()
        if mode not in ('week', 'day'):
            mode = 'week'
        try:
            d1 = datetime.strptime(from_d, '%Y-%m-%d').date()
            d2 = datetime.strptime(to_d, '%Y-%m-%d').date()
        except Exception:
            # По умолчанию — полгода от сегодня.
            d1 = date.today()
            d2 = d1 + timedelta(days=183)
        if d2 < d1:
            d1, d2 = d2, d1
        # Ограничение ширины. Неделя — до ~1.5 года (181 день остаётся как есть).
        # День — тяжёлый расчёт, поэтому показываем только текущий месяц + 2 полных
        # следующих: до конца месяца через 2 месяца от d1.
        if mode == 'day':
            y, m = d1.year, d1.month + 3  # начало месяца через 3 -> минус день = конец +2-го
            y += (m - 1) // 12
            m = (m - 1) % 12 + 1
            cap = date(y, m, 1) - timedelta(days=1)
            if d2 > cap:
                d2 = cap
        else:
            max_days = 550
            if (d2 - d1).days > max_days:
                d2 = d1 + timedelta(days=max_days)
        data = db.load_all()
        res = _heatmap_compute(data, d1, d2, mode)
        res['success'] = True
        res['mode'] = mode
        res['from'] = d1.strftime('%Y-%m-%d')
        res['to'] = d2.strftime('%Y-%m-%d')
        return jsonify(res)

    # ---------- Ручные правки загрузки по ТБ ----------
    try:
        db.exec('CREATE TABLE IF NOT EXISTS gantt_load_overrides ('
                'bank_id TEXT NOT NULL, week TEXT NOT NULL, scope TEXT NOT NULL, '
                'value REAL NOT NULL, updated_by TEXT DEFAULT \'\', updated_at TEXT DEFAULT \'\', '
                'PRIMARY KEY (bank_id, week, scope))')
    except Exception as _e:
        print('[gantt] не удалось создать gantt_load_overrides:', _e)
    # Ручная нагрузка по конкретной проверке (проверка × банк × неделя)
    try:
        db.exec('CREATE TABLE IF NOT EXISTS gantt_task_load_overrides ('
                'task_id TEXT NOT NULL, bank_id TEXT NOT NULL, week TEXT NOT NULL, '
                'value REAL NOT NULL, updated_by TEXT DEFAULT \'\', updated_at TEXT DEFAULT \'\', '
                'PRIMARY KEY (task_id, bank_id, week))')
    except Exception as _e:
        print('[gantt] не удалось создать gantt_task_load_overrides:', _e)

    def _auth_post(perm):
        try:
            from auth import current_user, user_has, check_csrf
            u = current_user(db)
            if not u:
                return None, (jsonify({'success': False, 'error': 'auth'}), 401)
            if not check_csrf():
                return None, (jsonify({'success': False, 'error': 'csrf'}), 403)
            if not user_has(db, u, perm):
                return None, (jsonify({'success': False, 'error': 'forbidden'}), 403)
            return u, None
        except Exception:
            return None, (jsonify({'success': False, 'error': 'auth'}), 401)

    @app.route('/api/plugins/gantt/override', methods=['POST'])
    def _g_override():
        u, err = _auth_post('action.load.override')
        if err:
            return err
        body = request.get_json(silent=True) or {}
        scope = (body.get('scope') or 'oam').strip() or 'oam'
        if scope not in _OV_SCOPES:
            return jsonify({'success': False, 'error': 'bad scope'}), 400
        bank_id = (body.get('bank_id') or '').strip()
        if not bank_id or not db.query_one('SELECT id FROM departments WHERE id = ?', (bank_id,)):
            return jsonify({'success': False, 'error': 'bad bank'}), 400
        weeks = body.get('weeks') or []
        if not isinstance(weeks, list) or not weeks or len(weeks) > 120:
            return jsonify({'success': False, 'error': 'bad weeks'}), 400
        clean = []
        for w in weeks:
            try:
                dw = datetime.strptime(str(w), '%Y-%m-%d').date()
            except Exception:
                return jsonify({'success': False, 'error': 'bad week'}), 400
            if dw.weekday() != 0:
                return jsonify({'success': False, 'error': 'week must be Monday'}), 400
            clean.append(dw.strftime('%Y-%m-%d'))
        val = body.get('value', None)
        if val is not None:
            try:
                val = round(float(val), 2)
            except Exception:
                return jsonify({'success': False, 'error': 'bad value'}), 400
            if val < 0 or val > 1000:
                return jsonify({'success': False, 'error': 'bad value'}), 400
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        who = str(u.get('name') or u.get('login') or u.get('id') or '')
        for w in clean:
            if val is None:
                db.exec('DELETE FROM gantt_load_overrides WHERE bank_id = ? AND week = ? AND scope = ?',
                        (bank_id, w, scope))
            else:
                db.exec('INSERT OR REPLACE INTO gantt_load_overrides '
                        '(bank_id, week, scope, value, updated_by, updated_at) VALUES (?,?,?,?,?,?)',
                        (bank_id, w, scope, val, who, now))
        return jsonify({'success': True, 'count': len(clean)})

    @app.route('/api/plugins/gantt/task_override', methods=['POST'])
    def _g_task_override():
        u, err = _auth_post('action.load.override')
        if err:
            return err
        body = request.get_json(silent=True) or {}
        tid = str(body.get('task_id') or '').strip()
        task = db.query_one('SELECT id, name FROM tasks WHERE id = ?', (tid,)) if tid else None
        if not task:
            return jsonify({'success': False, 'error': 'проверка не найдена'}), 400
        items = body.get('items') or []
        if not isinstance(items, list) or not items or len(items) > 400:
            return jsonify({'success': False, 'error': 'bad items'}), 400
        clean = []
        for it in items:
            if not isinstance(it, dict):
                return jsonify({'success': False, 'error': 'bad item'}), 400
            bank_id = str(it.get('bank') or '').strip()
            if not bank_id or not db.query_one('SELECT id FROM departments WHERE id = ?', (bank_id,)):
                return jsonify({'success': False, 'error': 'bad bank'}), 400
            try:
                dw = datetime.strptime(str(it.get('week') or ''), '%Y-%m-%d').date()
            except Exception:
                return jsonify({'success': False, 'error': 'bad week'}), 400
            if dw.weekday() != 0:
                return jsonify({'success': False, 'error': 'week must be Monday'}), 400
            val = it.get('value', None)
            if val is not None:
                try:
                    val = round(float(val), 2)
                except Exception:
                    return jsonify({'success': False, 'error': 'bad value'}), 400
                if val < 0 or val > 100:
                    return jsonify({'success': False, 'error': 'bad value'}), 400
            clean.append((bank_id, dw.strftime('%Y-%m-%d'), val))
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        who = str(u.get('username') or u.get('name') or u.get('login') or u.get('id') or '')
        log = []
        for bank_id, w, val in clean:
            prev = db.query_one('SELECT value FROM gantt_task_load_overrides WHERE task_id = ? AND bank_id = ? AND week = ?',
                                (tid, bank_id, w))
            if val is None:
                db.exec('DELETE FROM gantt_task_load_overrides WHERE task_id = ? AND bank_id = ? AND week = ?',
                        (tid, bank_id, w))
            else:
                db.exec('INSERT OR REPLACE INTO gantt_task_load_overrides '
                        '(task_id, bank_id, week, value, updated_by, updated_at) VALUES (?,?,?,?,?,?)',
                        (tid, bank_id, w, val, who, now))
            _bn = db.query_one('SELECT name FROM departments WHERE id = ?', (bank_id,))
            log.append({'bank': bank_id, 'bank_name': (_bn['name'] if _bn else bank_id), 'week': w,
                        'from': (float(prev['value']) if prev else None), 'to': val})
        try:
            import json as _json
            db.exec('INSERT INTO audit_log (ts, user_id, username, kind, entity, entity_id, details) VALUES (?,?,?,?,?,?,?)',
                    (now, u.get('id'), who, 'load_override', 'task', tid,
                     _json.dumps({'items': log}, ensure_ascii=False)))
        except Exception as _e:
            print('[gantt] audit load_override:', _e)
        return jsonify({'success': True, 'count': len(clean)})

    @app.route('/api/plugins/gantt/export', methods=['POST'])
    def _g_export():
        u, err = _auth_post('plugin.gantt.use')
        if err:
            return err
        import re as _re
        _bad = _re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f]')

        def _s(v, n):
            return _bad.sub('', str(v if v is not None else ''))[:n]
        body = request.get_json(silent=True) or {}
        periods = [_s(p, 40) for p in (body.get('periods') or [])][:600]
        rows = [r for r in (body.get('rows') or [])[:300] if isinstance(r, dict)]
        for r in rows:
            r['name'] = _s(r.get('name'), 120)
        title = _s(body.get('title') or 'Нагрузка по ТБ', 200)
        try:
            return _g_export_xlsx(periods, rows, title)
        except Exception as _e:
            import traceback
            traceback.print_exc()
            print('[gantt] Excel через openpyxl не удался, отдаю CSV:', repr(_e))
            return _g_export_csv(periods, rows, title)

    def _g_export_csv(periods, rows, title):
        import csv

        def _f(v):
            try:
                return float(v)
            except Exception:
                return None
        sio = io.StringIO()
        w = csv.writer(sio, delimiter=';')
        w.writerow([title])
        w.writerow(['Тер банк', 'Ёмкость'] + periods)
        for r in rows:
            vals = r.get('values') or []
            line = [r.get('name') or '', ('' if _f(r.get('cap')) is None else str(_f(r.get('cap'))).replace('.', ','))]
            for pi in range(len(periods)):
                v = _f(vals[pi]) if pi < len(vals) else None
                line.append('' if not v else str(round(v, 2)).replace('.', ','))
            w.writerow(line)
        data = ('\ufeff' + sio.getvalue()).encode('utf-8')
        resp = Response(data, mimetype='text/csv; charset=utf-8')
        resp.headers['Content-Disposition'] = 'attachment; filename=nagruzka_tb_' + date.today().strftime('%Y%m%d') + '.csv'
        resp.headers['X-Export-Format'] = 'csv'
        return resp

    def _g_export_xlsx(periods, rows, title):
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.comments import Comment
        from openpyxl.utils import get_column_letter

        def _f(v):
            try:
                return float(v)
            except Exception:
                return None
        FILLS = {
            1: PatternFill('solid', fgColor='C8E6C9'),
            2: PatternFill('solid', fgColor='81C784'),
            3: PatternFill('solid', fgColor='FFE082'),
            4: PatternFill('solid', fgColor='EF9A9A'),
            5: PatternFill('solid', fgColor='C62828'),
        }
        red_side = Side(style='medium', color='B71C1C')
        thin = Side(style='thin', color='D0D0D0')

        def _lvl(load, cap):
            if load is None or load <= 0 or cap is None:
                return 0
            if cap <= 0:
                return 5
            pc = round(load / cap * 100)
            return 1 if pc < 50 else 2 if pc < 75 else 3 if pc <= 100 else 4 if pc <= 125 else 5

        wb = Workbook()
        sheets = [('Загрузка', 'load'), ('% ёмкости', 'pct')]
        for si, (sname, kind) in enumerate(sheets):
            ws = wb.active if si == 0 else wb.create_sheet()
            ws.title = sname
            ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=12)
            hdr = ['Тер банк', 'Ёмкость'] + periods
            for ci, h in enumerate(hdr, 1):
                c = ws.cell(row=3, column=ci, value=h)
                c.font = Font(bold=True)
                c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
                c.border = Border(top=thin, bottom=thin, left=thin, right=thin)
            for ri, r in enumerate(rows, 4):
                cap = _f(r.get('cap'))
                nc = ws.cell(row=ri, column=1, value=str(r.get('name') or '')[:120])
                if r.get('total'):
                    nc.font = Font(bold=True)
                ws.cell(row=ri, column=2, value=cap)
                vals = r.get('values') or []
                man = r.get('manual') or []
                pln = r.get('plan') or []
                for pi in range(len(periods)):
                    v = _f(vals[pi]) if pi < len(vals) else None
                    c = ws.cell(row=ri, column=3 + pi)
                    if v is not None and v > 0:
                        if kind == 'pct':
                            if cap and cap > 0:
                                c.value = round(v / cap, 4)
                                c.number_format = '0%'
                        else:
                            c.value = round(v, 2)
                    lv = _lvl(v, cap)
                    if lv:
                        c.fill = FILLS[lv]
                        if lv == 5:
                            c.font = Font(color='FFFFFF', bold=True)
                            c.border = Border(top=red_side, bottom=red_side, left=red_side, right=red_side)
                    notes = []
                    if pi < len(man) and man[pi]:
                        notes.append('Задано вручную')
                        c.font = Font(italic=True, bold=(lv == 5), color=('FFFFFF' if lv == 5 else '1A237E'))
                    if pi < len(pln) and _f(pln[pi]):
                        notes.append('В т. ч. предварительно: ' + str(round(_f(pln[pi]), 2)))
                    if notes:
                        c.comment = Comment('\n'.join(notes), 'Трекер')
                    c.alignment = Alignment(horizontal='center')
            ws.column_dimensions['A'].width = 30
            ws.column_dimensions['B'].width = 10
            for ci in range(3, 3 + len(periods)):
                ws.column_dimensions[get_column_letter(ci)].width = 11
            ws.row_dimensions[3].height = 32
            ws.freeze_panes = 'C4'
            lr = 5 + len(rows)
            ws.cell(row=lr, column=1, value='Легенда (% к ёмкости):').font = Font(bold=True)
            for k, (lbl, lv) in enumerate([('0–50%', 1), ('50–75%', 2), ('75–100%', 3), ('100–125%', 4), ('>125%', 5)]):
                c = ws.cell(row=lr + 1 + k, column=1, value=lbl)
                c.fill = FILLS[lv]
                if lv == 5:
                    c.font = Font(color='FFFFFF', bold=True)
            ws.cell(row=lr + 7, column=1, value='Ёмкость = экспертный коэффициент × численность. Курсив — значение задано вручную.')
        bio = io.BytesIO()
        wb.save(bio)
        bio.seek(0)
        fname = 'nagruzka_tb_' + date.today().strftime('%Y%m%d') + '.xlsx'
        resp = Response(bio.getvalue(),
                        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        resp.headers['Content-Disposition'] = 'attachment; filename=' + fname
        return resp

    def on_startup(**ctx):
        print('[gantt] готов — «📅 План проверок» в шапке')

    hooks.on('on_startup', on_startup)

