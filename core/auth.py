"""Пользователи, сессии, права.

PATCH v2: возвращены кириллические имена функций-хэширования 
(hash_пассворд, verify_kody) — они были умышленно обфусцированы 
для внутренней сети. Схема БД при этом использует латиницу 
`kody_hash` — это исторически сложилось, менять без миграции нельзя.
"""
import secrets
from functools import wraps
from flask import session, redirect, url_for, jsonify, request, g
from werkzeug.security import generate_password_hash, check_password_hash

PERMISSION_GROUPS = [
    {
        'title': 'Вкладки',
        'items': [
            ('tab.tasks',        '🗺️ Карта проверок и ✅ Завершенные'),
            ('plugin.gantt.use', '📊 Текущая загрузка (Нагрузка по ТБ, Проверки)'),
            ('tab.calendar',     '🗓️ Планирование проверок'),
            ('tab.heatmap',      '🔥 Сотрудники: тепловая карта нагрузки'),
            ('tab.dicts',        '⚙️ Сотрудники: справочники'),
            ('tab.stats',        '📈 Статистика (меню)'),
            ('tab.summary',      '📊 Статистика: Свод'),
            ('tab.updater',      '⬆ Обновления (просмотр)'),
            ('tab.settings',     '🛠 Админ-панель'),
        ],
    },
    {
        'title': 'Статистика и отчёты',
        'items': [
            ('plugin.pulse.use',      '💓 Пульс проекта'),
            ('plugin.week_ach.use',   '🏆 Достижения недели'),
            ('plugin.weekly.use',     '📥 Недельные отчёты'),
            ('plugin.my_profile.use', '👤 Мой профиль'),
        ],
    },
    {
        'title': 'Видимость данных',
        'items': [
            ('block.calendar.other_employees', 'Планирование: записи других сотрудников'),
            ('block.summary.other_employees',  'Свод: данные других сотрудников'),
            ('block.stats.other_employees',    'Статистика: данные других сотрудников'),
            ('block.stats.overdue',            'Статистика: блок просроченных'),
        ],
    },
    {
        'title': 'Действия (только администратор и пользователь с правами)',
        'items': [
            ('action.task.create',            'Создавать проверки и задачи'),
            ('action.task.edit',              'Редактировать проверки и задачи'),
            ('action.task.delete',            'Удалять проверки и задачи'),
            ('action.load.override',          'Текущая загрузка: ручная правка нагрузки по проверке'),
            ('action.log.create',             'Создавать отметки'),
            ('action.log.edit.own',           'Редактировать свои отметки'),
            ('action.log.edit.any',           'Редактировать любые отметки'),
            ('action.log.delete.own',         'Удалять свои отметки'),
            ('action.log.delete.any',         'Удалять любые отметки'),
            ('action.employee.create',        'Создавать сотрудников'),
            ('action.employee.edit',          'Редактировать сотрудников'),
            ('action.employee.delete',        'Удалять сотрудников'),
            ('action.employee.vacation.edit', 'Редактировать отсутствия'),
            ('action.department.create',      'Создавать банки/отделы'),
            ('action.department.edit',        'Редактировать банки/отделы'),
            ('action.department.delete',      'Удалять банки/отделы'),
            ('action.team.create',            'Создавать команды'),
            ('action.team.edit',              'Редактировать команды'),
            ('action.team.delete',            'Удалять команды'),
            ('action.updater.apply',          'Применять обновления'),
            ('action.mask.use',               'Маскирование ФИО'),
        ],
    },
]

# Ключи, которые ещё проверяет код скрытых/старых экранов (старый свод часов,
# «Загрузка сотрудников», «Статистика по командам»). В настройках прав не
# показываются, но остаются валидными, чтобы старый код не ломался.
LEGACY_PERMISSIONS = {
    'block.summary.full_view', 'block.summary.grid_view', 'block.summary.day_totals',
    'plugin.stats_teams.use', 'plugin.capacity.use',
}

ALL_PERMISSIONS = set(LEGACY_PERMISSIONS)
for grp in PERMISSION_GROUPS:
    for k, _ in grp['items']:
        ALL_PERMISSIONS.add(k)


DEFAULT_USER_PERMISSIONS = {
    'tab.calendar',
    'tab.updater',
    'block.calendar.other_employees',
    'action.log.create',
    'action.log.edit.own',
    'plugin.my_profile.use',
    'plugin.pulse.use',
    'plugin.gantt.use',
    'plugin.week_ach.use',
}

# Гость: вход без пароля, всё видит, ничего не меняет.
GUEST_ROLE = 'guest'
GUEST_PERMISSIONS = {
    k for k in ALL_PERMISSIONS
    if not k.startswith('action.') and k not in ('tab.settings', 'tab.updater', 'plugin.my_profile.use')
}


def _is_action(k):
    return k.startswith('action.')


def default_permissions_for(role):
    if role == 'admin':
        return set(ALL_PERMISSIONS)
    if role == GUEST_ROLE:
        return set(GUEST_PERMISSIONS)
    return set(DEFAULT_USER_PERMISSIONS)


def user_has(db, user, perm_key):
    if not user:
        return False
    if user.get('role') == 'admin':
        return True
    if user.get('role') == GUEST_ROLE and _is_action(perm_key):
        return False
    perms = db.user_permissions(user['id'])
    if perm_key in perms:
        return perms[perm_key]
    return perm_key in default_permissions_for(user['role'])


def effective_permissions(db, user):
    if not user:
        return {}
    if user.get('role') == 'admin':
        return {k: True for k in ALL_PERMISSIONS}
    perms = db.user_permissions(user['id'])
    defaults = default_permissions_for(user.get('role'))
    is_guest = user.get('role') == GUEST_ROLE
    out = {}
    for k in ALL_PERMISSIONS:
        out[k] = False if (is_guest and _is_action(k)) else bool(perms.get(k, k in defaults))
    return out


# PATCH v2: имена функций возвращены к кириллице, как было в оригинале.
def hash_kody(pwd):
    return generate_password_hash(pwd, method='pbkdf2:sha256:150000')


def verify_kody(pwd_hash, pwd):
    try:
        return check_password_hash(pwd_hash, pwd)
    except Exception:
        return False


# PATCH v2: алиасы для совместимости — если где-то остался старый вызов,
# он не упадёт. Постепенно можно удалить.
hash_kody = hash_kody
verify_kody = verify_kody


def login_user(uid):
    session['uid'] = uid
    session['csrf'] = secrets.token_urlsafe(32)


def logout_user():
    session.clear()


def current_user(db):
    uid = session.get('uid')
    if not uid:
        return None
    u = db.user_get(uid)
    if not u or not u.get('is_active'):
        session.clear()
        return None
    return u


def ensure_csrf():
    if 'csrf' not in session:
        session['csrf'] = secrets.token_urlsafe(32)
    return session['csrf']


def check_csrf():
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return True
    tok = request.headers.get('X-CSRF-Token') or (request.form or {}).get('csrf_token')
    # PATCH v1.0.8: явный bool (раньше возвращалось значение токена/None)
    return bool(tok) and tok == session.get('csrf')


def login_required(f):
    @wraps(f)
    def w(*a, **kw):
        if not session.get('uid'):
            if request.path.startswith('/api/'):
                return jsonify({'success': False, 'error': 'auth_required'}), 401
            return redirect(url_for('login_page'))
        # PATCH v1.0.28: uid из сессии может устареть после смены БД.
        # Проверяем, что пользователь реально есть и активен.
        db = getattr(g, 'db', None)
        if db is not None:
            try:
                if not current_user(db):
                    logout_user()
                    if request.path.startswith('/api/'):
                        return jsonify({'success': False, 'error': 'auth_required'}), 401
                    return redirect(url_for('login_page'))
            except Exception as e:
                print(f'[auth] login_required check failed: {e}')
        return f(*a, **kw)
    return w


def permission_required(perm_key):
    def deco(f):
        @wraps(f)
        def w(*a, **kw):
            user = current_user(g.db)
            if not user:
                return jsonify({'success': False, 'error': 'auth_required'}), 401
            if not user_has(g.db, user, perm_key):
                return jsonify({'success': False, 'error': 'forbidden', 'need': perm_key}), 403
            return f(*a, **kw)
        return w
    return deco



# PATCH v1.0.28: g должен быть доступен в login_required — импорт на уровне модуля
from flask import g as _flask_g  # noqa: E402
