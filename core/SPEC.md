# SPEC каталога `core/`

## Роль каталога

`core/` — runtime приложения: Flask entrypoint, конфигурация, авторизация, SQLite-доступ, загрузчик плагинов, шаблоны и frontend. Папка не является отдельным пакетом: `run.py` запускается из `core`, поэтому относительные пути к БД и конфигу считаются от этого каталога.

## Прямые файлы

| Файл | За что отвечает | Взаимодействие |
|---|---|---|
| `.patches_applied.json` | Служебный журнал применённых патчей. | Используется механизмом обновлений; не редактировать вручную без понимания patcher. |
| `app.py` | Создаёт Flask-приложение, регистрирует страницы/API, CSRF, auth, DB и плагины. | Главный backend-узел; вызывает `TrackerDB`, `auth`, `plugins_loader`, `HookRegistry`, шаблоны. Инициализирует/мигрирует таблицы. |
| `auth.py` | Роли, permissions и проверки доступа. | Вызывается `app.py` и route-обработчиками. Не содержит UI. |
| `backup_db.py` | Резервное копирование SQLite. | Работает с файлом базы; не участвует в каждом HTTP-запросе. |
| `client_version.json` | Версия клиента и последний patch id (`1.0.26`). | Читается обновляющим контуром; не заменяет Git-версию. |
| `config.json` | host, port, debug, secret key, db path, lifetime сессии и net update. | Читается `run.py` и частью startup-логики. Секреты не коммитить. |
| `db.py` | Обёртка SQLite: соединения, запросы, транзакции, миграции/утилиты. | Вызывается `app.py` и plugins; схема — `schema.sql`. |
| `patcher.py` | Применяет JSON-операции обновления к файлам с проверками. | Получает JSON из patch-каталогов; резервные копии/журнал — рядом с core. |
| `plugins_loader.py` | Находит прямые `plugins/*.py`, читает enabled-state, вызывает `register(app, db, hooks)`. | Создаёт/использует `HookRegistry`; плагины регистрируют routes/assets/hooks. |
| `plugins_requirements.txt` | Дополнительные зависимости плагинов. | Подключается только при необходимости; сейчас пуст. |
| `requirements.txt` | Базовые зависимости runtime: Flask и openpyxl. | Используется при установке окружения. |
| `run.py` | CLI/standalone entrypoint. | Загружает config, создаёт app, запускает Flask threaded server. |
| `schema.sql` | Базовая SQL-схема доменных таблиц. | Ориентир для `db.py` и миграций `app.py`; фактические обновления могут быть программными. |
| `xlsx_lite.py` | Утилиты лёгкого Excel/XLSX-экспорта. | Используется export/report plugins и API выгрузок. |

## Backend-поток

1. `run.py` читает `config.json` и вызывает фабрику.
2. `app.create_app()` создаёт `TrackerDB`, применяет совместимые миграции и подключает auth/hooks.
3. `plugins_loader` загружает включённые Python-плагины в стабильном порядке.
4. Flask отдаёт Jinja из `templates/`, общие assets из `static/`, plugin assets — маршрутами плагинов.
5. Изменяющие API проверяют пользователя, permission и CSRF; DB-операции выполняются через `db.py`.
6. После сохранения вызываются зарегистрированные hooks; frontend перечитывает state или обновляет целевой блок.

## Границы ответственности

- Не помещайте SQL в шаблоны или frontend.
- Не добавляйте route непосредственно в plugin JS: route принадлежит `app.py` или `register()` плагина.
- Не считайте `core/plugins/gantt.py` источником логики План2027: План2027 рендерится в `core/static/tracker/tabs.js`, хотя использует данные pockets API.
- Изменение схемы должно иметь миграцию и быть обратимо для существующей SQLite.

См. [plugins/SPEC.md](plugins/SPEC.md), [static/SPEC.md](static/SPEC.md), [templates/SPEC.md](templates/SPEC.md), [patch_runs/SPEC.md](patch_runs/SPEC.md).
