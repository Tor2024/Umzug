# «Помощник с переездом» — генеральный план v1

Сайт-сервис для перевозки/переезда в Германии. Язык: **русский** (первый, единственный на старте).
Название: «Помощник с переездом». Разработка с нуля; шаблоны Stitch — только справочник элементов.

## 0. Принципы

1. **Начинаем с данных и математики**, интерфейс — следствие модели.
2. **Не усложнять**: одна роль = один экран задач; никаких 9-стадийных пайплайнов.
3. **Не упрощать**: деньги считаются только в одном месте (движок), в целых центах; каждая операция пишется в журнал.
4. Расстояния — через **Google Maps** (Distance Matrix + Geocoding); до появления ключа — структурный fallback OSRM/OSM с тем же интерфейсом.
5. Каждая цена/параметр — в таблице `config`, меняется админом, заказы хранят **снимок расчёта** (изменение тарифов не переписывает старые заказы).
6. **Адаптивность с собственным мобильным дизайном**: не «сжатый десктоп», а переработанные мобильные сценарии (калькулятор пошагово, водитель — мобильный-first, крупные touch-цели ≥44px, нижняя навигация там, где она удобнее верхней).
7. **Безопасность по умолчанию**: пароли scrypt, httpOnly-cookie сессии с истечением, серверная проверка роли на каждом действии, валидация всех входных данных, параметризованный SQL, ключи не в коде (config/env), audit-лог действий.
8. **Гибкость цен**: тарифы и правила (надбавки, НДС, пороги) — данные, не код. Спрос/предложение учитываются через коэффициенты (сезонность, загрузка на дату), которые админ настраивает; расчёт всегда через один движок.
9. **Рабочий процесс решений**: каждое значимое решение прогоняется через 2 параллельных агентов-критиков (изьяны + альтернативы), затем выбор оптимального методом исключения; решение фиксируется в PLAN/DECISIONS.

## 1. Роли и что каждая делает

| Роль | Что делает | Экран |
|---|---|---|
| Клиент | калькулятор → заявка → оплата аванса → контроль статуса → приёмка → оценка | личный кабинет |
| Логист (диспетчер) | видит заявки, назначает машину+бригаду на дату, контролирует конфликт дат | панель логиста |
| Водитель | список «моих рейсов», день переезда: чек-лист погрузки, отметки этапов, подпись клиента | мобильный экран |
| Бухгалтер | счета, оплаты, дуньинг (напоминания), экспорт | панель бухгалтерии |
| Админ | тарифы/параметры (config), пользователи, все заказы | панель админа |

Регистрация — только клиент (сам), с подтверждением e-mail по ссылке. Остальные роли создаёт админ.

## 2. Математическая модель (единственный источник истины — `pricing.ts`)

Всё в **целых центах**. Тарифы из `config` (DB), снимок пишется в заказ.

**Состав заказа (только то, что реально нужно):**
- `база` — тариф за грузовик фиксированного класса (см. п.3: класс машины определяет базу и включённый объём)
- `экипаж` — грузчики: `часы × число × ставка/ч` (часы = погрузка+разгрузка по объёму + дорога/2? НЕТ: дорога отдельно п. ниже)
- `дорога` — км × ставка/км (бесплатных N км), км от Google Distance Matrix
- `этаж` — этаж × ставка за этаж × направление (без лифта)
- `лифт` — ставка за направление (если есть)
- `доп. объём` — (объём − включённый) × ставка/м³
- `картоны` — шт × ставка
- `сборка мебели` — фикс
- `HVZ` — зоны × (сборы администрации + таблички), услуга отдельная
- Надбавки: экспресс +25%, выходной +10%, догруз −15%; НДС 19% (или §19 UStG — переключатель в config); аванс 30%.

**Логистика времени (контроль расписания):**
- `часыПогрузки = max(2, объём × ч/м³)`, `часыРазгрузки = то же на выезде`
- `часыДороги = км / 80` (средняя по автомагистрали, от Google берём и реальное время тоже)
- `рабочийДень бригады = погрузка + дорога + разгрузка`; проверка: ≤ 10 ч (Arbeitszeit), иначе — 2 водителя/ночевка (флаг в заказе, предупреждение логисту)
- **Воскресенье запрещено** (§ 9 ArbZG + запрет движения >7,5 т вс вс — валидация даты на входе)
- Конфликт ресурсов: машина и каждый грузчик не могут быть в двух заказах в один день (проверка пересечения дат ± запас)

**Контроль качества расчёта:** контрольный заказ в тестах — сумма позиций = нетто, НДС = 19%, аванс = 30%, расхождение = 0.

## 3. Парк и классы (упрощённо, 3 класса вместо 4)

| Класс | Машина | Объём | База | Включено м³ |
|---|---|---|---|---|
| A | Transporter 3,5 т | 15 м³ | 340 € | 10 м³ |
| B | LKW 7,5 т | 35 м³ | 540 € | 20 м³ |
| C | LKW 12 т | 55 м³ | 890 € | 40 м³ |

Класс выбирается автоматически по объёму (но логист может сменить). Двух классов таблицы тарифов нет — база = строка в config per класс.

## 4. Жизненный цикл заказа (6 статусов вместо 9)

```
заявка → подтверждена → назначена → в пути → разгрузка/приёмка → закрыт
                              ↘ отмена (клиент или логист, с причиной)
```
- заявка: клиент отправил расчёт; логист видит, звонит/подтверждает
- подтверждена: логист подтвердил (после связи с клиентом), аванс выставлен
- назначена: машина+бригада+дата закреплены (проверки конфликта пройдены)
- в пути: водитель нажал «Выехали» в день переезда
- приёмка: водитель завершил погрузку/разгрузку, клиент подписал протокол
- закрыт: остаток оплачен / счёт закрыт бухгалтерией

## 5. Схема БД (SQLite, better-sqlite3; минимально-достаточная)

```
config(key TEXT PK, value TEXT, updated_at)          — все тарифы и параметры
users(id, email UNIQUE, name, phone, role, password_hash, email_verified, verify_token, verify_expires, active, created_at)
sessions(token PK, user_id, expires_at)              — cookie ms_session
orders(id, ref UNIQUE MS-ГГГГ-NNNN, status, client_id→users, snapshot TEXT(JSON конфиг),
       from_addr, to_addr, from_geo, to_geo,          — адреса + координаты (Google)
       distance_km, duration_min, route_provider,     — результат маршрута
       volume_m3, boxes, floors_from, floors_to, elevator_from, elevator_to,
       kitchen, move_date, vehicle_class A|B|C, vehicle_id, driver_id, mover2_id, mover3_id,
       work_hours, needs_second_driver, hvz_zones,
       net_cents, vat_cents, gross_cents, deposit_cents, deposit_paid, paid_cents, created_at, updated_at)
order_lines(order_id, kind line|adjustment|total, key, label, amount_cents, meta JSON)  — снимок расчёта
trips(order_id UNIQUE, started_at, loaded_at, arrived_at, unload_done_at, notes)         — день переезда
protocol(order_id UNIQUE, items JSON, deviation_m3, notes, signature, prev_hash, hash, signed_at)  — цепочка sha256
invoices(number UNIQUE RE-ГГГГ-NNNN, order_id, amount_cents, status offen|bezahlt|ueberfaellig|storniert, mahn_level, due_date, paid_at)
claims(number SC-ГГГГ-NNNN, order_id, item, amount_cents, status, resolution, created_at)
audit(at, user_email, action, entity, details)
invoice_counter(year, last)
```

Убрано из старой версии: tours (слилось в orders), claims-статусы сокращены, роль support, отдельные driver/codriver поля → driver_id + mover2/3.

## 6. Учёт и контроль (что считаем автоматически)

1. Счёт: финальный после приёмки = остаток (гросс − аванс); GoBD-нумерация без пропусков.
2. Дуньинг: >14 дней просрочки → уровень 1 (+сбор), >30 → уровень 2; проценты по § 288 BGB — подсказка.
3. Кассовый разрыв невозможен: сумма оплат по заказу ≤ гросс; аванс учитывается как оплата.
4. Протокол: хэш-цепочка (GENESIS → …) — нельзя тихо переписать.
5. Audit: каждое действие роли пишется (кто, что, когда).
6. Отчёты простые: заказы за месяц, выручка, долг клиентов, загрузка парка (все — SQL по orders/invoices).

## 7. Интерактивность сайта (что делает его «живым»)

1. **Калькулятор мгновенный**: адреса с автоподсказками (Google Places — позже; сейчас просто поля), км и цена пересчитываются на лету, показывается маршрут и время.
2. **Статус-трекер клиента**: заказ в кабинете — горизонтальные шаги с текущим этапом и «что дальше».
3. **День переезда у водителя**: большие кнопки этапов (выехал → погрузка → в пути → прибыл → разгрузка → подпись), прогресс объёма.
4. **Панель логиста**: колонка «на сегодня/завтра», конфликт-предупреждения при назначении, красные флаги (объём > машины, воскресенье, >10 ч смена).
5. Обратная связь: после закрытия заказа — просьба об оценке (просто 1–5 звёзд, без фейковых отзывов).

## 8. Google Maps — как получить ключ (нужно от вас)

1. Зайти https://console.cloud.google.com → создать проект (бесплатно, нужна карта — привязка карты: будет списание только если превысить бесплатный лимит 10 000 запросов/мес Distance Matrix… фактически $200/мес кредита, для нашего объёма бесплатно).
2. APIs & Services → Library → включить **Geocoding API** и **Distance Matrix API**.
3. APIs & Services → Credentials → Create credentials → API key.
4. Ограничить ключ: Application restrictions = HTTP referrers (для веб) или IP; API restrictions = только два включённых API.
5. Ключ вставить в админке (config `google_maps_api_key`) — код уже читает его оттуда; до этого работает fallback OSRM/OSM с той же структурой ответа.

## 9. Этапы работ (порядок и критерии готовности)

**Э1. Каркас.** Next.js 16 + Tailwind 4 + better-sqlite3, config-таблица, pricing-движок с тестом контрольного расчёта. ✅ = тест математики зелёный.
**Э2. Роли и вход.** users/sessions, вход, регистрация клиента + подтверждение e-mail (ссылка на экране — честное демо), админ создаёт сотрудников. ✅ = каждый входит на свой экран.
**Э3. Калькулятор + заявка.** Поля, маршрут через /api/route (Google → OSRM fallback), расчёт, снимок в БД, статус «заявка». ✅ = заявка видна логисту.
**Э4. Панель логиста.** Список заявок, подтверждение, назначение машины/бригады с проверками (вместимость, конфликты, воскресенье, >10 ч). ✅ = конфликт блокируется.
**Э5. Экран водителя.** Этапы дня, чек-лист, подпись, протокол с хэшем. ✅ = протокол не переписать.
**Э6. Бухгалтерия.** Счёт после приёмки, оплаты, дуньинг. ✅ = сумма оплат сходится.
**Э7. Админ.** config-CRUD (все тарифы), пользователи, парк. ✅ = изменение тарифа влияет только на новые заказы.
**Э8. Публичный сайт.** Главная (услуги + калькулятор + как работаем + честные цифры), юридические страницы (Impressum DDG, AGB, Datenschutz, Widerruf), SEO-минимум (мета, sitemap, robots).
**Э9. Прогон E2E** по всей цепочке + отчёт.

## 10. Что берём из шаблонов Stitch (элементы, а не страницы)

- S1: калькулятор, встроенный в первый экран hero (справа), Trust-полоса из 4 карточек.
- S2/S3: sticky-бокал «предварительная смета» рядом с визардом; полоса вместимости машины с апгрейдом класса; бейджи способов оплаты.
- Внутренние экраны: таблицы со статус-чипами, тёмный верх-бар с ролью, протокол с блоком подписи.

## 10а. Дополнение к БД (гибкость цен)

```
pricing_rules(key TEXT PK, value TEXT, updated_at)   — коэффициенты спроса/сезонности:
    season_<1..12>_pct        (сезонность по месяцам, напр. июль +15)
    load_threshold_pct        (порог загрузки дня, напр. 80)
    load_pct                  (надбавка при превышении порога, напр. +5)
    weekend_pct (+10), express_pct (+25), shared_load_pct (−15)
vehicle_classes(class TEXT PK A|B|C, label, capacity_m3, included_m3, base_cents) — классы машин как данные
```

## 12. Тодо (мелкие шаги)

**Э1. Каркас + движок расчёта**
- [x] 1.1 Scaffold Next.js 16 + Tailwind 4 + TS (чистый, без демо-страниц) + better-sqlite3
- [x] 1.2 `src/lib/pricing.ts`: типы MoveConfig/LineItem/Quote; тарифы приходят параметром
- [x] 1.3 calculateQuote по формуле D1.1 (порядок: subtotal→disc→mult→net→vat→deposit)
- [x] 1.4 Коэффициенты спроса: сезонный (месяц), выходной (суббота+праздники), загрузка — ручной из config
- [x] 1.5 Валидация входа: объём 1–55, км ≥0, этажи 0–10, дата не воскресенье/не праздник/не в прошлом
- [x] 1.6 Контрольный тест: 3 эталона + recalculate(snapshot)==gross (29 проверок — зелёные)
- [x] 1.7 Решение через 2 критика: структура тарифов и коэффициентов → D1
- [x] 1.8 Решение через 2 критика: схема БД + безопасность → D2

**Э2. Роли и вход**
- [x] 2.1 Решение через 2 критика: модель сессий → D3
- [x] 2.2 `src/lib/db.ts`: схема D2 (config, users, sessions, orders+snapshot, order_lines, vehicle_classes, vehicles, trips, assignments, route, protocol, invoices, payments, claims, audit, counters) + seed демо-данных
- [x] 2.3 Пароли: scrypt с per-user солью 'salt:hash'; verify timingSafeEqual
- [x] 2.4 Сессии: sha256 токена в БД (PK), TTL 12ч, ленивая чистка при логине, деактивация пользователя действует мгновенно
- [x] 2.5 `src/lib/auth.ts`: login (lockout 5 неудач/5мин по email, in-memory), requireUser/requireRole/ROLE_HOME, verify-токен одноразовый 24ч (хеш в БД)
- [x] 2.6 Smoke-тест 22 проверки — зелёные; tsc чист
- [x] 2.7 Server actions: login/register/verify/logout + страницы /login /register /verify (+ /account заглушка)
- [x] 2.8 Регистрация клиента: email lowercase, перерегистрация до подтверждения обновляет токен, verify → принудительный вход (без автологина); браузерный E2E пройден (регистрация→verify POST→логин→logout→повторный токен отклонён)

**Э3. Калькулятор + заявка** — /api/route (Google→OSRM fallback), мобильный пошаговый калькулятор, снимок заказа; критики: структура API и снимка
- [x] 3.1 Решение через 2 критика: API/снимок/заявка → D4 (16 пунктов, §13)
- [x] 3.2 `src/lib/geo.ts`: геокод-каскад (Photon→Nominatim→+Deutschland→cleanup→city-fallback), googleDistanceMatrix (ключ из config maps.api_key/env, никогда в ответе), osrmRoute, resolveRoute; таймауты 6с, адрес 3–200 симв
- [x] 3.3 `/api/route?from=&to=` → {km, minutes, provider, error?}; без runtime/dynamic экспортов (Cache Components)
- [x] 3.4 `src/lib/actions.ts` createOrderAction: только kunde (D4.5), сервер сам пересчитывает маршрут (D4.1), нет маршрута → нет заявки (D4.2), recalculate(snap).gross===quote.gross (D4.11), ref через counters, транзакция: orders+order_lines+route, аудит order_created
- [x] 3.5 `src/components/calc-wizard.tsx`: 3 шага (Маршрут/Объём/Услуги), debounce 500мс + reqId-защита от гонок (D4.6), клиентская цена = черновик (D4.13), сабмит только kunde, кнопка disabled при мутации (D4.4)
- [x] 3.6 `/order/{ref}`: владелец или logist/admin (D4.13), баннеры «цена изменилась»/«срок расчёта истёк»
- [x] 3.7 `/account`: список заявок клиента + пустое состояние
- [x] 3.8 Баг-фикс getTariffs: hours_per_m3 хранится ×100 (25) → деление на 100 при чтении (экипаж 65594€ → 996€)
- [x] 3.9 E2E: вход klient@ → /calc (586.6 км OSRM) → 22.5 м³, 1→3 этаж → кухня+HVZ2 → заявка MS-2026-8941; DB-контроль: sum(order_lines)==net_cents=249091, crew meta {hours:17.18}, route provider=osrm, счётчик counters.last=8941; клиентский черновик == сервер (2964.18 €)
**Э4. Панель логиста** — подтверждение, назначение, конфликты; критики: модель конфликтов
- [x] 4.1 Решение через 2 критика: матрица переходов, конфликт-модель → D5 (12 пунктов, §13)
- [x] 4.2 `src/lib/ops.ts`: ALLOWED_TRANSITIONS, canTransition, CLASS_RANK, tariffDrift, assignOrder (транзакция: DELETE→busy-check→INSERT assignments+trips→UPDATE status)
- [x] 4.3 actions.ts: confirmOrderAction (гейт тариф-дрифта), recalcOrderAction (только статус new), cancelOrderAction (cleanup assignments+trips в транзакции), assignOrderAction
- [x] 4.4 `/dispatch`: список (новые сверху), фильтр по статусу, баннеры тариф-дрифта/истечения + кнопка пересчёта, AssignForm с пометкой занятых машин, баннер-сообщения ?msg=
- [x] 4.5 seed: 4 машины (B-MA 1001 A15 / 2002 B35 / 3003 B35 / 4004 C55)
- [x] 4.6 E2E: confirm ✓, назначение без кодрайвера при needsSecondDriver отклонено ✓, назначение с кодрайвером → assigned + 3 assignments + trip ✓, конфликт обоих водителей на ту же дату отклонён (?msg=busy) ✓, занятая машина помечена ref'ом ✓, отмена с cleanup (assignments/trips не тронуты, т.к. принадлежат другому заказу; DB + аудит order_cancelled) ✓

**Э5. Экран водителя** — этапы дня, чек-лист, протокол-хэш; критики: цепочка протокола
- [x] 5.1 Решение через 2 критика: цепочка/иммутабельность/UX → D6 (11 пунктов, §13)
- [x] 5.2 db.ts: protocolHashString (детерминированная строка), verifyChain() (пересчёт всей цепочки)
- [x] 5.3 actions.ts: startRouteAction (assigned→enroute, guard move_date===today), saveProtocolAction (INSERT-only, только enroute, TOCTOU-гварды в транзакции, prev=hash последнего, sanity fact 0..cap×1.5, notes≤2000, подпись обязательна), acceptOrderAction (kunde-владелец, протокол существует)
- [x] 5.4 /driver: мобильный-first (max-w-md), рейсы через trips JOIN (двое водителей видят рейс), «Сегодня» чип, кнопка Выехал только в день переезда, чек-лист (план=order_lines kind=line), блок «Протокол подписан» (append-only UI), счётчик «Цепочка протоколов: валидна · N»
- [x] 5.5 components/driver-checklist.tsx: чек-боксы позиций, факт-объём, заметки, подпись, черновик localStorage protocol_draft_{orderId}, очистка после сохранения
- [x] 5.6 /order/[ref]: баннер приёмки для клиента-владельца при enroute+protocol (D6.7), AcceptanceButton (acceptOrderAction → router.refresh)
- [x] 5.7 api/driver/start/[id]: POST-редирект форма «Выехал» (RSC-friendly)
- [x] 5.8 Фиксы: ALLOWED_TRANSITIONS добавлены assigned→enroute (driver/admin) и enroute→acceptance (kunde/admin) — пропуски Э4-матрицы; order_lines + колонка kind ('line'), INSERT во всех местах обновлён; БД пересоздана
- [x] 5.9 E2E: логин voditel@ → рейс виден → Выехал (guard даты: не сегодня → блок, сегодня → enroute) → чек-лист (план 22.5) → факт 22.3 + подпись «Анна Сафрова» → протокол сохранён (hash a73d4089…, prev GENESIS, deviation −0.2, audit protocol_signed) → цепочка валидна → klient: баннер приёмки → Подтвердить приёмку → статус acceptance ✓
**Э6. Бухгалтерия** — счета, оплаты, дуньинг; критики: учёт авансов
- [x] 6.1 Матрица: enroute→closed (logist/admin) force-close добавлен (D7.6); acceptance→closed был
- [x] 6.2 closeOrderAction: acceptance→closed в транзакции + счёт RE-ГГГГ-0NNN через counters + due = сегодня + finance.due_days (config, 14) + backfill invoice_id у авансового payment (D7.1); forceCloseOrderAction (enroute→closed через формальную acceptance, audit order_force_accepted)
- [x] 6.3 recordPaymentAction: положительный = оплата (invoice_id привязка), отрицательный = возврат (note обязателен, ≤ paid_before, D7.4); overpayment блокируется (D7.2); paid_at ставится при полном покрытии и СБРАСЫВАЕТСЯ при частичном покрытии после возврата (деривация D7.2 — баг найден и исправлен в E2E)
- [x] 6.4 /finance: дашборд (К получению / Просрочено / Поступления / Счетов), реестр счетов с формами оплаты + чип деривации «Оплачен» (paid ≥ amount), журнал платежей (50 последних, отрицательные красным), претензии (создание + статус-combobox), кнопка «Обновить дуннинг» (dunningRefreshAction: >14д lvl1, >30д lvl2, open/overdue → overdue, лениво D7.3)
- [x] 6.5 createClaimAction (SC-ГГГГ-NNNN через counters) + updateClaimStatusAction (new|in_review|offer|resolved|rejected); компенсация по претензии = отрицательный платёж с note SC-номер (D7.8)
- [x] 6.6 clientOrder видит счёт в /order/[ref]: Сумма/Статус/Срок/Оплачено/Остаток к оплате
- [x] 6.7 E2E: логист закрыл MS-2026-8941 → счёт RE-2026-0001 2964,18 € open, аванс 889,25 backfill-нут; finance дашборд «К получению 2 074,93» ✓; платёж 2 074,93 → «Оплачен» (деривация) ✓; претензия SC-2026-0001 150 € → resolved; возврат −150 (note SC) → «Открыт» + остаток 150 ✓; клиент видит счёт ✓
- [x] 6.8 CSV-экспорт `;` немецкий формат (D7.12) — GET /api/finance/csv (auth finance/admin, 401 без сессии), BOM для Excel, Rechnung+Zahlung строки, аудируется csv_export
**Э7. Админ** — config-CRUD, пользователи, парк, коэффициенты спроса; критики: безопасность config
- [x] 7.1 updateTariffsAction (D8.1): validate-all-then-write в одной db.transaction(), normalizeConfigValue двухпроходно, все ошибки списком (TariffBatchResult.errors), clamp отмечается (clamped[]), аудит ОДНА строка config_update с JSON-diff {key:{from,to}}
- [x] 7.2 updateVehicleClassAction (D8.4): label/capacity/included/base/active; capacity синхронизируется у машин класса (UPDATE vehicles) в той же транзакции; delete guard не нужен (классы A/B/C PK, деактивация вместо удаления)
- [x] 7.3 updateStaffUserAction (D8.2/D8.3): role/active/password с last-admin guard (COUNT admin active=1 && target==self → отказ); password reset → hashPassword + invalidateUserSessions + email_verified=1; аудиты user_update (role=/active=/password_reset)
- [x] 7.4 saveVehicleAction + deleteVehicleAction (D8.6): create/edit (plate UNIQUE, class active, capacity из класса), delete только без trips/assignments
- [x] 7.5 updateApiKeyAction (D8.5): пустой submit = не менять (проверено E2E: value "" и аудита нет); аудит maps_key_updated без значения; UI не отображает ключ (password input + «установлен/не установлен»)
- [x] 7.6 /admin страница: тарифы 25 полей одним submit, классы (3 карточки), пользователи (role select/active/password), парк CRUD, аудит 50 + verifyChain-чип, maps.api_key
- [x] 7.7 config backfill: INSERT OR IGNORE недостающих ключей при каждом initDb (finance.due_days найден пустым в старой БД — исправлено)
- [x] 7.8 Drift-детекция исправлена (Э7-критерий): tariffDrift теперь сравнивает calculateQuote(snap.config, ТЕКУЩИЕ getTariffs) vs gross_cents — recalculate(snap) всегда совпадал (читал тарифы из снимка D4.10) и дрифт не ловился; обновлены assignOrder + /dispatch + /order/[ref]
- [x] 7.9 E2E: тариф км 80→90 сохранён (audit diff, заказ 8941 не изменился 296418); floor 3500→5000 → drift-banner «759,46 € → 777,31 €» в /dispatch; confirm при дрифте ЗАБЛОКИРОВАН (status new); пересчёт → 77731 + order_lines floorTo 5000 + audit order_recalculated; после пересчёта confirm ок; last-admin guard (деактивация себя отклонена, active=1); password reset voditel (hash changed, sessions=0, старый пароль false/новый true); класс B 35→40 синхронизировал машины 2002/3003→40 (затем возвращено); delete B-MA 2002 отклонён (2 refs), добавление/удаление B-MA 5005 ок
**Э8. Публичный сайт**
- [x] 8.1 src/lib/site.ts — демо-реквизиты компании (Impressum-данные); главная src/app/page.tsx переписана: hero (текст + фото fleet-sprinter, CTA → /calc), trust-полоса 4 честных факта (без выдуманных рейтингов/статистики), «Как работает» 4 шага, услуги 4 карточки с фото, тёмный CTA, JSON-LD MovingCompany
- [x] 8.2 src/components/site-chrome.tsx — SiteHeader (sticky, логотип, nav, CTA «Рассчитать», Войти) + SiteFooter (услуги/право/контакты, юрссылки, демо-дисклеймер)
- [x] 8.3 Юрстраницы (все с SiteHeader/SiteFooter, RU): /impressum (§ 5 DDG, демо-реквизиты), /datenschutz (DSGVO ст. 6 основания, сроки хранения GoBD 10 лет, cookies § 25 TDDDG), /agb (снимок цены 14 дней, 10 % объём-оговорка, аванс 30 %, HGB 620 €/м³, претензии 3/14 дней § 438 HGB, § 288 BGB проценты), /widerruf (§§ 355/356/357 BGB, 72ч-правило, checkbox отказа не по умолчанию)
- [x] 8.4 SEO: sitemap.ts (5 публичных страниц), robots.ts (disallow /account /dispatch /driver /finance /admin /order /api /login /register /verify), метаданные страниц, JSON-LD MovingCompany
- [x] 8.5 Мобильная адаптивность: hero/trust/steps/services grid с sm/lg брейкпоинтами; calc-wizard max-w пошаговый; /driver max-w-md (уже mobile-first с Э5)

**Э9. E2E прогон + отчёт**
- [x] 9.1 Дымовая проверка: все 15 маршрутов 200 (публичные + auth-страницы), auth-гварды работают (dispatch/admin без сессии → контент login), robots.txt/sitemap.xml корректны
- [x] 9.2 Полный цикл клиента E2E (Playwright): вход klient → /calc 3 шага (586.6 км OSRM, суббота +10 %) → заявка MS-2026-8944 → черновик == сервер до цента (3 260,60 €)
- [x] 9.3 Цикл логиста: подтверждение цены → назначение (vehicle 2 + Мурат + Окан, codriver обязателен при смене >10 ч) → закрытие заказа + счёт RE-2026-0002
- [x] 9.4 Цикл водителя: guard «только в день переезда» → Выехал → чек-лист 7 позиций + факт 22.3 → протокол подписан (hash 03aa411f…, цепочка валидна · 2)
- [x] 9.5 Приёмка клиента: баннер в /order/{ref} → Подтвердить приёмку → статус Приёмка (enroute→acceptance kunde)
- [x] 9.6 Цикл бухгалтера: дашборд обновился (К получению 150,00 после оплаты RE-0002 3 260,60 картой; Поступления 6 224,78), чип «Оплачен» по деривации
- [x] 9.7 Контроль sum(payments)==gross: order 4 → 326060 == 326060 ✓; возврат −150 в order 1 учтён
- [x] 9.8 Регистрация+верификация E2E: register test-user → verify link (POST-кнопка) → login → /account с пустым состоянием
- [x] 9.9 Админ после всех фаз: тарифы/аудит/chain-чип работают; per_km_cents вернул 80 (Э9 нашёл, что возврат Э7 не записался — первый click терялся на redirect; БД = 80)
- [x] 9.10 CSV-экспорт E2E: 401 без сессии; с сессией finance — правильный CSV (Rechnung+Zahlung, немецкий формат 2964,18; -150,00 возврат)
- [x] 9.11 BUG FOUND+FIXED (Э9): calc-wizard черновик считал по DEFAULT_TARIFFS, сервер — по getTariffs() → расхождение цены черновика и заявки при изменённых тарифах; FIX: /calc передаёт getTariffs(getDb()) в CalcWizard (props tariffs, default DEFAULT_TARIFFS)
- [x] 9.12 redirectMsg в dispatch: throw new Error("unreachable") после redirect ронял процесс (unhandledRejection NEXT_REDIRECT exit 1); FIX: return redirect(...) без throw (redirect возвращает never)
- [x] 9.13 DB cleaned после E2E: test order 8944 + test-user удалены, counters RE→1, аудит/сессии очищены, assignments/trips 8941 восстановлены, per_km 80; pristine seed state
- [x] 9.14 Круг 2 верификации: tsc 0 / lint 0 ошибок 0 warnings (было 2 ошибки + 21 warning — все unused imports удалены, useMemo deps + tariffs, setState-in-effect → setTimeout(0) в driver-checklist, EMAIL_RE/r1/cfgCount/fmt мёртвый код убран, rotateSession сигнатура упрощена); pnpm build OK (17 маршрутов); все маршруты 200; auth-гварды подтверждены в браузере после logout (dispatch/admin/account → redirect /login?next=…); robots.txt корректен
- [x] 9.15 Круг 3 (математика/БД, tmp-verify3 30 проверок): эталон B 22.5 м³/586.6 км/сб — все инварианты (base 540, crew 996.63, distance 444.48, этажи 35/105, кухня 180, HVZ 189.80, subtotal==Σlines, net=round(sub×1.10), vat, deposit, remainder, needsSecondDriver, snapshot roundtrip); воскресенье/праздник отклонены; догруз −15% до множителя; пятница mult=0; protocol hash пересчитывается вручную; extraVolume отсутствует при авто-классе (D1.4 — корректно); counters восстановлены MS=8941/RE=1/SC=1 (остатки E2E)
- [x] 9.16 Круг 4 (браузер, после lint-фиксов): клиент → /calc → маршрут 586.6 км → объём 22.5, этажи 1→3 → кухня+HVZ → заявка MS-2026-8942 → серверная цена == черновик до цента (2964.18), sum(order_lines)==net; заказ удалён, counters/audit/sessions сброшены — pristine state
- [x] 9.17 Реальная карта маршрута (D9): Leaflet+OSM без ключей, geometry в route-таблице, карта на /calc /order /dispatch /driver; E2E + vision-проверка скриншота; логист confirm/assign цикл с картой перепроверен
- [x] 9.18 Двусторонняя корректировка + история (D10): флаги pending_snapshot/revision_requested_by, canRevise дедлайны 72/48/24ч, single-writer, order_history + quote_snapshots; E2E все ветки (kunde→logist accept, logist→kunde accept/reject, отмена при pending); tsc/lint чистые
- [x] 9.19 Видимость правок (D10 доп.): revisionFieldDiff в lib/revision.ts (13 полей, человеческие подписи/единицы) — pending-карточка на /order и бокс на /dispatch показывают «старое → новое» по каждому полю + цену diff; /admin секция «История изменений заказов» (listAllOrderHistory, 100 последних, все записи вкл. служебные, человекочитаемые детали, ссылки на заказ); E2E: логист видит «22,5 м³ → 25 м³» + «2 964,18 € → 3 050,46 €», принятие обновляет заказ (25 м³ / 3 050,46 €), история в /admin с ролями и деталями
- [x] 9.20 UX-обратная связь кнопок (@3180): SubmitButton (useFormStatus, disabled + «Выполняется…» + aria-live) на /dispatch /driver /admin; /dispatch redirectMsg(code, ref) → баннер «{ref}: цена подтверждена…» с конкретным текстом на каждое действие (confirmed/assigned/closed/force_closed/cancelled/recalculated/pending + ошибки busy/codriver/drift/…); /order баннеры через ?msg= (accepted/revision_proposed/revision_accepted/revision_rejected/cancelled — переживают router.refresh); AcceptanceButton/RevisionDecision/RevisionForm success через router.replace(?msg=…) вместо исчезающего локального msg; /driver красный баннер ошибок «Выехал» (раньше msg терялся); bug: проп ref→orderRef в CancelForm (ref — зарезервированный React); E2E: подтверждение/назначение/баннеры на /dispatch, /order?msg=accepted, /driver?msg= — все рендерятся
- [x] 9.21 Календарь доступности (D11): availability.ts (dayAvailability effective capacity min(машины подходящего класса, водители−needed+1); monthAvailability clamped [сегодня,+3мес]; nearestFreeDate; DE_HOLIDAYS 2026+2027; resourceBookings: busy=confirmed/assigned/enroute, new→pendingOrders не резервирует) + /api/availability (401 гостям — загрузка парка не анонимам) + availability-calendar.tsx (цвета free/partial/busy/closed, ‹› месяцы, nearestFree подсказка, легенда) на /calc шаг 1
- [x] 9.22 Автоконтроль: createOrderAction — лимит 3 new-заявок клиента + проверка dayAvailability ВНУТРИ tx (busy → отказ с «Ближайшая дата: …» через nearestFreeDate; throw откатывает транзакцию); single source of truth — календарь и валидация из одной функции
- [x] 9.23 Подсказки: логист /dispatch сводка «Ближайшие дни» (5 дней: заказы/машины X/Y/водители W/V/очередь new-заявок); водитель /driver чип «Завтра: {ref}»; клиент /order карточка «Ваша бригада» (имена+машина/номер, БЕЗ телефонов — PII) + «До переезда N дн. · правки до {дата} (72 ч до выезда)»
- [x] 9.24 E2E D11: 401 гостям; Ноябрь 2026 disabled 01.11/08.11/09.11 busy/15.11; клик 17 → дата меняется; Декабрь 25-26.12+5вс=7 disabled; сводка логиста; бригада клиенту; не-kunde → «Войдите» — все зелёные; tsc/lint/build чистые

## 13. Решения (DECISIONS log)

### D1. Модель расчёта (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Формула одна, порядок фиксирован:** `subtotal = Σпозиции (каждая — целые центы, Math.round на месте)` → `disc = round(subtotal × shared_load_pct)` (если догруз) → `mult = season_pct × weekend_pct × load_pct` (одним множителем, каждый — целые проценты) → `net = round((subtotal − disc) × mult)` → `vat = round(net × vat_pct)` один раз → `gross = net + vat` → `deposit = round(gross × deposit_pct)`. НДС к позициям не применяется никогда — двойного начисления нет.
2. **Экипаж оплачивает и время дороги:** `часы_экипажа = погрузка + дорога + разгрузка`, позиция «дорога» = только км сверх бесплатных (топливо/износ). Короткий переезд не теряет маржу.
3. **Семантика экипажа зафиксирована:** `часы = max(2, объём × ч/м³)` — это часы РАБОТЫ БРИГАДЫ; ставка €/ч — за грузчика; ч/м³ — параметр в config.
4. **Доп. объём — только при несоответствии класса объёму** (ручной выбор логистом/клиентом). При автоподборе класса по объёму доплаты нет — иначе двойное начисление.
5. **Коэффициент загрузки дня — ручной** (админ в config: «на дату мало машин → +10%»), автоматический по назначенным заказам — post-MVP (петля цена↔загрузка).
6. **Снимок заказа валиден N дней** (config, по умолч. 14) — после истечения пересчёт.
7. **Снимок = входные данные + применённые тарифы + order_lines + значение mult**, JSON ~2 КБ; воспроизведение recalculate(snapshot) == order.gross — в контрольном тесте.
8. **Округление:** позиции Math.round на месте; net = сумма целых позиций; один round для vat и deposit; banker's rounding не нужен — важно единообразие.
9. **Смена ≤10 ч считается по Google duration** (fallback км/80) — единый источник для цены и логистики.
10. **«Выходной» = суббота + праздники** (воскресенье запрещено); список немецких праздников — данные.
11. **MUST-HAVE услуги MVP:** упаковка (часы экипажа), сборка/разбор за предмет (не фикс), хранение — строкой-партнёром. Пианино/лестница — post-MVP.

**Отклонено:** автоматический коэффициент загрузки (петля), включение НДС в позиции, доп.объём при автоподборе.

### D2. Схема БД и безопасность (после критики 2 агентов, 01.11.2026)

**Принято:**
1. **Таблица `payments` — единственный источник истины по деньгам** (id, order_id, invoice_id NULL, amount_cents, method, paid_at, note); paid/status производные. `paid_cents`/`deposit_paid` в orders не хранятся.
2. **config слит с pricing_rules** (одна таблица, namespace префиксов `pricing.*`); запись только через `setConfig` с **CONFIG_SCHEMA registry** (type int|pct|cents|bool, min/max, парс «0,8»→0.8, клампинг, отклонение NaN).
3. **Snapshot хранит значения, не ссылки** (label+capacity+base_cents+ставки); vehicle_class в orders — только для отчётов; удаление класса запрещено (soft-deactivate).
4. **`assignments`-таблица с UNIQUE(resource_id, move_date)** + всё назначение в `db.transaction()` — гонки двух логистов исключены на уровне БД.
5. **Сессии:** cookie httpOnly+Secure+SameSite=Lax; в БД хэш токена, не сырой; ротация при логине; TTL 12ч idle/30дн max; инвалидация всех сессий при смене пароля/роли.
6. **Login:** lockout по IP+email после 5 неудач (5 мин); verify_token одноразовый (DELETE при использовании), 24ч.
7. **CSRF:** SameSite + проверка Origin в мутирующих API; server actions origin-check не отключать.
8. **Audit:** user_id (не email), action, entity, id, имена полей без значений ПД; ретеншн 180 дней.
9. **`route` вынесена из orders** (order_id, from/to_geo, km, min, provider, fetched_at) — история маршрутов сохраняется.
10. **trips без UNIQUE** (+ move_date, seq); счётчики через общий `counters(prefix, year, last)`.

**Отклонено:** типизированная таблица config (registry проще), миграция order_crew сейчас (опционально позже).

### D3. Модель сессий и аутентификации (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Пароли:** scrypt (node:crypto), per-user случайная соль 16 байт, формат `salt:hash` hex. Фиксированная соль отклонена (одинаковые пароли → одинаковые хеши).
2. **Сессии:** сырой токен 32 байта (crypto.randomBytes), в БД только sha256 (PRIMARY KEY — поиск по индексу); cookie httpOnly + SameSite=Lax; Secure только в NODE_ENV=production (иначе http://localhost не примет cookie). TTL 12ч от логина, БЕЗ скользящего продления и БЕЗ 30-дневного максимума (упрощение). Ленивая чистка просроченных сессий при каждом логине (без cron).
3. **Ротация при логине** = новая строка сессии (не UPDATE старой) — конкурентные устройства не мешают друг другу; аннулируются только при смене пароля (invalidateUserSessions). При смене РОЛИ инвалидация не нужна — роль проверяется на каждый запрос.
4. **Деактивация пользователя (active=0) действует немедленно** — findSession проверяет u.active на каждый запрос.
5. **Lockout подбора пароля:** 5 неудач по EMAIL (не IP+email — IP в server actions ненадёжен, а лок- only по email даёт DoS жертвы; компромисс для демо: in-memory Map, окно 5 мин). Успешный вход сбрасывает счётчик.
6. **Verify email:** токен одноразовый, 24ч, в БД хранится ХЕШ токена; подтверждение через POST (GET-ссылка не «съедает» токен автоматически); после подтверждения → принудительный вход (без автологина). В демо без SMTP ссылка показывается на экране (в аудит НЕ пишется).
7. **Email:** хранится/ищется case-insensitive (COLLATE NOCASE + lowercase при записи); незаверифицированную регистрацию можно повторить — обновляет verify_token.
8. **CSRF:** Next.js server actions уже POST-only с встроенной проверкой Origin — ручной Origin-check не пишем (дубль). SameSite=Lax остаётся для GET-маршрутов.
9. **Аудит:** user_id + action + entity + entity_id; значения ПД не пишем; verify-токены в аудит не попадают.
10. **Демо-пароль** demo1234 у всех seed-аккаунтов (баннер с демо-доступами на /login).

**Отклонено:** 30-дневный absolute TTL, массовая инвалидация при смене роли, ручной Origin-check, per-user выделенный столбец «absolute_expires_at», отдельная таблица pending_users (перерегистрация проще).

### D4. Калькулятор, маршрут и создание заявки (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Сервер не доверяет клиенту в км:** createOrderAction сам заново геокодирует from/to (каскад) и строит маршрут — km из payload клиента игнорируется. Клиентская цена = черновик; финальная всегда от серверного calculateQuote.
2. **Маршрут не резолвится → заявка НЕ создаётся** (ошибка в UI, никаких км=0 молча). /api/route отвечает 200 с {km, minutes, provider, error?}; error без стектрейсов и без ключа.
3. **Ключ maps.api_key никогда не возвращается в API-ответах и не попадает в snapshot.**
4. **Дубли сабмита:** кнопка disabled на время мутации + редирект после создания; rate-limit и каптча — CUT (localhost-демо).
5. **Гость:** client_id NULL + колонки guest_name/guest_email/guest_phone прямо в orders (отдельная таблица — CUT). Заявку создаёт только вошедший kunde (регистрация с главной — требование заказчика); гость может считать, но сабмит ведёт на /login?next=.
6. **Debounce-гонки:** guard по request-id (ignore stale responses); AbortController.
7. **Валидация адресов сервером:** длина ≤200 симв., непустые; таймауты внешних HTTP 5–6 с.
8. **Геокод-каскад остаётся проверенным:** Photon → Nominatim → Nominatim+", Deutschland" → cleanup-проход → city-fallback (проверен на опечатках/кириллице в прошлой итерации).
9. **Snapshot = единственный источник истины цены;** net/vat/gross/... колонки в orders — кэш для списков; order_lines — проекция quote.lines (только генерация при создании, никакой правки). Контроль: sum(order_lines)==subtotal==snapshot.
10. **snapshotVersion:1 в JSON снимка;** recalculate при неизвестной версии не пересчитывает (возвращает ошибку/показывает снимок как есть). recalculate читает тарифы ТОЛЬКО из snap.
11. **createOrderAction сам проверяет recalculate(snapshot).gross===quote.gross** перед INSERT (не только в тесте) — не сходится → 500 + аудит.
12. **quoteValidUntil = гейт перед подтверждением логистом** (Э4): истёк/тарифы изменились → логист видит баннер «требуется пересчёт» и кнопку пересчёта (новый snapshot, старый заменяется, version bump не нужен — версия схемы, не ревизия). Фоновых джобов нет — ленивая проверка на рендере. Пересчёт обновляет и deposit.
13. **/order/{ref} — только по сессии** (владелец client_id==session.id либо logist/admin); ref последовательный — ок, т.к. доступ закрыт auth-гейтом. Гость подтверждение получает после входа.
14. **Валидация услуг сервером:** packHours 0–100, furnitureItems 0–100 добавлены в validateConfig.
15. **Дата:** валидация по календарной дате (T12:00:00 — без полуночных краёв); праздники — общегосударственные 2026 (комментарий в коде); timezone-тонкости — за пределами демо.
16. **express** — ручной чекбокс клиента «срочный (48ч)»; автоматическое определение — post-MVP.

**Отклонено:** rate-limit/каптча/honeypot (демо), отдельная таблица контактов гостя, случайный суффикс ref (auth-гейт достаточен), кэш-таблица маршрутов (пересчёт на сабмите), упрощение каскада до 2 стратегий (каскад уже отлажен).

### D5. Панель логиста: назначения, конфликты, права переходов (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Матрица переходов (одна константа `ALLOWED_TRANSITIONS` + requireRole на каждом экшене):** new→confirmed (logist/admin); confirmed→assigned (logist/admin); assigned→enroute (**driver**, Э5); enroute→acceptance (**клиент**, кнопка в /order/{ref}); acceptance→closed (logist/admin); cancel: kunde — в new/confirmed, logist/admin — в new/confirmed/assigned. Логист НЕ ставит acceptance за клиента; после enroute отмена недоступна.
2. **Отмена = cleanup в той же транзакции:** UPDATE status='cancelled' + DELETE assignments по order_id + DELETE trips по order_id — иначе «фантомные» брони блокируют машину/водителя навсегда.
3. **Переназначение = DELETE→проверка→INSERT в одной db.transaction():** сначала DELETE старых assignments/trips заказа, ПОТОМ проверка конфликтов новых ресурсов (иначе своя же запись триггерит конфликт), затем INSERT + UPDATE orders. Промежуточного «снял, но не назначил» нет; флоу unassign-без-переназначения не делаем.
4. **Все проверки конфликтов ВНУТРИ транзакции** (не до неё — TOCTOU): better-sqlite3 синхронный, BEGIN IMMEDIATE сериализует запись; дубликат ловится на UNIQUE PK с понятным сообщением «машина/водитель уже занят в эту дату».
5. **Одна машина = один заказ в день** (assignments PK(resource_type, resource_id, move_date)); слотов времени нет (CUT — время рейса не моделируем). Known limitation: короткие переезды дважды в день невозможны.
6. **classForced — проверка ранга класса:** если клиент оплатил класс C (classForced) → логист не может назначить класс ниже оплаченного, даже если вместимость B вмещает объём (клиент платил за тариф C). Ранг A<B<C; машина ВЫШЕ класса разрешена (жест сервиса, цена не меняется — snapshot зафиксирован). Проверка capacity_m3 ≥ volume_m3 работает поверх обеих правил. Если класс авто (не forced) — назначаем класс ≥ заказанного.
7. **Тариф-дрифт между confirmed и assigned:** при загрузке страницы назначения И внутри транзакции назначения повторно сравнивать recalculate(текущие тарифы) vs snapshot.gross; разошлось → назначение отклоняется с ошибкой «тарифы изменились — требуется пересчёт». Пересчёт после confirmed ЗАПРЕЩЁН (ломал бы Э6/remainder) — только отмена и новая заявка.
8. **needsSecondDriver — обязательное условие, не бейдж:** если snapshot.quote.needsSecondDriver=true → форма назначения требует codriver (driver2), без него транзакция отклоняется (§9 ArbZG: смена >10 ч одним водителем запрещена). Бейдж показывается и в списке, и в форме.
9. **move_date логистом не меняется** (упрощение: нет уведомлений клиенту); проверка move_date ≥ сегодня при назначении («выехал в прошлое» невозможен); воскресенье/праздники уже валидированы при создании, повторно не проверяются.
10. **Список заявок:** блок «Новые» сверху (created_at ASC), далее по move_date ASC; колонки: ref, клиент, from→to, дата, объём, gross, класс, статус-чип, бейдж needsSecondDriver; фильтр — один select по статусу; поиск/пагинация CUT (limit 200).
11. **trips CUT из Э4:** единственный потребитель trips — Э5 (день водителя); если Э5 обойдётся assignments + orders, trips вообще не пишем (YAGNI). Решение финализируется при Э5.
12. **Аванс при отмене:** денег в системе до Э6 нет; при отмене оплаченного заказа — текст «требуется возврат аванса (учёт в Э6)», никакой логики возврата.

**Отклонено:** 2 рейса/день со слотами времени, изменение move_date логистом, acceptance логистом за клиента, история изменений/audit-лог в панели, уведомления/email/джобы, пагинация и поиск.

### D6. Экран водителя и протокол приёмки (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Протокол ОДИН, итоговый за день, INSERT-only:** создаётся только в статусе enroute; повторное сохранение невозможно (транзакция: SELECT существующего → отказ «протокол уже подписан»; UNIQUE(order_id) страхует на уровне БД). UPDATE-пути в коде НЕ СУЩЕСТВУЕТ (критерий Э5 «протокол не переписать»). Никаких ревизий/версий.
2. **Глобальная hash-цепочка от GENESIS:** `prev_hash = hash последнего протокола (ORDER BY id DESC LIMIT 1)`, не «по заказу» (UNIQUE = 1 звено на заказ ничего не доказывает). Хеш-строка: `sha256(order_id|signed_by_user_id|loaded_json|deviation_m3|notes|signature|prev_hash|signed_at)` — order_id и подписант включены (иначе протокол можно «переставить»); JSON детерминированный (фиксированный порядок ключей). sha256 из db.ts (node:crypto), сторонние крипто-библиотеки — CUT.
3. **День водителя линеен:** [Выехал (assigned→enroute, только driver, только в день move_date — guard move_date===today)] → [ввод факта + notes] → [сохранение протокола] → конец. После сохранения водитель только смотрит. Таймстампы этапов дня (погрузка/прибыл/разгрузка) — CUT (матрица переходов их не знает).
4. **Чек-лист = план (order_lines kind=line) + один факт-объём:** в order_lines НЕТ объёмов (только amount/meta) — «факт по позициям» не с чем сверять. Модель loaded_json: `{"plan_m3": X, "fact_m3": Y, "items": [{key,label,checked}]}` — чек-боксы подтверждения состава, без цифр по позициям; `deviation_m3 = fact_m3 − orders.volume_m3`. Добавление позиций водителем ЗАПРЕЩЕНО конструкцией UI; сверх плана — текст в notes.
5. **deviation не влияет на счёт (информационное):** snapshot заморожен после confirmed (D5.7), расхождение факт−план — основание для claims (Э6), не для автодоплаты. Явно зафиксировано, чтобы не «починить» в будущем.
6. **Подпись = имя клиента, вводимое клиентом** (текст, демо; canvas — CUT): компромисс демо — ввод на устройстве водителя; роль-гвард на экшен сохранения невозможен в этой модели — осознанный компромисс, отмечен здесь.
7. **Переход enroute→acceptance делает КЛИЕНТ (D5.1)** — UI-триггер: /order/{ref} при status=enroute + существующий протокол → баннер «Переезд завершён — подтвердите приёмку» + кнопка. Сохранение протокола НЕ меняет статус; клиентский клик = атомарный экшен «подпись+переход».
8. **Driver-список через assignments (не trips):** `assignments JOIN orders WHERE resource_type='driver' AND resource_id=? AND status IN (assigned,enroute)`; сегодня сверху + предстоящие (move_date ASC), кодрайвер видит заказ тоже. **trips оставлен как пассивная запись** (INSERT в assignOrder не выпиливать — сломает зелёный E2E Э4), UI на trips не строится; кандидат на удаление в Э9 (закрытие D5.11).
9. **Валидация факта:** fact_m3 ≥ 0 и ≤ вместимость×1.5 (sanity), notes ≤ 2000, signature непустое; всё в серверном экшене.
10. **Черновик в localStorage** (`protocol_draft_{orderId}`): перезагрузка не теряет ввод; очистка после сохранения; offline/service worker — CUT.
11. **verifyChain()** — функция пересчёта всей цепочки (SELECT ORDER BY id, проверка prev_hash/hash) + отображение «цепочка валидна» в протоколе; без верификации хеши — декорация.

**Отклонено:** canvas-подпись, два протокола (погрузка/разгрузка), таблица событий дня, редактирование/спор протокола, добавление позиций водителем, live-прогресс объёма, SQLite-триггеры, Merkle-деревья/сторонние таймстампы, уведомления клиенту.

### D7. Бухгалтерия: счета, оплаты, дуньинг (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Счёт = gross (полная сумма), не остаток.** Финальный счёт создаётся при переходе acceptance→closed (логист/админ закрывает) — закрытие триггерит создание счёта в той же транзакции. Аванс — payment с invoice_id NULL; при создании счёта backfill invoice_id по order_id. Истина paid — по ORDER: **статус paid счёта = sum(payments заказа) ≥ gross_cents; invoice_id в payments — справочный** (аванс платится до создания счёта — иначе вечный долг).
2. **Семантика статусов invoices:** status — workflow-поле (open/overdue/in_review/cancelled); **paid — ТОЛЬКО деривация из payments** (stored paid_at не источник истины). Partial payment: 0 < paid < amount → статус остаётся open/overdue, в UI баланс. Overpayment блокируется в транзакции (BEGIN IMMEDIATE, паттерн D5.4).
3. **Дуньинг: сборы CUT, уровни = деривация:** days_overdue > 14 → уровень 1, > 30 → уровень 2; ленивый refresh при рендере /finance (UPDATE dunning_level/status backfill, cron CUT). Подсказка «§ 288 BGB: 5 п.п. выше базовой ставки» текстом. Сбор к amount_cents НЕ начислять (ломает контроль sum(payments) ≤ gross, нет номера документа); при острой нужде — отдельным RE-счётом. in_review ставит finance вручную; дуньинг на in_review — на паузе.
4. **Возврат = отрицательный payment** (отдельные refunds/credit-ноты — CUT): только finance, только для cancelled-заказа или claim-выплаты, в пределах внесённого (−refund ≤ paid_before), note обязателен («возврат аванса»/«SC-…»), INSERT-only (никаких UPDATE/DELETE payments — GoBD).
5. **GoBD-нумерация:** счётчик инкрементируется только при реальном INSERT внутри той же транзакции; отменённый счёт СОХРАНЯЕТ номер (status cancelled, строка не удаляется) — пропусков нет. Создание invoices для cancelled-заказов запрещено (guard). Аванс без счёта не моделируем (счёт не создан → пропуска нет).
6. **Зависший acceptance/enroute (клиент молчит):** logist/admin может закрыть принудительно — расширение ALLOWED_TRANSITIONS: `enroute → closed (logist/admin)`, помечено принудительным в аудите (order_force_closed); счёт создаётся тем же экшеном. Бейдж-напоминание в /dispatch. Email/дедлайны — CUT.
7. **Аванс-баннер (не гейт):** красный баннер в /dispatch и /finance, если deposit_cents не покрыт sum(payments) для confirmed/assigned. Finance вводит ФАКТИЧЕСКУЮ сумму платежа (не кнопку «аванс получен»); недоплата аванса → только бейдж. Жёсткий гейт на выезд — post-MVP.
8. **Claims на деньги не влияют автоматически:** finance вручную регистрирует отрицательный payment с note='SC-…'. Кредит-ноты — CUT.
9. **config-ключ `finance.due_days`** (default 14): due_date = создание счёта + N дней; ключ добавить в CONFIG_SCHEMA.
10. **Дашборд /finance:** открытые счета, сумма к получению (gross − paid по незакрытым), просрочки по уровням, выручка за период (sum положительных payments). Загрузка парка — CUT (/dispatch).
11. **Аудит:** invoice_created, payment_recorded (сумма в details ок — не ПИ), payment_refunded, invoice_cancelled, dunning_refresh, order_force_closed; user_id/entity/entity_id по D2.8. Хеш-цепочка на invoices/payments — CUT (audit-log достаточен).
12. **Экспорт CSV** (одна кнопка, фильтр по периоду): invoices+payments, `;`-разделитель, немецкий формат сумм; «DATEV-совместимость» из формулировок убрать.

**Реализация (E2E-поправки, 01.11.2026):** paid_at при полном покрытии ставится, при частичном покрытии после возврата — СБРАСЫВАЕТСЯ (иначе чип «Оплачен» залипал после −150 € возврата — найдено в E2E). Номер счёта: RE-ГГГГ-0NNN через counters('RE'). Force-close реализован как forceCloseOrderAction (enroute → формальная acceptance → closeOrderAction, audits order_force_accepted + invoice_created).

**Отклонено:** остаточная модель счёта, отдельные refunds/credit-notes, дуньинг-сборы в сумму, cron-джобы, email-напоминания, платёжные хеш-цепочки, полный DATEV-экспорт, автологика переплат.

### D8. Админ-панель: тарифы, классы, пользователи, парк (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Тарифный батч — одна транзакция, validate-all-then-write:** два прохода (normalizeConfigValue по всем ключам → затем writeConfigValue по всем) в одном `db.transaction()`; один submit → все ошибки сразу списком (не fail-fast); clamp молча подрезает, но в фидбеке отмечается; ключи вне CONFIG_SCHEMA игнорируются. Аудит: ОДНА строка `config_update` с JSON-diff изменённых ключей (не 25 записей).
2. **Last-admin guard:** нельзя деактивировать/понизить/сбросить пароль себе, если `COUNT(role='admin' AND active=1) == 1` и target==self — иначе демо запирается насовсем (localhost recovery нет). Аудируются role/deactivate/reset.
3. **Сброс пароля инвалидирует сессии** (invalidateUserSessions, по D3); новый пароль задаёт админ в форме, показ один раз plain text (localhost); verified=1 сразу для staff.
4. **Capacity — single source of truth в vehicle_classes:** vehicle-class wins при расчёте; vehicles.capacity_m3 — денормализованная копия для отображения; при edit класса capacity синхронизируется у машин этого класса (UPDATE vehicles SET capacity_m3). Изменение capacity — только warning, не блок (снимки защищают старые заказы, дрифт-гейт честно блокирует подтверждение).
5. **maps.api_key — маскирование:** не возвращать в HTML value; пустой input + подпись «установлен/не установлен»; пустой submit = не менять; аудит `maps_key_updated` без значения.
6. **Delete guard по заказам** для классов/машин (любой статус заказа — блок); деактивация вместо удаления.
7. **Race тарифов нет:** дрифт-гейт в confirm/assign уже достаточен (recalculate сравнивает с текущими getTariffs()).
8. **Деактивация водителя мягкая:** FK переживёт; фильтр active=1 в списках назначения; существующие assignments показываются с бейджем «деактивирован».
9. **CUT:** company.name редактор (захардкожено), пагинации, поиск, 2FA, экспорт аудита, RBAC-редактор, feature flags, пароль-подтверждения, email-верификация staff.
10. **UI:** /admin гейтится requireRole на странице (instant=false + connection() — динамический рендер без prefetch-кэша).

**Отклонено:** отдельные формы на каждый тариф, генератор паролей, история справочников, миграционный фреймворк, блокировка изменения capacity.

### D9. Реальная карта маршрута (Leaflet) для клиента/водителя/логиста (01.11.2026)

**Принято:**
1. **Leaflet + react-leaflet (бесплатно, без API-ключей):** интерактивная карта с тайлами OpenStreetMap; компонент `src/components/route-map.tsx` ("use client", пины через unpkg-иконки — стандартные ломаются в бандлерах) + `route-map-lazy.tsx` (next/dynamic ssr:false — Leaflet требует window) + `loading`-заглушка.
2. **Геометрия маршрута:** `osrmRoute` в geo.ts теперь `overview=full&geometries=geojson`; RouteResult + `geometry?: [lat,lon][]` (прореживание каждой 5-й точки для лёгкого polyline). Google Distance Matrix геометрию не отдаёт — при провайдере google карта не показывается (geometry undefined — компонент рендерит null).
3. **Хранение:** route.geometry TEXT (JSON) — колонка добавлена в схему; сохраняется в createOrderAction в той же транзакции. Старые заказы без геометрии — карта просто не рендерится.
4. **Где показывается:** /calc шаг 1 (черновой маршрут, высота 220), /order/{ref} (высота 260), /driver карточка рейса (200), /dispatch карточка заказа (200). Админу карта не нужна (справочники). Тёмно-оранжевая polyline #ea580c (accent), маркеры A/B с Popup адресов, fitBounds с pad 0.15.
5. **E2E подтверждено:** /api/route возвращает geometry (29 629 байт Berlin→München); карта видна на /calc (после ввода адресов), /order/MS-2026-8941, /dispatch, /driver (после назначения рейса); скриншот проверен vision-моделью — «оранжевая линия маршрута между двумя маркерами Berlin→München». Playwright-детали: калькулятор sliders/selects через native value setter + input/change event; server-action клики требуют пере-навигацию для свежего снапшота (redirect не обновляет авто).

**Отклонено:** Google Maps JS SDK (нужен ключ), статичная картинка-заглушка (фейк), карты в /admin (не нужны), polygone-точная геометрия (прореживание достаточно).

### D10. Двусторонняя корректировка заказа + история заказа (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **НЕ новый статус, а флаги на orders:** `pending_snapshot` (JSON QuoteSnapshot), `revision_requested_by` ('kunde'|'logist'|NULL), `current_version` (int, default 1). Основной snapshot IMMUTABLE всегда: правка живёт в pending до подтверждения другой стороной; откат бесплатный; матрица переходов не тронута.
2. **Proposer ≠ confirmer:** клиент подтверждает логист-предложение, логист/admin — клиентское; kunde только владелец (client_id === user.id).
3. **Одна активная правка (single-writer):** условный UPDATE `WHERE id=? AND pending_snapshot IS NULL AND status IN ('new','confirmed')` — changes===0 → «уже есть правка». Контрофферы/переговоры/счётчик раундов — CUT.
4. **Правки только в new/confirmed** (критик 2 победил критика 1): в assigned нельзя никому — только отмена (машина уже на capacity).
5. **Дедлайны (якорь 08:00 Europe/Berlin, лето UTC+2):** клиент 72 ч / логист 48 ч до move_date; express (48-часовое окно) — 24 ч обеим. Серверный гвард canRevise() в revision.ts (CLIENT_CUTOFF_H=72, LOGIST_CUTOFF_H=48, EXPRESS_CUTOFF_H=24, EXPRESS_WINDOW_H=48); UI-подсказка «Правки возможны ещё ~N ч».
6. **Пересчёт серверный** по текущим тарифам БД (клиент патчит параметры, не цены): buildRevisionSnapshot → merge patch в snap.config → validateConfig → calculateQuote(getTariffs) → makeSnapshot (свежий quoteValidUntil 14 дней). REVISABLE_FIELDS: volumeM3, floors, elevators, boxes, kitchen, furnitureItems, packHours, hvzZones, extraCrew, express, sharedLoad. Адреса/дата НЕ редактируются (только отмена + новая заявка).
7. **«Логист молчит» — display-only:** бейдж по возрасту заявки (>24ч «ждите», >48ч «можете отменить»); авто-отмена/джобы/уведомления — CUT; клиент может отменить в new в любой момент (матрица).
8. **Отмена сильнее правки:** cancelOrderAction очищает pending_snapshot/revision_requested_by той же транзакцией.
9. **Pending блокирует pipeline:** confirm/assign отклоняются при активной правке (гварды в экшенах + скрытие кнопок в UI).
10. **История заказа = отдельная таблица order_history** (id, order_id, at, actor_user_id, actor_role, action, client_visible, details JSON): order_created, revision_proposed (fields diff from→to + old/new gross + reason), revision_accepted (from_gross→to_gross + snapshot_versions), revision_rejected (rejected_gross), status_changed (from/to на каждый переход), cancelled. audit НЕ переиспользуем (PII-риски, служебные записи); logOrderEvent пишет в ОБЕ (history client_visible + audit). Клиент видит client_visible=1 с actor_role вместо имени.
11. **Версии цен = quote_snapshots** (id, order_id, version UNIQUE(order_id,version), snapshot_json, gross_cents, at, actor_user_id): версия 1 при создании заказа (createOrderAction), новая версия при accept правки (saveSnapshotVersion, orders.current_version = MAX+1). UI: аккордеон «Предыдущие цены (N)» на /order.

**Реализация:** db.ts (3 колонки + 2 таблицы + logOrderEvent/saveSnapshotVersion/snapshotVersions/orderHistory), revision.ts (canRevise/hoursUntilMove/orderAgeHours/buildRevisionSnapshot), actions.ts (proposeRevision/acceptRevision/rejectRevision + status_changed во все переходы + pending-гварды confirm/assign), revision-form.tsx (раскрытие полей, submit proposeRevisionAction), revision-decision.tsx (Принять/Отклонить), /order (PendingRevisionCard + бейдж «логист молчит» + карточка правки + История заказа + аккордеон версий), /dispatch (чипы правок + оранжевый бокс kunde-предложения + RevisionDecision + RevisionForm логиста; AssignForm скрыт при pending).

**E2E (все зелёные):** клиент создал заявку 2 964,18 → правка объём 25 → pending-карточка «Клиент запросил изменение, Ожидайте решения логиста», форма скрыта (single-writer) → логист: чип + оранжевый бокс «новая цена 3 050,46 €» → Принил → gross 3 050,46, объём 25, version 2 → логист предложил 27 м³ → клиент Принил → 3 119,48 € (экипаж пересчитан 1 127,13) → клиент снова предложил 30 → логист Отклонил → цена осталась 3 119,48, pending снят → правка при pending 35 + отмена логистом → status cancelled, has_pending=0, revision_requested_by=NULL. История: 6 событий (proposed/accepted ×2, proposed/rejected, cancelled) + order_created. tsc/lint чистые.

**Отклонено:** новый статус «revision» (сломал бы матрицу), замещение снимка без версий, гварды только в UI, переиспользование audit для клиентской истории, уведомления/email, автоодобрение по таймауту, правка адресов/даты, canvas-переговоры, hold машины на время правки.

### D11. Календарь доступности + подсказки/автоконтроль (после критики 2 агентов, 01.11.2026)

**Принято (методом исключения):**
1. **Effective capacity = min(свободные машины подходящего класса, свободные водители − (neededDrivers−1)):** при 0 водителей и 4 машинах день НЕ зелёный; neededDrivers = needsSecond ? 2 : 1 (критик 1/критик 2).
2. **new-заявки НЕ резервируют дату** — учитываются отдельным полем pendingOrders («N заявок в очереди»); арбитраж у логиста (критик 1).
3. **Фильтр по классу на сервере:** клиент с 30+ м³ не видит зелёный день при свободной только машине A (createOrderAction проверяет dayAvailability с volumeM3); календарь на шаге 1 /calc — без фильтра (объём выбирается на шаге 2, порядок шагов не меняем), но сервер честно отклоняет.
4. **Статусы дня:** free (≥2 effective), partial (=1, предупреждение но разрешено), busy (0 — серверный отказ), closed (воскресенье § 9 ArbZG / праздники / прошлое — якорь Europe/Berlin).
5. **createOrderAction — проверка ВНУТРИ транзакции:** dayAvailability(db, moveDate, {volumeM3, needsSecond}) === "busy" → throw с текстом «Ближайшая дата: {nearestFreeDate}» (throw откатывает tx). Single source of truth: календарь и валидация из ОДНОЙ функции (критик 2/HIGH 6).
6. **Лимит заявок:** ≥3 открытых new у клиента → отказ «У вас уже 3 заявки в обработке» (спам-защита, критик 1/п.6).
7. **/api/availability только для авторизованных** (401 гостям) — загрузка парка не раскрывается анонимам (критик 1/п.3); кэш — CUT (живые данные).
8. **Границы месяцев [сегодня, +3 мес]**; пустой месяц → nearestFreeDate подсказка «ближайший свободный день»; праздники 2026+2027 статическим списком (критик 2/HIGH 5).
9. **Подсказки по ролям:** логист — сводка «Ближайшие дни» (5 дней: заказы, машины X/Y, водители W/V, очередь); водитель — чип «Завтра: {ref}»; клиент — карточка «Ваша бригада» (имена + машина/номер, БЕЗ телефонов — PII, критик 1) + «До переезда N дн. · правки до {дата} (72 ч до выезда)».
10. **express не обходит красные дни** (ближайшая дата подсказывается).

**Отклонено:** часовые слоты, буферы, авторенос, SMS/email/уведомления, кэш availability, админ-виджет 7 дней (дублирует /dispatch), partial-предупреждение логисту (сервер отклоняет сам), телефон водителя клиенту, дата-после-объёма (ломает 3-шаговый UX), многодневные рейсы (586 км = 1 занятый день — задокументировано).

**Реализация:** availability.ts (DE_HOLIDAYS 2026+2027, todayIsoBerlin, resourceBookings, dayAvailability, monthAvailability, nearestFreeDate), /api/availability, availability-calendar.tsx (fetch через setTimeout(0) — react-hooks fix, union «error» guard), calc-wizard (календарь на шаге 1), createOrderAction (лимит 3 + dayAvailability в tx), /dispatch сводка 5 дней, /driver бейдж Завтра, /order бригада + подсказка дедлайна.

**E2E (все зелёные):** 401 гостям ✓; календарь Ноябрь 2026 ✓; disabled: 01.11 (прошлое), 08.11/15.11 (вс), 09.11 (busy — 8941 assigned) ✓; клик 17 → дата 2026-11-17 ✓; Декабрь 2026: 25-26.12 праздники + 5 воскресений = 7 disabled ✓; сводка логиста «01.11 · 0 заказ(ов) · 4/4 машин · 2/2 водителей» ✓; бригада клиенту (Мурат Джан + B-MA 2002) ✓; не-kunde → «Войдите в аккаунт» ✓. tsc/lint/build чистые.
