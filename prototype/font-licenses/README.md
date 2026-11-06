# Pixel font attribution

`../pixel-font.js` and `../assets/font-1bpp.bin` are the **AquaDays UI bitmap subset**, derived from [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font), 12px monospaced Simplified Chinese, release [2026.10.25](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.10.25).

The font is licensed under SIL OFL 1.1. The original license and upstream font notices supplied in the release are preserved in this directory. The full font is not bundled. The subset contains 191 characters, rasterized at its native 12px size into 1bpp masks; it does not depend on a user's installed Chinese fonts.

To regenerate the subset: load the release's `fusion-pixel-12px-monospaced-zh_hans.otf.woff2` through `FontFace`, draw all UI characters at 12px with alphabetic baseline y=10 into 6×12 ASCII or 12×12 CJK tiles, then record pixel alpha >=128 as a set bit. Store each row LSB-first in `pixel-font.js`. Include printable ASCII and all Chinese/punctuation characters from `game.js`, `render.js`, plus `周日一二三四五六`. Run `node tests/game.test.cjs` to check coverage.
