# GameHub · Дурак — ТЗ на арт для ИИ-генератора

Каждый ассет генерим **отдельно**, на **прозрачном фоне** (кроме фетра), **один объект без сцены/телефона/рамки-мокапа**. Формат PNG. После генерации пришли файлы мне — я вставлю в игру.

## Общие правила (добавляй в конец КАЖДОГО промпта)
```
Single object only, centered, front-facing flat view, no perspective, no drop shadow,
no text, no letters, no numbers, no watermark, no logo, not inside a phone or mockup,
not on a table scene. Isolated on a fully transparent background (PNG with alpha).
```

## Палитра (чтобы всё было в одном стиле)
- Фетр стола: глубокий джинсово-синий `#3f5f7a → #5f778f`
- Золото: `#d99a2b`, тёмное золото `#b97817`
- Красный (масти/рубашка): `#c62828`
- Кремово-белый: `#f6f2ea`

---

## 1. Рубашка карты (card back) — `public/assets/durak/card-back.png`
**Размер:** 1024×1434 (вертикаль, пропорции карты). Прозрачный фон, скруглённые углы.

**Промпт (EN):**
```
An ornate luxury playing card back, single vertical card with rounded corners.
Symmetrical damask filigree pattern in deep crimson red (#c62828) and gold (#d99a2b)
on a cream white (#f6f2ea) field, a thin double gold border frame, and a small
ornamental gold medallion in the exact center. Classic expensive casino deck style,
crisp clean vector-like detail, perfectly flat and front-facing.
```
+ общие правила.

*(Опц.: сгенерь ещё сине-золотой вариант — потом продадим как скин колоды в магазине.)*

---

## 2. Фактура стола (felt) — `public/assets/durak/felt.jpg`
**Размер:** 1024×1536 (вертикаль). **Фон НЕ прозрачный** (это подложка).

**Промпт (EN):**
```
A premium card-table surface, top-down flat view. Deep denim-blue leather/felt
(#3f5f7a to #5f778f) with fine natural grain and a subtle soft radial light in the
center fading to a darker vignette toward the edges. Rich, expensive casino-table
look, even and clean. No objects, no cards, no chips, no text, no logo. Portrait
orientation, high resolution.
```

---

## 3. Рамки аватара (avatar frames) — 2 штуки
**Размер:** 1024×1024. Прозрачный фон. **Центр рамки должен быть ПУСТЫМ (прозрачным)** — туда встанет фото игрока.

### 3a. Обычная — `public/assets/durak/frame.png`
```
A decorative square avatar frame border with rounded corners. Polished gold metallic
beveled frame (#d99a2b) with subtle filigree ornaments at the four corners. The entire
center area is EMPTY and fully transparent (only the border ring is visible) so a photo
can show through. Front view, clean, crisp.
```
+ общие правила.

### 3b. Активный ход (свечение) — `public/assets/durak/frame-active.png`
Тот же промпт, но замени первую строку про золото на:
```
A glowing emerald-green (#38d66b) neon energy border with a soft outer glow,
```
(центр так же полностью прозрачный).

---

## Куда всё пойдёт
- `card-back.png` → рубашки (колода, бито, карты соперника).
- `felt.jpg` → фон стола вместо CSS-градиента.
- `frame.png` / `frame-active.png` → рамки вокруг аватаров (обычная / чей ход).

Пришли файлы — вставлю и подгоню размеры. Если какой-то ассет выйдет «в сцене» или с обрезкой — просто перегенерь с усиленной строкой `isolated on transparent background, single object only`.
