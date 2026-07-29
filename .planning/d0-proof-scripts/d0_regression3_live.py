"""Живой пруф регресса 3 (Route_API_1C, ce71a9f): реальный вызов search_visicom_candidates
двумя способами — pre-fix (структурный fmt.street_name, полное официальное имя от Gemini)
и post-fix (raw_text, сирий текст 1С) — на одном и том же реальном адресе (прод-инцидент
Пустомити, вул. Грушевського, 7), с реальным VISICOM_API_KEY.
"""
import asyncio
import json
import sys

sys.path.insert(0, "C:/Ametrin projects/Route_API_1C")

from app.services.geocoder.visicom import search_visicom_candidates  # noqa: E402

# Координаты near-bias — из тестовой фикстуры test_geocoder_strict.py (Пустомити).
NEAR_LAT = 49.716047
NEAR_LON = 23.906079


def classify(candidates, house_number="7"):
    for c in candidates:
        if c.categories.startswith("adr_address") and c.name == house_number:
            return f"НАЙДЕН adr_address дом {house_number} (street={c.street!r})"
    if candidates:
        return f"НЕ найден дом {house_number}; первый кандидат: categories={candidates[0].categories!r} name={candidates[0].name!r} street={candidates[0].street!r}"
    return "НЕ найден дом — пустой список кандидатов"


async def main():
    print("=== pre-fix: структурный запрос (city+street=ПОЛНОЕ офиц. имя+house_number) ===")
    pre = await search_visicom_candidates(
        city="Пустомити",
        street="Михайла Грушевського",  # Gemini-развёрнутое официальное имя (fmt.street_name)
        house_number="7",
        near_lon=NEAR_LON,
        near_lat=NEAR_LAT,
    )
    print("candidates:", [(c.categories, c.name, c.street) for c in pre])
    print("вердикт:", classify(pre))

    print()
    print("=== post-fix: raw_text (сирий текст 1С, короткая форма) ===")
    post = await search_visicom_candidates(
        raw_text="Пустомити, вул. Грушевського, 7",
        near_lon=NEAR_LON,
        near_lat=NEAR_LAT,
    )
    print("candidates:", [(c.categories, c.name, c.street) for c in post])
    print("вердикт:", classify(post))

    result = {
        "pre_fix": {
            "query": {"city": "Пустомити", "street": "Михайла Грушевського", "house_number": "7"},
            "candidates": [c.__dict__ for c in pre],
            "verdict": classify(pre),
        },
        "post_fix": {
            "query": {"raw_text": "Пустомити, вул. Грушевського, 7"},
            "candidates": [c.__dict__ for c in post],
            "verdict": classify(post),
        },
    }
    with open("C:/Claude playground/Pipiline setupper/.planning/D0-regression3-live-response.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


asyncio.run(main())
