# SPEC каталога `core/static/`

## Роль

Общие клиентские ресурсы, подключаемые базовыми шаблонами и страницами настроек/трекера. Основной frontend трекера находится в [tracker/SPEC.md](tracker/SPEC.md). Plugin-specific assets часто отдаются Python-модулями из `core/plugins/`, а не лежат здесь.

## Файлы

| Файл | Назначение | Подключение/связи |
|---|---|---|
| `app.css` | Общая тема, layout, компоненты, responsive-правила и стили Plan2027. | Подключается через `base.html`; Plan2027-правила должны быть scoped к `#panel-plan2027`, чтобы не менять Sandbox. |
| `plugin_mask.js` | Маски/ограничения UI для plugin-вкладок и разрешений. | Подключается страницей/шаблоном там, где разрешена plugin-навигация. |
| `plugin_theme.js` | Общая работа темы для plugin-контуров. | Синхронизирует theme state с CSS/DOM. |
| `settings.js` | Поведение страницы настроек, справочников и административных форм. | Подключается `settings.html`; обращается к settings API. |
| `task_modal_wide.css` | Дополнительная широкая раскладка карточки задачи/модальных окон. | Загружается `base.html` после `app.css`. |
| `task_modal_wide.js` | Клиентские обработчики широкого task modal. | Загружается `base.html` после body/scripts block. |
| `tracker/` | Основной JS трекера; см. [tracker/SPEC.md](tracker/SPEC.md). | Подключается `tracker.html` в фактическом порядке boot → core → ui → task_card → tabs. |

## Порядок взаимодействия

`base.html` задаёт `app.css`, CSRF meta/global и wide modal assets. Страница `tracker.html` подключает tracker JS, который использует общие DOM-классы и CSS. Для не-GET запросов frontend должен передавать CSRF; для кеширования assets шаблон использует `?v={{ static_version }}`.

## Правила UI

- Селекторы нового блока ограничивайте корневым контейнером.
- После CSS-правки проверяйте light/dark и 1440/390; особое внимание — overflow и наложения.
- Не смешивайте heatmap Gantt plugin и heatmap Plan2027.
