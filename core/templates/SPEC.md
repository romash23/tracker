# SPEC каталога `core/templates/`

## Общая схема

`base.html` задаёт HTML-каркас, viewport, CSRF meta/global, общие CSS и wide-modal assets. Остальные шаблоны расширяют его и подключают свои scripts в blocks. Flask передаёт `static_version`, поэтому ссылки на static обычно имеют query version для сброса кеша.

## Файлы

| Файл | Назначение | Взаимодействие |
|---|---|---|
| `base.html` | Каркас страниц, `<title>`, `app.css`, CSRF, `task_modal_wide.css/js`, body/scripts blocks. | Родитель для login/settings/tracker; изменение влияет на весь UI. |
| `login.html` | Форма входа и гостевое состояние. | POST login route; после входа переход к tracker/settings согласно permissions. |
| `settings.html` | Настройки, справочники, сотрудники/банки и plugin management. | Подключает `settings.js`; backend маршруты `app.py` и plugins. Поле `departments.short_name` редактируется в контуре банков. |
| `tracker.html` | Основная страница трекера: навигация, панели задач/календаря/Gantt/Plan2027/дашбордов. | Подключает tracker JS в порядке boot → core → ui → task_card → tabs; получает CSRF/static_version. |

## Сквозной UI-запрос

Jinja создаёт DOM и globals → JS находит panel/data attributes → `core.js` делает same-origin fetch → Flask route проверяет auth/permission/CSRF → `db.py` читает/пишет SQLite → JSON возвращается в JS → целевой render обновляет DOM.

## Plan2027

Разметка панели находится в `tracker.html`; orchestration и рендер — в `static/tracker/tabs.js`; стили — scoped-блоки `#panel-plan2027` в `static/app.css`; карманы и планы обслуживает `plugins/pockets.py`. Не переносить Plan2027 в Gantt template/API без отдельного решения.

## Правила изменения

- Сохраняйте CSRF meta и `window.REESTR_CSRF`.
- Новые кнопки должны иметь стабильный id/data-attribute, а не зависеть от текста.
- Проверяйте permission-ветки, пустые состояния, light/dark и мобильную ширину.
- Шаблон не должен содержать SQL или бизнес-расчёты.
