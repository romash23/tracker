# SPEC каталога `core/plugins/`

## Контракт загрузки

`core/plugins_loader.py` обходит только прямые Python-файлы этой папки, пропускает `_*.py`, отключённые записи и модули без `register`. Подключаемый модуль обычно экспортирует `register(app, db, hooks)`. Внутри него регистрируются Flask routes, hooks и иногда inline HTML/JS/CSS. JSON рядом — конфигурация/метаданные, не исполняемый plugin.

`plugins_loader` сохраняет enabled-state атомарно через временный файл и `os.replace`. Переключение не удаляет уже зарегистрированные routes/hooks из работающего процесса — после изменения нужен перезапуск, если требуется полностью изменить контур.

## Файлы

| Файл | Назначение и реальные связи |
|---|---|
| `auto_close_overdue.py` | Автозакрытие/перевод просроченных задач; startup/периодическая логика. Отключён в безопасных defaults из-за статусов, не совпадающих с базовым набором приложения. |
| `auto_close_overdue.json` | Конфигурация/описание одноимённого plugin; loader не исполняет JSON как Python. |
| `backfill_task_deps.py` | Backfill/миграционная логика зависимостей задач; не UI. |
| `capacity.py` | Расчёты/представление ёмкости команд и связанные API/asset hooks. |
| `excel_export.py` | Экспорт tracker-данных в XLSX через `xlsx_lite.py`/openpyxl; вызывается из UI/API. |
| `gantt.py` | Gantt-страница, metadata/data/heatmap/override API и встроенный `gantt.js`. Читает pockets data и tracker state; сохраняет gantt overrides. Его heatmap API не является heatmap План2027. |
| `my_profile.py` | Страница/операции профиля сотрудника и связанные пользовательские данные. |
| `my_week.py` | Представление рабочей недели сотрудника и связанные API. |
| `pockets.py` | Справочник карманов и годовые планы. Реальные endpoints: `/plugins-assets/pockets.js`, `/api/plugins/pockets/data`, `/save`, `/bulk`, `/delete`, `/plan/save`, `/plan/delete`. Таблицы создаются/мигрируются приложением. Обновление имени кармана может обновлять `tasks.pocket` с учётом направления и года. |
| `pull_task_summary.py` | Сводит отметки в агрегаты задачи через hook `on_log_save`; если исходная строка не найдена, старые агрегаты сохраняются. Не является удалением отметок. |
| `pulse.py` | Пульс/оперативные показатели и связанные UI/API. |
| `reminders.py` | Напоминания и их startup/API контур. |
| `stats_teams.py` | Командная статистика и её API/UI. |
| `svod.py` | Сводные расчёты и API `/api/plugins/svod/weekly`, `/data`, `/export`; содержит `weekly_compute`, XLSX/HTML helpers. Читает task-level overrides и extensions из Gantt-контура. |
| `task_audit.py` | Аудит изменений задач; подписан на `on_task_save`, пишет историю/служебные данные. |
| `updater.py` | Проверка/доставка обновлений и patch state; взаимодействует с `client_version.json`, `config.net_update` и patcher. |
| `week_achievements.py` | Недельные достижения/виджет и связанные hook/API. |
| `weekly_report.py` | Актуальный недельный отчёт v2: HTML/JS-страница и API weekly data; динамически использует чистые функции из `svod.py` без повторной регистрации routes. |
| `weekly_report.json` | Метаданные/конфигурация weekly report, не исполняемый модуль. |
| `weekly_summary_widget.py` | Встраиваемый weekly summary: выдаёт CSS/JS и может добавлять их в успешный HTML через `after_request`. |

## Сквозные цепочки

### Карманы → Plan2027

`tabs.js` запрашивает `/api/plugins/pockets/data?year=2027` → строит ключ `direction|name` → разделяет corp/retail/other → показывает планы/пустые оси → сохраняет проверки через `/api/tracker/task/save`. Поэтому одинаковый `ПВР` в разных направлениях не сливается.

### Gantt → сводки

Gantt создаёт `gantt_load_overrides` и `gantt_task_load_overrides`; `svod.py` и `weekly_report.py` читают task-level overrides и `task_extensions`. Изменение схемы этих полей требует проверки обоих отчётов.

### Plugin asset

Если JS находится внутри Python-строки, изменять нужно plugin Python и проверять его asset-route. Не создавайте рядом одноимённый `static/*.js`, пока не изменена схема подключения шаблона.

## Правила изменения

1. Сохранить `register(app, db, hooks)` и id/name plugin.
2. Новые API закрыть auth/permission/CSRF в соответствии с политикой `app.py`.
3. Для схемы добавить совместимую миграцию, а не только изменить `schema.sql`.
4. Проверить загрузку plugin в чистой копии БД, route, встроенный asset и hook.
5. После изменения Python: `python -m py_compile`; после inline JS извлечь/проверить его либо прогнать реальный Chromium-сценарий.
6. Не удалять route/hook ожиданием hot-toggle: loader не выгружает уже зарегистрированные объекты без рестарта.
