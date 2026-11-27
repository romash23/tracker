# SPEC репозитория

## Назначение

Репозиторий содержит standalone-трекер на Flask/SQLite. Корневой README — пользовательская точка входа; этот файл — карта ответственности и взаимодействий.

## Файлы корня

| Файл | Ответственность | Связи |
|---|---|---|
| `.gitignore` | Исключает локальную БД, runtime, кэш Python, резервные копии и колёса. | Влияет только на Git, не на runtime. |
| `README.md` | Актуальная документация запуска, возможностей и архитектуры. | Ссылается на SPEC в подпапках. |
| `START.bat` | Windows-обёртка запуска. | Передаёт управление `core/run.py`; не содержит бизнес-логики. |

## Поток запуска

`START.bat` → `core/run.py` → загрузка `core/config.json` → импорт `core/app.py` → `create_app()` → `plugins_loader.load_plugins()` → Flask routes/templates/static → SQLite.

## Правило изменения

Корневые документы не должны описывать функции, которых нет в коде. Для backend сначала сверяйте [core/SPEC.md](core/SPEC.md), для UI — [core/static/SPEC.md](core/static/SPEC.md) и [core/templates/SPEC.md](core/templates/SPEC.md). После правки README/SPEC проверьте ссылки и отсутствие изменённых исходников.

## Контрольные команды

```bash
git status --short
python -m py_compile core/run.py core/app.py core/db.py
node --check core/static/tracker/core.js
node --check core/static/tracker/tabs.js
git diff --check
```
