## Checkpoint - 2026-05-16 19:30 — Subnautica 2 UE4SS Proxy Fix

### Build Status
- Compiles: N/A (Lua mod, no build step)
- Lint: N/A
- Type check: N/A

### Test Metrics
- N/A — manual game-launch verification pending

### Code Modifications Since Last Checkpoint
- Files created: none in repo
- Files modified:
  - `C:\Program Files (x86)\Subnautica 2\Subnautica2\Binaries\Win64\dwmapi.dll`
    — заменён старый proxy v3.0.1 (58KB, 2024-02-14) на experimental (62KB, 2026-05-16)
  - `dwmapi-v301-backup.dll` создан как бекап
- Files deleted: none

### Root Cause Found & Fixed
**Проблема**: старый `dwmapi.dll` (v3.0.1) загружал `Win64/UE4SS.dll` (v3.0.1, нет UE5.6 AOBs).
Experimental `ue4ss/UE4SS.dll` (2026-05-16) не загружался вообще.

**Фикс**: скачан experimental-latest с GitHub, заменён только `dwmapi.dll`.
Новый прокси знает загружать из `ue4ss/` поддиректории.

### Структура после фикса
```
Win64/
├─ dwmapi.dll            ← НОВЫЙ experimental прокси (62KB, 2026-05-16) ✓
├─ dwmapi-v301-backup.dll ← бекап старого
├─ UE4SS.dll             ← старый v3.0.1 (не загружается новым прокси, можно удалить)
└─ ue4ss/
   ├─ UE4SS.dll          ← experimental (16MB, 2026-05-16) ✓
   ├─ UE4SS-settings.ini ← bUseUObjectArrayCache=false, UE5.6 override ✓
   └─ Mods/
      ├─ S2OptimizationFix/scripts/main.lua ← НАШ МОД ✓
      └─ mods.txt  ← S2OptimizationFix : 1 ✓
```

### Git State
- Branch: session/2026-05-13-1905
- Uncommitted changes: (pipeline setupper repo — без изменений в коде)
- Last commit: 46a253d chore(planning): add S27 checkpoints

### Completed Tasks
- Диагноз root cause UE4SS — нашли конфликт версий proxy+DLL
- Скачан experimental-latest (UE4SS_v3.0.1-950-g434da549.zip, 6.7MB)
- Замена dwmapi.dll выполнена через elevation
- Диагноз HDD 100%: Chrome cache пишет на D: (HDD), игра на C: (SSD)

### Remaining Work
- **Верификация UE4SS**: запустить игру, проверить появление `Win64/ue4ss/UE4SS.log`
- Если лог появится — проверить что мод S2OptimizationFix загрузился (смотреть UE4SS.log на ошибки)
- Опционально: удалить ненужный `Win64/UE4SS.dll` (старый v3.0.1)
- Опционально: перенести Chrome cache с D: (HDD) на C: (SSD)

### Blockers
- UE4SS.log не появился при тесте (игра была прервана пользователем)
- Нужно запустить игру вручную и дать ей загрузиться полностью (~30-60 сек)

### Next Steps
1. Запустить Subnautica 2 вручную
2. Подождать полной загрузки главного меню
3. Проверить: `Test-Path "C:\Program Files (x86)\Subnautica 2\Subnautica2\Binaries\Win64\ue4ss\UE4SS.log"`
4. Если True — прочитать начало лога: `Get-Content <путь\UE4SS.log> -TotalCount 30`
5. Если False — попробовать DLL injector (Extreme Injector)
