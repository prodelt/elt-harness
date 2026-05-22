## Checkpoint - 2026-05-15 PC Optimization

### Build Status
- Compiles: N/A (системная оптимизация, не код)
- Lint: N/A
- Type check: N/A

### Test Metrics
- N/A

### Code Modifications Since Last Checkpoint
- Files created: none
- Files modified: `C:\Users\espad\.wslconfig` (new), `C:\Windows\System32\pagefile.sys` (moved)
- System changes: registry (HAGS), services (12 → Manual), npm config

### Git State
- Branch: session/2026-05-13-1905
- Uncommitted changes: M GEMINI.md, AGENTS.md, CLAUDE.md + untracked files
- Last commit: 46a253d chore(planning): add S27 checkpoints

### Completed Tasks ✅
- Сессия 0: Minidump пуст (нет BSOD), Restore Point уже существовала
- Сессия 1: %TEMP% очищен (+10 GB), 12 служб → Manual (-300 MB RAM), .wslconfig (WSL2=4GB), npm cache → D:
- Сессия 2: MCP конфиг чистый (дублей нет), node 21→7 после перезагрузки
- Сессия 3: HAGS включён (HwSchMode=2), Pagefile → C: NVMe (16-24 GB), RAM DDR4-2667 подтверждена, HWiNFO64 установлен
- Сессия 4: Game Mode ON, ISLC установлен и настроен (1500/4096/10s)

### Финальные метрики
| Метрика | До | После |
|---------|-----|-------|
| RAM | 80% (13 GB) | 45% (7.1 GB) |
| Node процессов | 21 | 7 |
| C: свободно | 71.7 GB | 65.6 GB* |
| CPU temp idle | н/д | 76°C (проблема!) |

*C: уменьшился т.к. pagefile (16 GB) переехал с D: на C: NVMe

### Remaining Work
- Intel UHD 630 driver: обновить через HP SA (2020 → 2024+)
- Чистка ноутбука + термопаста: КРИТИЧНО — 76°C idle, CPU не может boost
- BIOS: проверить F.14/F.15+ через HP SA
- GitHub tools: ChrisTitusTech/winutil + Raphire/Win11Debloat (не запускались)
- Lossless Scaling / SVP4 Free: frame generation через Intel UHD 630
- NVIDIA Profile Inspector: Prerendered Frames=1
- Disk Cleanup (cleanmgr): пропустили, +5-15 GB потенциально
- Автозагрузка в Task Manager: не проверяли результат

### Blockers
- Температура CPU 76°C idle — throttling мешает нормальному boost. Нужна физическая чистка ноутбука (пыль + термопаста). Без этого игровой FPS будет ниже потенциала.

### Next Steps
1. HP Support Assistant → обновить Intel UHD 630 драйвер
2. Запустить `irm christitus.com/win | iex` (winutil) в Admin PS
3. Физически почистить ноутбук от пыли, заменить термопасту
4. Установить SVP4 Free как альтернативу Lossless Scaling
5. NVIDIA Profile Inspector → Prerendered Frames = 1
