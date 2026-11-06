// Software renderer for AquaDays: C port of prototype/render.js drawing into a 240x320 RGB565
// framebuffer (native byte order). Integer blending and lookup tables only on the per-pixel
// paths, because the ESP32-C3 has no FPU.
#pragma once
#include <stdint.h>
#include "aqua_game.h"

#define AQ_W 240
#define AQ_H 320

typedef struct {
    const uint8_t *bg_day;    // 240x320 RGB565 little-endian
    const uint8_t *bg_night;  // same, pre-darkened
    const uint8_t *sprites;   // RGB565A8 frames listed in aqua_assets_gen.h
    const uint8_t *font;      // 1bpp glyphs listed in aqua_assets_gen.h
} aq_assets_t;

// Section timing for the serial log: background, creatures, glass/food effects, HUD text.
// Set aq_render_clock to a microsecond clock to enable; totals accumulate until cleared.
enum { AQ_PROF_BG, AQ_PROF_FISH, AQ_PROF_GLASS, AQ_PROF_HUD, AQ_RENDER_SECTIONS };
extern int64_t (*aq_render_clock)(void);
extern int64_t aq_render_sections[AQ_RENDER_SECTIONS];

void aq_render_init(const aq_assets_t *assets);
void aq_render(uint16_t *fb, const aq_state_t *s, int hour, int minute);
