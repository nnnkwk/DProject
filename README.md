<<<<<<< HEAD
# Discord Role Request Bot
=======
# DProject
>>>>>>> 96f1effa0965c9f1a4b4aaecc4660a21840ae098

Discord-бот для одного сервера на **discord.js v14** и **MySQL/MariaDB**: запросы ролей, учёт и архив модераторов, наказания, система обращений (тикеты) и система уровней.

## Возможности

| Модуль | Описание |
| --- | --- |
| **Запросы ролей** | Панель с кнопками «Запросить роли» / «Снять все роли». Каждая выбранная роль — отдельная заявка, модераторы одобряют или отклоняют её кнопками. |
| **Профили модераторов** | Назначение и снятие модераторов, повышение по должностям, предупреждения, выговоры, баллы, недельная статистика. На каждого модератора создаётся форум-тема архива. |
| **Наказания** | `/ban`, `/unban`, `/mute`, `/unmute`, `/kick` с историей в БД и автоматическим снятием временных банов. |
| **Тикеты** | Обращения через кнопку и модальное окно, отдельный канал на каждое обращение, передача командам, архив переписки. |
| **Уровни** | EXP за сообщения и голосовые каналы, роли за уровни, топ участников, карточка `/rank`. |
| **Экономика** | Валюта «Нефриты», выдача и снятие командой `/nefrit`, профиль участника `/profile`. |
| **Магазин** | Товары за Нефриты: `/addmarket` добавляет товар, сообщение магазина в канале обновляется автоматически, покупка по кнопке. |
| **Доступ к командам** | Права по должностям настраиваются в БД (таблица `commands_access`). |

## Стек

- Node.js **≥ 20.11** (ESM)
- [discord.js](https://discord.js.org) `^14.21`
- MySQL / MariaDB (`mysql2`)
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) — генерация карточки `/rank`
- `dotenv`

## Структура проекта

```text
.
├── assets/fonts/            # DejaVu Sans (шрифт для /rank) + лицензия
├── deployment/              # systemd unit для VPS
├── src/
│   ├── index.js             # точка входа, клиент и интенты
│   ├── commands.js          # обработка slash-команд
│   ├── command-definitions.js
│   ├── command-access.js    # проверка доступа через commands_access
│   ├── interactions.js      # кнопки, меню и формы запросов ролей
│   ├── moderation-panel.js
│   ├── moderators.js        # профили, архив, статистика, баллы
│   ├── moderator-positions.js
│   ├── punishments.js       # ban / mute / kick и история
│   ├── tickets.js           # система обращений
│   ├── ticket-teams.js
│   ├── levels.js            # EXP, уровни, роли за уровни
│   ├── economy.js           # Нефриты и /profile
│   ├── market.js            # магазин: /addmarket, /delmarket, покупка
│   ├── rank-card.js         # карточка /rank
│   ├── archive-migration.js
│   └── database.js          # работа с БД
├── deploy-commands.js       # регистрация slash-команд
├── schema.sql               # схема БД
├── .env.example
└── package.json
```

## Быстрый старт

### 1. Создайте бота в Discord

1. В [Developer Portal](https://discord.com/developers/applications) создайте Application и добавьте Bot.
2. Скопируйте токен бота (никому не показывайте).
3. Включите **Message Content Intent** (Bot → Privileged Gateway Intents) — он нужен для архива переписки в тикетах, без него бот не запустится.
4. В OAuth2 → URL Generator выберите scopes `bot` и `applications.commands` и пригласите бота на свой сервер.
5. Выдайте боту права: *View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Manage Roles, Manage Channels, Manage Threads, Ban Members, Kick Members, Moderate Members, Mention Everyone*.
6. Поднимите роль бота **выше** всех ролей, которыми он управляет (должности, роли уровней, каталог ролей).

### 2. Подготовьте базу данных

```sh
mysql -u root -p < schema.sql
```

Скрипт создаст базу `DProject` и все таблицы. Для production рекомендуется отдельный пользователь БД:

```sql
CREATE USER 'discordbot'@'127.0.0.1' IDENTIFIED BY 'STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON discord_role_requests.* TO 'discordbot'@'127.0.0.1';
FLUSH PRIVILEGES;
```

### 3. Настройте окружение

```sh
cp .env.example .env
```

| Переменная | Описание |
| --- | --- |
| `DISCORD_TOKEN` | токен бота |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | ID единственного сервера, на котором работает бот |
| `DB_HOST` | хост БД (по умолчанию `127.0.0.1`) |
| `DB_PORT` | порт БД (по умолчанию `3306`) |
| `DB_USER` | пользователь БД |
| `DB_PASSWORD` | пароль БД |
| `DB_NAME` | имя базы (`discord_role_requests`) |

> `.env` содержит секреты и добавлен в `.gitignore`. Не публикуйте его.

### 4. Запустите

```sh
npm install
npm run deploy:commands   # регистрация slash-команд на сервере
npm start
```

После любого изменения slash-команд повторяйте `npm run deploy:commands`.

## Настройка через SQL

Каналы, категории и роли хранятся в БД, а не в `.env`. Подставляйте реальные Discord ID вместо `..._ID`.

### Каналы

```sql
INSERT INTO bot_settings (id, panel_channel_id, review_channel_id, moderator_forum_channel_id)
VALUES (1, 'PANEL_CHANNEL_ID', 'REVIEW_CHANNEL_ID', 'MODERATOR_FORUM_CHANNEL_ID')
ON DUPLICATE KEY UPDATE
  panel_channel_id = VALUES(panel_channel_id),
  review_channel_id = VALUES(review_channel_id),
  moderator_forum_channel_id = VALUES(moderator_forum_channel_id);
```

| Поле `bot_settings` | Назначение |
| --- | --- |
| `panel_channel_id` | канал с панелью запроса ролей |
| `review_channel_id` | канал, где модераторы проверяют заявки |
| `moderator_forum_channel_id` | форум-канал с архивами модераторов |
| `main_chat_id` | главный чат: считаются сообщения для `/stats` и EXP |
| `level_notify_channel` | канал уведомлений о повышении уровня |
| `market_channel_id` | канал, где бот публикует сообщение магазина |
| `market_message_id` | ID сообщения магазина (заполняется ботом автоматически) |
| `market_log_channel_id` | канал, куда бот отправляет эмбед о каждой покупке |
| `ban_log_channel_id` / `mute_log_channel_id` / `kick_log_channel_id` | каналы логов выданных банов, мутов и киков |
| `economy_log_channel` | канал логов экономики: Нефриты, EXP и уровни |
| `ticket_channel_id` | канал с кнопкой «Создать обращение» |
| `tickets_opened_category_id` / `tickets_held_category_id` / `tickets_closed_category_id` | категории открытых, закреплённых и закрытых обращений |
| `tickets_archive_channel_id` | канал архива переписок |

В форум-канале заранее создайте теги для активных и снятых модераторов (их ID заданы в коде бота).

### Каталог ролей

```sql
INSERT INTO role_servers (name) VALUES ('Название категории');

INSERT INTO available_roles (server_id, discord_role_id, label)
SELECT id, 'DISCORD_ROLE_ID', 'Название роли в меню'
FROM role_servers WHERE name = 'Название категории';
```

### Должности модераторов

```sql
INSERT INTO moderator_position_roles (position_key, discord_role_id) VALUES
  ('moderator', 'ROLE_ID'),
  ('senior_moderator', 'ROLE_ID'),
  ('moderation_curator', 'ROLE_ID'),
  ('deputy_head_moderator', 'ROLE_ID'),
  ('head_moderator', 'ROLE_ID'),
  ('discord_administrator', 'ROLE_ID'),
  ('technical_moderator', 'ROLE_ID');
```

| Ключ | Должность |
| --- | --- |
| `moderator` | Модератор |
| `senior_moderator` | Старший модератор |
| `moderation_curator` | Куратор модерации |
| `deputy_head_moderator` | Заместитель главного модератора |
| `head_moderator` | Главный модератор |
| `discord_administrator` | Администратор Discord |
| `technical_moderator` | Технический модератор (только для тикетов, в `/setmoder` не выбирается) |

### Доступ к командам

Доступ задаётся таблицей `commands_access` (команда → должность). Команда доступна, если у участника есть роль хотя бы одной из разрешённых должностей. Нет записей — доступ закрыт. Владелец сервера и участники с правом Discord «Администратор» имеют доступ ко всем командам.

| Команды | Должности |
| --- | --- |
| `/setmoder`, `/fire`, `/setwarn`, `/setvig`, `/setpoints` | moderation_curator, deputy_head_moderator, head_moderator, discord_administrator |
| `/uplvl` | technical_moderator, deputy_head_moderator, head_moderator, discord_administrator |
| `/ban`, `/unban` | senior_moderator и выше |
| `/stats`, `/mute`, `/unmute`, `/kick` | moderator и выше |
| `/hold`, `/close`, `/pass` | senior_moderator, moderation_curator, deputy_head_moderator, head_moderator, discord_administrator, technical_moderator |
| `/exp`, `/lvl` | moderation_curator, deputy_head_moderator, head_moderator, discord_administrator |
| `/nefrit`, `/addmarket`, `/delmarket` | moderation_curator, deputy_head_moderator, head_moderator, discord_administrator |
| `/rank`, `/leaders`, `/profile` | все участники |

Изменить права можно запросами:

```sql
INSERT IGNORE INTO commands_access (command, moderator_role) VALUES ('kick', 'senior_moderator');
DELETE FROM commands_access WHERE command = 'ban' AND moderator_role = 'senior_moderator';
```

## Команды

### Модераторы

| Команда | Описание |
| --- | --- |
| `/setmoder member name age position` | Назначает модератора, выдаёт роль и создаёт форум-тему архива. При повторном назначении создаётся **новая** тема со ссылкой на предыдущую, счётчики обнуляются. |
| `/fire member reason` | Снимает модератора: убирает роли должностей, помечает архив тегом снятого, добавляет запись о снятии. |
| `/uplvl member` | Повышает на одну должность (модератор → старший → куратор → заместитель → главный). Нельзя повысить до своего уровня и выше, а также самого себя. |
| `/setwarn member amount reason` | Изменяет число предупреждений (`0–3`). Положительное `amount` — выдать, отрицательное — снять. |
| `/setvig member amount reason` | То же для выговоров (`0–3`). |
| `/setpoints member amount reason` | Изменяет баллы (не ниже 0, себе менять нельзя). |
| `/stats` | Личная статистика за неделю: сообщения в главном чате, решённые заявки, муты/баны/кики, закрытые обращения. Неделя считается с понедельника 00:00 по Москве. |

Все изменения профиля попадают в форум-архив модератора отдельными эмбедами.

### Наказания

| Команда | Параметры |
| --- | --- |
| `/ban` | `user`, `time`, `reason`, `clear_messages` (удалить сообщения за 3 дня) |
| `/unban` | `user`, `reason` (необязательно) |
| `/mute` | `user`, `time`, `reason` |
| `/unmute` | `user`, `reason` (необязательно) |
| `/kick` | `user`, `reason` |

Формат срока: `30m`, `2h`, `7d`, `1w`, составной `1d12h` (также `мин`, `ч`, `д`, `н`). Для `/ban` допустимо `навсегда`. Максимум для `/mute` — 28 дней. Временные баны снимаются автоматически (проверка при запуске и раз в минуту). Перед наказанием бот отправляет участнику сообщение с причиной, если ЛС открыты.

**Логи наказаний.** Каждый выданный бан, мут и кик дублируется эмбедом в свой канал (необязательно, можно задать только часть):

```sql
UPDATE bot_settings SET
  ban_log_channel_id = 'BAN_LOG_CHANNEL_ID',
  mute_log_channel_id = 'MUTE_LOG_CHANNEL_ID',
  kick_log_channel_id = 'KICK_LOG_CHANNEL_ID'
WHERE id = 1;
```

В лог попадают пользователь, модератор, срок, причина и дата. Если канал не задан, запись просто не отправляется.

### Тикеты

| Команда | Описание |
| --- | --- |
| `/hold` | Закрепляет обращение за первым модератором и переносит в категорию закреплённых. Остальным команда недоступна. |
| `/pass team` | Передаёт обращение команде: *Техническая модерация* (`technical_moderator`), *Главная модерация* (`head_moderator`, `deputy_head_moderator`), *Кураторы модерации* (`moderation_curator`). |
| `/close` | Закрывает обращение. Автор теряет доступ, 24 часа канал виден модерации, затем переписка отправляется текстовым файлом в архив и канал удаляется. |

Команды работают только внутри канала обращения.

**Как это работает:** при запуске бот публикует в `ticket_channel_id` сообщение с кнопкой → пользователь описывает проблему в окне → создаётся канал `тикет-0001` в категории открытых → бот пингует `senior_moderator` и отправляет эмбед «Обращение к команде поддержки».

### Уровни

| Команда | Описание |
| --- | --- |
| `/rank [user]` | Картинка-карточка участника: место, уровень, прогресс, EXP. |
| `/leaders` | Топ участников по уровню и EXP, 10 на страницу, навигация кнопками. |
| `/exp @user N` | Добавляет или отнимает EXP. |
| `/lvl @user N` | Изменяет уровень относительно текущего (минимум 1). |

**Правила начисления**

- Новый участник начинает с 1 уровня и 0 EXP.
- EXP за сообщения начисляется **только в главном чате** (`main_chat_id`), не чаще раза в `message_cooldown_seconds`.
- EXP за голосовые каналы начисляется каждую минуту; не засчитывается в AFK, при отключённом звуке и если участник один в канале.
- EXP для перехода с уровня `L` на следующий: `5·L² + 50·L + 100`. Максимальный уровень — 1000.
- При повышении уровня бот отправляет эмбед в `level_notify_channel` с упоминанием участника.

**Параметры** хранятся в `level_settings` (перечитываются раз в минуту):

```sql
UPDATE level_settings SET
  message_exp_min = 15,
  message_exp_max = 25,
  message_cooldown_seconds = 60,
  voice_exp_per_minute = 10,
  keep_previous_roles = FALSE
WHERE id = 1;
```

**Роли за уровни** (`level_roles`):

```sql
INSERT INTO level_roles (level, role_id) VALUES
  (5, 'ROLE_ID'),
  (10, 'ROLE_ID'),
  (20, 'ROLE_ID');
```

При `keep_previous_roles = FALSE` остаётся только роль наивысшего достигнутого уровня, при `TRUE` роли накапливаются.

### Экономика

Валюта — **Нефриты**. Баланс хранится в таблице `user_economy`, каждое изменение записывается в `economy_transactions` (кто, кому, сколько, причина, баланс после).

| Команда | Описание |
| --- | --- |
| `/nefrit user amount [reason]` | Выдаёт (`amount > 0`) или снимает (`amount < 0`) Нефриты. Баланс не может стать меньше нуля — в этом случае бот сообщает текущий баланс и ничего не меняет. |
| `/profile [user]` | Профиль участника (свой или указанного). Пока показывает только количество Нефритов. |

### Магазин

| Команда | Описание |
| --- | --- |
| `/addmarket name price` | Добавляет товар: название (до 80 символов, уникальное) и цена в Нефритах. Сообщение магазина в канале обновляется сразу. Максимум 25 товаров (лимит меню выбора Discord). |
| `/delmarket item` | Удаляет товар из магазина. Товар выбирается из подсказок (автодополнение по названию). Сообщение магазина обновляется сразу, история покупок сохраняется. |

Укажите канал магазина:

```sql
UPDATE bot_settings SET market_channel_id = 'MARKET_CHANNEL_ID' WHERE id = 1;
```

Бот публикует эмбед со списком товаров и кнопкой «Купить» при запуске и при каждом `/addmarket`, а при повторных запусках редактирует то же сообщение (если его удалить, опубликует заново).

Канал оповещений о покупках (необязательно):

```sql
UPDATE bot_settings SET market_log_channel_id = 'LOG_CHANNEL_ID' WHERE id = 1;
```

**Покупка:** кнопка «Купить» → меню выбора товара (видно только покупателю, с его балансом) → подтверждение → Нефриты списываются, покупка записывается в `market_purchases` и в `economy_transactions`. Если Нефритов не хватает, подтвердить покупку нельзя. После покупки в канал `market_log_channel_id` приходит эмбед: покупатель, товар и стоимость.

**Логи экономики.** Выдача и снятие Нефритов (`/nefrit`), изменение EXP (`/exp`) и уровней (`/lvl`) записываются эмбедом в один канал:

```sql
UPDATE bot_settings SET economy_log_channel = 'ECONOMY_LOG_CHANNEL_ID' WHERE id = 1;
```

В логе: пользователь, модератор, изменение, значения до и после, причина (для Нефритов) и дата. Покупки в магазине в этот канал не попадают — у них свой лог (`market_log_channel_id`).

Для существующей базы один раз импортируйте `economy-migration.sql`, затем выполните `npm run deploy:commands` и перезапустите бота.

## Деплой на VPS (Debian/Ubuntu + systemd)

Боту не нужны домен, веб-сервер и открытые входящие порты. MariaDB достаточно держать доступной только локально.

```sh
# 1. Пакеты
sudo apt update
sudo apt install -y ca-certificates curl git build-essential mariadb-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Пользователь службы и каталог
sudo adduser --system --group --home /opt/discord-role-request-bot discordbot
sudo chown discordbot:discordbot /opt/discord-role-request-bot

# 3. Код и зависимости
sudo -u discordbot git clone YOUR_REPOSITORY_URL /opt/discord-role-request-bot
cd /opt/discord-role-request-bot
sudo -u discordbot npm ci --omit=dev

# 4. База данных (см. раздел «Подготовьте базу данных»)
sudo mariadb < schema.sql

# 5. Окружение
sudo -u discordbot cp .env.example .env     # заполните значения
sudo chmod 600 .env

# 6. Команды и служба
sudo -u discordbot npm run deploy:commands
sudo cp deployment/discord-role-request-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now discord-role-request-bot
```

Полезные команды:

```sh
sudo systemctl status discord-role-request-bot
sudo journalctl -u discord-role-request-bot -f
sudo systemctl restart discord-role-request-bot
```

**Обновление:** загрузите новые файлы → `npm ci --omit=dev` → при изменении команд `npm run deploy:commands` → `sudo systemctl restart discord-role-request-bot`.

## Скрипты

| Команда | Назначение |
| --- | --- |
| `npm start` | запуск бота |
| `npm run deploy:commands` | регистрация slash-команд на сервере (глобальные команды приложения удаляются) |
| `npm run check` | проверка синтаксиса всех модулей |

## Важно

- Бот рассчитан на **один сервер** (`DISCORD_GUILD_ID`); события с других серверов игнорируются.
- Не добавляйте в каталог роли `@everyone`, роли интеграций и роли выше роли бота.
- Состояние открытых форм хранится в памяти и сбрасывается при перезапуске; созданные заявки сохраняются в БД.
- Если роль не удалось выдать (например, из-за иерархии), заявка возвращается в ожидание.
- Бот не читает содержимое сообщений для статистики — учитывается только их количество. Текст переписки сохраняется лишь в архиве тикетов.
- Все SQL-запросы параметризованы; изменения схемы вносите в `schema.sql`.
