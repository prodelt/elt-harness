# W10-08: RAG vs no-RAG Comparison

Model: `qwen3:1.7b` | Embed: Google gemini-embedding-2 | Mode: hybrid | 2026-04-28

| # | Project | Question | no-RAG (words/s) | RAG (words/s) | Winner |
|---|---|---|---|---|---|
| 1 | `pipeline` | Що робить loop-guardian і коли він блокує повторні едит… |  (0w/22.7s) | Sorry, I'm not able to provide an answer to that question.[no-context] (11w/73.9s) | **RAG** |
| 2 | `pipeline` | Яка різниця між PreToolUse BLOCK і Stop BLOCK форматами… | PreToolUse BLOCK використовується для підготовки систем перед основними процесами, зазвичай з параметрами інструментів. Stop BLOCK, з іншого боку, виконує функцію (20w/26.5s) | The user's query pertains to the distinction between PreToolUse BLOCK and Stop BLOCK formats, but the provided **Context** contains no relevant information about block formats, programming constructs, or any terminology … (68w/49.1s) | **RAG** |
| 3 | `pipeline` | Яку роль виконує skill-ranker і які 6 критеріїв він вик… |  (0w/24.9s) | The query about the role of skill-ranker and its six criteria cannot be addressed based on the provided context. The context contains information related to a World Athlete Championship, code testing hooks, and metrics, … (58w/48.2s) | **RAG** |
| 4 | `izi-tracker` | Яка основна архітектура izi-tracker — які модулі і як в… |  (0w/35.4s) | The provided context does not contain any information about the architecture or modules of iZi-Tracker. Therefore, it is not possible to answer the question based on the given data.   ### References   * [1] Document Titl… (46w/43.5s) | **RAG** |
| 5 | `izi-tracker` | Як реалізована авторизація і захист маршрутів у izi-tra… | Авторизація у izi-tracker реалізована за допомогою токенів (наприклад, JWT) і сесій, щоб підтвердити авторітет користувача. Маршрути захищуються засобами middleware, таких як AuthMiddleware, який перевіряє, чи користувач… (28w/46.7s) | I do not have enough information to answer your question about the implementation of authentication and route protection in izi-tracker. The provided context does not contain any relevant information about izi-tracker or… (36w/44.3s) | **tie** |
| 6 | `izi-tracker` | Які основні моделі даних (entities) є в проекті та їх к… | Основні моделі даних (entities) в проекті включають:   1. **Клієнти** (Customers) – ім'я, електронна пошта, телефон.   2. **Замовлення** (Orders (18w/35.4s) | ### Main Data Models and Key Fields  The project includes several technical terms as data models, each with specific attributes:   1. **SQL-first**: A technical term, but its key fields likely include attributes like **n… (155w/92.2s) | **RAG** |
| 7 | `law-assistant` | Які джерела законодавства використовує law-assistant і … | Law-assistant використовує джерела законодавства, такі як конституція, федеральні та місцеві закони, регуляторні документи та рішення судів. Пошук відбувається систематично, за допомогою баз джерел, ключових слов та клас… (31w/31.0s) | Law-assistant (Law-Assistant) використовує **джерела законодавства** зі **засобами аналізу документів** (наприклад, DOCX, PDF) та **репозиторіями законодавчих текстів**. Пошук законодавства відбувається за допомогою спец… (327w/94.8s) | **RAG** |
| 8 | `law-assistant` | Яка технологічна архітектура проекту — backend, fronten… | Технологічна архітектура проекту включає:   **Backend** — серверні технології (Node.js, Python, Ruby) для логіки, даних та взаємодії.   **Frontend** — клієнтські технології (React, Angular, Vue) для відображення і взаємо… (43w/27.5s) | The technological architecture of the project is structured as follows:  ### **Backend (Server-side):** 1. **Programming Language:** Python   2. **Framework:** Django (core) or Flask (lightweight, flexible)   3. **Databa… (207w/83.0s) | **RAG** |
| 9 | `sudoviy-master` | Яка основна функція sudoviy-master і яка цільова аудито… | Основна функція sudoviy-master — це організація та аналіз правових документів. Цільова аудиторія — законодавці, адвокати та інші прав (18w/29.6s) | **Основна функція sudoviy-master:**   Sudoviy-master виконує функції аудиту та обробки даних, особливо для **Free Pipeline**. Основною метою є **контроль і якість процесів обробки даних**, включно з перевіркою параметрів… (116w/72.4s) | **RAG** |
| 10 | `sudoviy-master` | Які технології використовуються і яка структура проекту… | Технології використовуються: фронтенд — React (або Vue), бекенд — Node.js (або Django), база даних — PostgreSQL (або MongoDB). Структура проекту включає: src (код), public (публічні файли), assets (запасні відтворення), … (40w/28.3s) | Відповідь:  ### **Технології, використовувані в проекті** 1. **Python** – основна мова програмування, використовується для написання скриптових інструментів (наприклад, `run_free.py`, `run_main.py`, `Audit_Free_Pipeline.… (260w/109.6s) | **RAG** |

## Summary
| Metric | Value |
|---|---|
| RAG wins | 9/10 |
| no-RAG wins | 0/10 |
| Ties | 1/10 |
| Avg time no-RAG | 30.8s |
| Avg time RAG | 71.1s |
