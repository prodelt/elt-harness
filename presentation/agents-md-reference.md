# AGENTS.md — IZI Tracker

> Контекст проєкту для AI-агентів (Codex, Claude Code, Gemini) — **один файл, усі агенти**.
> Пишеться людською мовою, стисло. Живий стан і датований журнал — **НЕ тут**, а в
> `.planning/STATE.md`. Цей файл — тільки стабільні правила проєкту.

## Overview
PWA для логістичних менеджерів: фіксація робочого дня (одометр, зустрічі по регіонах
України), CRM-поля по зустрічах і аналітичний дашборд для admin. Мета — точний облік
виїздів і план/факт по візитах.

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript 5 (strict)
- Tailwind CSS 4 + shadcn/ui + @base-ui/react
- Supabase — auth + Postgres (`@supabase/ssr`), Edge Functions
- react-hook-form + zod (валідація) · ECharts + TanStack Table (аналітика)
- Vitest + Testing Library (unit) · Playwright (e2e)
- Деплой: Vercel (UI) + Supabase (backend)

## Structure
- `src/app/` — маршрути: `(auth)` вхід/реєстрація, `(app)` основний UI, `(admin)` дашборд, `api/`
- `src/components/` — `forms/`, `shared/`, `admin/`, `layout/AppShell`
- `src/lib/actions/` — Server Actions (auth, workDay, contractors, photos)
- `src/lib/validations/` — zod-схеми входів · `src/lib/supabase/` — server.ts / client.ts
- `src/__tests__/` — unit-тести · `e2e/` — Playwright
- `supabase/migrations/` — схема + RPC · `supabase/functions/` — Edge Functions

## Commands
- Dev: `npm run dev` (порт 3001) · Build: `npm run build`
- Lint: `npm run lint` · Types: `npx tsc --noEmit`
- Test: `npm test` (Vitest) · E2E: `npm run test:e2e` (Playwright)
- DB types: `npx supabase gen types typescript --project-id=<id> > src/types/database.types.ts`
- Migrate: `supabase db push` · Deploy: `vercel --prod`

## Code style
- Іменування: `camelCase` для функцій, `PascalCase` для компонентів
- Валідація всіх зовнішніх входів через zod на межах системи
- Жодних секретів у коді — тільки env-змінні; жодного `console.log` у production
- Server Action у формі повертає `void | Promise<void>`

## Testing
- Нові тести → `src/__tests__/`, файли `*.test.ts(x)`; e2e → `e2e/`
- Спершу падаючий тест, потім код (TDD де доречно)
- Не видаляти й не скіпати «червоні» тести — чинити код
- Перед «готово»: `npx tsc --noEmit` + `npm run lint` + `npm test` (+ `build` для ризикових змін)

## Commit & PR
- Одна задача = одна гілка (`feature/<slug>`); коміт `<type>: <опис>` (feat, fix, docs, test)
- PR: заголовок < 70 символів; тіло = Summary + Test plan
- Не комітити: `.env*`, секрети, `node_modules/`, `.next/`, згенеровані артефакти

## Gotchas
- Робочий корінь — вкладена папка `izi-tracker/`, не батьківська
- Auth лише через `getUser()`, не `getSession()`; auth-check усередині кожного Server Action
- Open-redirect у callback блокується перевіркою `startsWith('/') && !startsWith('//')`
- `next/dynamic` з `ssr: false` — лише в Client Component
- Zod v4 API (`z.email()` top-level); після `supabase gen types` — фільтрувати CLI-notice зі stdout
- Push у `origin/master` заблоковано approval-policy → деплой лише через `vercel --prod`

## Memory
Живий стан, поточний фокус і датований журнал — `.planning/STATE.md`;
історія — `.planning/PROJECT-HISTORY.md`. Тут — тільки стабільні правила, **не** записи «2026-…: зробив X».
