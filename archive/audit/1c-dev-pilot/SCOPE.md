ENG=1c-dev-pilot TS=20260417T222012Z

# Scope
- Target: https://1c-developer.vercel.app/ (Ametrin 1C Assistant)
- Authorization: user = owner, blanket consent ("делай что хочешь и оторваться по полной")
- **Live-test budget HALTED** mid-engagement by user ("не трать токени gemini чатбота"). From 2026-04-18 ~01:25 UTC, only passive/static evidence from cached artifacts.
- Stack (inferred): Next.js (prerender), Vercel hosting, Vercel AI SDK v5, Vercel AI Gateway (`ai-gateway.vercel.sh/v3/ai`), upstream model `gemini-3-flash-preview`
- Scope assets:
  - GET / (root)
  - POST /api/chat (UIMessage schema)
  - Client bundles from `/_next/static/chunks/`
- Out of scope: cost-abuse live testing, volumetric DoS, infrastructure beyond public HTTP surface.
