## Checkpoint - 2026-05-16 18:55 — Subnautica 2 UE4SS Mod

### Статус
UE4SS experimental-latest задеплоен, но UE4SS.log не появляется.
Игра запускается (gamelog есть), но UE4SS не инициализируется.

### Структура в игре (правильная по mariana-sn2 docs)
```
Win64/
├─ dwmapi.dll           ← UE4SS proxy (experimental build)
├─ Subnautica2-Win64-Shipping.exe
└─ ue4ss/
   ├─ UE4SS.dll
   ├─ UE4SS-settings.ini  (bUseUObjectArrayCache=false, MinorVersion=6)
   └─ Mods/
      ├─ S2OptimizationFix/scripts/main.lua  ← НАШ МОД
      ├─ mods.txt  (S2OptimizationFix : 1 добавлен)
      └─ ...стандартные моды...
```

### Что пробовали
- UE4SS v3.0.1 stable — не работает (нет UE 5.6 AOBs)
- dwmapi.dll proxy — НЕ в Known DLLs реестра, должна работать
- version.dll — вызвала "ошибку точки входа" (неверный прокси)
- xinput1_3.dll — не работает
- Проверили: игра запускается через Shipping.exe напрямую ✓

### Диагностика на следующую сессию
1. Проверить загружена ли dwmapi.dll в процессе: `(Get-Process "Subnautica2*").Modules | Where FileName -like "*dwmapi*"`
2. Проверить crash dumps: `C:\Users\user\AppData\Local\Subnautica2\Saved\Crashes\`
3. Попробовать запустить с `-crashreports` флагом
4. Альтернатива: использовать отдельный DLL injector (Extreme Injector / RemoteDLL)
5. Проверить логи UE4SS crash dump: `Win64/ue4ss/CrashDumps/`

### Reference
- GOD-GAMER/mariana-sn2 — Lua API для SN2, подтвержденно работает с UE4SS
- docs/installation.md в том репо — точные инструкции

### Мод файлы
- `C:\Claude playground\Subnautica2-OptimizationMod\Mods\S2OptimizationFix\scripts\main.lua`
- CVars: Lumen OFF, VSM OFF, PSO cache, Nanite tuned

### GameUserSettings.ini патч (уже активен)
- FrameRateLimit=60 ✓
- ResolutionScaleMax=1.0 ✓  
- TSRQualityMode=2 (Balanced) ✓
