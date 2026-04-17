# Red-Team repos для S7

Подтверждены пользователем 2026-04-17. Анализировать, извлечь лучшие практики,
интегрировать в новый `/red-team` SKILL.md.

## Список

1. **A-poc/RedTeam-Tools** — https://github.com/A-poc/RedTeam-Tools.git
   - Комплексный набор red+blue team инструментов
   - Ссылка на blue team counterpart (проверить в README)
2. **Threekiii/Awesome-Redteam** — https://github.com/Threekiii/Awesome-Redteam.git
   - Curated list фреймворков, техник, payloads
3. **r0eXpeR/redteam_vul** — https://github.com/r0eXpeR/redteam_vul.git
   - База уязвимостей/эксплойтов для red team
4. **Adaptix-Framework/AdaptixC2** — https://github.com/Adaptix-Framework/AdaptixC2.git
   - C2 framework (для educational/authorized testing only)
5. **0xJs/RedTeaming_CheatSheet** — https://github.com/0xJs/RedTeaming_CheatSheet.git
   - Practical cheatsheets: recon, exploit, post-ex, evasion

## План анализа (S7)

- [ ] Клонировать все 5 в `audit/S7_redteam_research/repos/` (shallow, depth=1)
- [ ] Извлечь: inventory инструментов, methodology, report-templates, checklists
- [ ] Соединить с текущим `/red-team` SKILL.md (что оставить, что заменить)
- [ ] Разработать новый DOCX branded report template
- [ ] Реальный тест на DVWA или WebGoat (локальный target :3001)
