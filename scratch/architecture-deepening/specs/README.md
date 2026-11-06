# Спеки углубления архитектуры

Одна спека на карточку: `NN-<slug>.md`, номер совпадает с тикетом в `../issues/`.
Спека — ответ тикета, а не отдельный тикет. Пока спеки нет, тикет открыт.

Шаблон:

- `to-spec`: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes.
- Проектные секции: ADR impact (`none` / `amend` / `supersede`), Seams / test surfaces, Task graph (если карточка больше одной сессии), Acceptance gates, Glossary terms.
- В шапке: `Status: ready-for-agent` для исполнимой спеки; `Status: wontfix` для мотивированного no-go.
- Ссылки — на `review.md`, ADR и тикеты; номера строк и хрупкие пути не вставлять.
