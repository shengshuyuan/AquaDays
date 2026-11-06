// C port of prototype/render.js. Coordinates, colours and draw order match the browser preview.
#include "aqua_render.h"
#include "aqua_assets_gen.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

enum { INK = 0x082e35, PALE = 0xd6e6c7, MUTED = 0x8ab4ab, ACCENT = 0xf4c783, PAPER = 0xeee6c9 };
enum { SHADE_DAY = 0, SHADE_DAY_FAR = 1, SHADE_NIGHT = 2, SHADE_NIGHT_FAR = 3 };

static const aq_assets_t *A;
static uint16_t *FB;
// Per-shade channel tables on 5/6-bit values: expand, multiply/add, round, quantise.
static uint8_t LUT_R[4][32], LUT_G[4][64], LUT_B[4][32];

static int jround(double v) { return (int)floor(v + 0.5); }

static uint16_t to565(uint32_t c) {
    return (uint16_t)((((c >> 16) & 0xff) >> 3) << 11 | (((c >> 8) & 0xff) >> 2) << 5 | ((c & 0xff) >> 3));
}

static uint32_t shade_hex(uint32_t c, int shade) {
    if (shade == SHADE_DAY) return c;
    const aq_shade_t *sh = &AQ_SHADES[shade];
    uint32_t out = 0;
    for (int ch = 0; ch < 3; ch++) {
        int v = (int)((c >> (16 - ch * 8)) & 0xff), r = jround(v * sh->mul[ch] + sh->add[ch]);
        out |= (uint32_t)(r > 255 ? 255 : r) << (16 - ch * 8);
    }
    return out;
}

static void rect(int x, int y, int w, int h, uint32_t color) {
    if (w <= 0 || h <= 0) return;
    int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y, x1 = x + w > AQ_W ? AQ_W : x + w, y1 = y + h > AQ_H ? AQ_H : y + h;
    uint16_t c = to565(color);
    for (int yy = y0; yy < y1; yy++) for (int xx = x0; xx < x1; xx++) FB[yy * AQ_W + xx] = c;
}

static void blend_px(int x, int y, int r8, int g8, int b8, int a) {
    if (x < 0 || y < 0 || x >= AQ_W || y >= AQ_H || a <= 0) return;
    uint16_t *p = &FB[y * AQ_W + x];
    if (a >= 255) { *p = (uint16_t)((r8 >> 3) << 11 | (g8 >> 2) << 5 | (b8 >> 3)); return; }
    int d = *p, dr = (d >> 11) & 31, dg = (d >> 5) & 63, db = d & 31;
    dr = (dr << 3) | (dr >> 2); dg = (dg << 2) | (dg >> 4); db = (db << 3) | (db >> 2);
    // (x * 0x8081) >> 23 == x / 255 exactly for x < 65536.
    uint32_t r = ((uint32_t)(r8 * a + dr * (255 - a) + 127) * 0x8081u) >> 23;
    uint32_t g = ((uint32_t)(g8 * a + dg * (255 - a) + 127) * 0x8081u) >> 23;
    uint32_t b = ((uint32_t)(b8 * a + db * (255 - a) + 127) * 0x8081u) >> 23;
    *p = (uint16_t)((r >> 3) << 11 | (g >> 2) << 5 | (b >> 3));
}

// With a fixed colour and alpha each output channel depends only on the same input channel,
// so large fills blend through per-channel tables. Film rows cycle through a handful of
// alphas, so a small cache keeps every table built once instead of once per row.
typedef struct { uint32_t key; uint16_t r[32], g[64], b[32]; } blend_lut_t;
#define BLEND_LUTS 24
static blend_lut_t BL[BLEND_LUTS];
static int bl_used, bl_next;

static const blend_lut_t *blend_lut(uint16_t c, int a) {
    uint32_t key = (uint32_t)c << 8 | (uint32_t)a;
    for (int i = 0; i < bl_used; i++) if (BL[i].key == key) return &BL[i];
    blend_lut_t *t = &BL[bl_next];
    bl_next = (bl_next + 1) % BLEND_LUTS;
    if (bl_used < BLEND_LUTS) bl_used++;
    t->key = key;
    int r5 = c >> 11, g6 = (c >> 5) & 63, b5 = c & 31;
    int r8 = (r5 << 3) | (r5 >> 2), g8 = (g6 << 2) | (g6 >> 4), b8 = (b5 << 3) | (b5 >> 2);
    for (int v = 0; v < 64; v++) {
        int e6 = (v << 2) | (v >> 4);
        t->g[v] = (uint16_t)(((((uint32_t)(g8 * a + e6 * (255 - a) + 127) * 0x8081u) >> 23) >> 2) << 5);
        if (v >= 32) continue;
        int e5 = (v << 3) | (v >> 2);
        t->r[v] = (uint16_t)(((((uint32_t)(r8 * a + e5 * (255 - a) + 127) * 0x8081u) >> 23) >> 3) << 11);
        t->b[v] = (uint16_t)((((uint32_t)(b8 * a + e5 * (255 - a) + 127) * 0x8081u) >> 23) >> 3);
    }
    return t;
}

// Canvas fillRect under globalAlpha, on device-quantised colour.
static void blend_rect(int x, int y, int w, int h, uint32_t color, float alpha) {
    if (w <= 0 || h <= 0) return;
    uint16_t c = to565(color);
    // Single-precision rounding: alpha is never negative, and double math is slow without an FPU.
    int a = alpha > 0 ? (int)(alpha * 255.0f + 0.5f) : 0;
    if (a <= 0) return;
    if (a >= 255) { rect(x, y, w, h, color); return; }
    if (w * h < 32) {
        int r5 = c >> 11, g6 = (c >> 5) & 63, b5 = c & 31;
        int r8 = (r5 << 3) | (r5 >> 2), g8 = (g6 << 2) | (g6 >> 4), b8 = (b5 << 3) | (b5 >> 2);
        for (int yy = y; yy < y + h; yy++) for (int xx = x; xx < x + w; xx++) blend_px(xx, yy, r8, g8, b8, a);
        return;
    }
    const blend_lut_t *t = blend_lut(c, a);
    int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y, x1 = x + w > AQ_W ? AQ_W : x + w, y1 = y + h > AQ_H ? AQ_H : y + h;
    for (int yy = y0; yy < y1; yy++) {
        uint16_t *p = &FB[yy * AQ_W + x0];
        for (int xx = x0; xx < x1; xx++, p++) { int d = *p; *p = t->r[d >> 11] | t->g[(d >> 5) & 63] | t->b[d & 31]; }
    }
}

// Optional section timing, set by the firmware; the host build leaves it NULL.
int64_t (*aq_render_clock)(void);
int64_t aq_render_sections[AQ_RENDER_SECTIONS];
static int64_t prof_since;
static void mark(int section) {
    if (!aq_render_clock) return;
    int64_t t = aq_render_clock();
    if (section >= 0) aq_render_sections[section] += t - prof_since;
    prof_since = t;
}

static void border(int x, int y, int w, int h, uint32_t c) {
    rect(x, y, w, 1, c); rect(x, y + h - 1, w, 1, c); rect(x, y, 1, h, c); rect(x + w - 1, y, 1, h, c);
}

// ---- Text -----------------------------------------------------------------

static const char *utf8_next(const char *s, uint32_t *cp) {
    const unsigned char *u = (const unsigned char *)s;
    if (u[0] < 0x80) { *cp = u[0]; return s + 1; }
    if ((u[0] & 0xe0) == 0xc0) { *cp = ((u[0] & 0x1fu) << 6) | (u[1] & 0x3fu); return s + 2; }
    if ((u[0] & 0xf0) == 0xe0) { *cp = ((u[0] & 0x0fu) << 12) | ((u[1] & 0x3fu) << 6) | (u[2] & 0x3fu); return s + 3; }
    *cp = ((u[0] & 0x07u) << 18) | ((u[1] & 0x3fu) << 12) | ((u[2] & 0x3fu) << 6) | (u[3] & 0x3fu); return s + 4;
}

static const aq_glyph_t *glyph(uint32_t cp) {
    int lo = 0, hi = AQ_GLYPH_COUNT - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (AQ_GLYPHS[mid].codepoint == cp) return &AQ_GLYPHS[mid];
        if (AQ_GLYPHS[mid].codepoint < cp) lo = mid + 1; else hi = mid - 1;
    }
    return NULL;
}

typedef enum { LEFT, CENTER, RIGHT } align_t;

static void text(const char *str, int x, int y, uint32_t color, align_t align) {
    int width = 0;
    uint32_t cp;
    for (const char *p = str; *p;) { p = utf8_next(p, &cp); const aq_glyph_t *g = glyph(cp); if (g) width += g->width; }
    if (align == CENTER) x -= width / 2;
    if (align == RIGHT) x -= width;
    for (const char *p = str; *p;) {
        p = utf8_next(p, &cp);
        const aq_glyph_t *g = glyph(cp);
        if (!g) { printf("aqua: missing glyph U+%04X\n", (unsigned)cp); continue; }
        const uint8_t *bits = A->font + g->offset;
        for (int j = 0; j < g->width * AQ_GLYPH_H; j++)
            if ((bits[j >> 3] >> (j & 7)) & 1) rect(x + j % g->width, y + j / g->width, 1, 1, color);
        x += g->width;
    }
}

static const char *DIGITS[11][7] = {
    {"01110","11011","11011","11011","11011","11011","01110"},
    {"00110","01110","00110","00110","00110","00110","01111"},
    {"01110","11011","00011","00110","01100","11000","11111"},
    {"11110","00011","00011","01110","00011","00011","11110"},
    {"11011","11011","11011","11111","00011","00011","00011"},
    {"11111","11000","11000","11110","00011","00011","11110"},
    {"01110","11000","11000","11110","11011","11011","01110"},
    {"11111","00011","00110","00110","01100","01100","01100"},
    {"01110","11011","11011","01110","11011","11011","01110"},
    {"01110","11011","11011","01111","00011","00011","01110"},
    {"0","1","1","0","1","1","0"},
};

static void clock_digits(const char *time) {
    int n = (int)strlen(time), widths[8], total = 0;
    for (int i = 0; i < n; i++) {
        int d = time[i] == ':' ? 10 : time[i] - '0';
        widths[i] = (int)strlen(DIGITS[d][0]) * 3 + 4; total += widths[i];
    }
    int x = (AQ_W - total + 4) / 2;
    for (int i = 0; i < n; i++) {
        int d = time[i] == ':' ? 10 : time[i] - '0';
        for (int y = 0; y < 7; y++) for (int c = 0; DIGITS[d][y][c]; c++) if (DIGITS[d][y][c] == '1') {
            rect(x + c * 3 + 1, 46 + y * 3 + 1, 3, 3, 0x174f54); rect(x + c * 3, 46 + y * 3, 3, 3, 0xd6ece4);
        }
        x += widths[i];
    }
}

// ---- Sprites --------------------------------------------------------------

static const aq_frame_t *frame_for(int kind, int size, aq_pose_t pose) {
    const aq_frame_t *first = NULL;
    for (int i = 0; i < AQ_FRAME_COUNT; i++) {
        const aq_frame_t *f = &AQ_FRAMES[i];
        if (f->kind != kind || f->size != size) continue;
        if (!first) first = f;
        if (f->role == (uint8_t)pose.role && f->frame == pose.frame) return f;
    }
    return first;
}

// Mirror by column order, pitch by per-column y offset, shade through the channel tables.
static void draw_fish(int kind, int direction, float pitch, aq_pose_t pose, float x, float y, int size, int shade) {
    const aq_frame_t *fr = frame_for(kind, size, pose);
    if (!fr) return;
    int w = fr->w, h = fr->h, left = jround(x - w / 2.0), top = jround(y - h / 2.0);
    const uint8_t *rgb = A->sprites + fr->offset, *alpha = rgb + w * h * 2;
    float k = pitch * AQ_PITCH_SHEAR;
    for (int c = 0; c < w; c++) {
        int offset = jround((c - (w - 1) / 2.0) * k), dx = direction < 0 ? left + w - 1 - c : left + c;
        for (int r = 0; r < h; r++) {
            int i = r * w + c, a = alpha[i];
            if (!a) continue;
            int px = rgb[i * 2] | rgb[i * 2 + 1] << 8;
            int r5 = LUT_R[shade][px >> 11], g6 = LUT_G[shade][(px >> 5) & 63], b5 = LUT_B[shade][px & 31];
            blend_px(dx, top + offset + r, (r5 << 3) | (r5 >> 2), (g6 << 2) | (g6 >> 4), (b5 << 3) | (b5 >> 2), a);
        }
    }
}

// ---- Glass grime, squeegee and food ---------------------------------------

static const int ROWS[AQ_ROWS][2] = {{92, 151}, {152, 211}, {212, 270}};
enum { GLASS_X0 = 3, GLASS_X1 = 237, SPOTS = 26 };
typedef struct { int x, y, size; bool algae; } spot_t;
static spot_t GRIME[AQ_ROWS][SPOTS];

static void build_grime(void) {
    for (int lane = 0; lane < AQ_ROWS; lane++) {
        uint32_t seed = 7919u * (uint32_t)(lane + 3);
        #define RND() ((seed = seed * 1664525u + 1013904223u), (double)seed / 4294967296.0)
        int y0 = ROWS[lane][0], y1 = ROWS[lane][1];
        for (int i = 0; i < SPOTS; i++) {
            bool edge = RND() < 0.65, side = RND() < 0.5;
            double x = edge ? (side ? GLASS_X0 + 1 + RND() * 26 : GLASS_X1 - 4 - RND() * 26) : GLASS_X0 + 30 + RND() * 170;
            double y;
            if (lane == 2 && RND() < 0.5) y = y1 - 4 - RND() * 14; else y = y0 + 2 + RND() * (y1 - y0 - 6);
            bool algae = edge ? true : RND() < 0.6;
            int size = 1 + (int)floor(RND() * 3);
            GRIME[lane][i] = (spot_t){jround(x), jround(y), size, algae};
        }
        #undef RND
    }
}

typedef struct { bool on; int x; float t, after; } edge_t;

static edge_t wipe_edge(const aq_state_t *s, int lane) {
    edge_t e = {0};
    if (!s->wipe_active || s->wipe_lane != lane) return e;
    float t = fminf(1.0f, (float)(s->age - s->wipe_start) / AQ_WIPE), eased = 1 - (1 - t) * (1 - t);
    e.on = true; e.t = t; e.after = (float)(s->age - s->wipe_start) - AQ_WIPE;
    e.x = jround(GLASS_X0 - 6 + eased * (GLASS_X1 - GLASS_X0 + 12));
    return e;
}

static bool looks_dirty(const aq_state_t *s, int lane) {
    edge_t e = wipe_edge(s, lane);
    return !s->dirt_clean[lane] || (e.on && e.t < 1);
}

static int lane_at(int y) {
    for (int i = 0; i < AQ_ROWS; i++) if (y >= ROWS[i][0] && y <= ROWS[i][1]) return i;
    return -1;
}

static float film_at(const aq_state_t *s, int y) {
    int n = 0;
    for (int d = -4; d <= 4; d++) { int l = lane_at(y + d); n += l >= 0 && looks_dirty(s, l); }
    return n / 9.0f;
}

static const char *ALGAE[3][5] = {
    {"21", "02"},
    {"0120", "2232", "0220"},
    {"001200", "012320", "223322", "022330", "002200"},
};

static void algae_spot(int x, int y, int size, int light) {
    static const uint32_t COLORS[4] = {0, 0x93b571, 0x5f8c53, 0x3f6a45};
    static int cached_light = -1;
    static uint32_t shaded[4];
    if (cached_light != light) {
        for (int i = 1; i < 4; i++) shaded[i] = shade_hex(COLORS[i], light);
        cached_light = light;
    }
    for (int j = 0; j < 5 && ALGAE[size - 1][j]; j++)
        for (int i = 0; ALGAE[size - 1][j][i]; i++) {
            int v = ALGAE[size - 1][j][i] - '0';
            if (v) blend_rect(x + i, y + j, 1, 1, shaded[v], 0.72f);
        }
}

static void water_mark(int x, int y, int light) {
    static const int R[4][4] = {{1, 0, 3, 1}, {0, 1, 1, 2}, {4, 1, 1, 2}, {1, 3, 3, 1}};
    uint32_t c = shade_hex(0xcfe6da, light);
    for (int i = 0; i < 4; i++) blend_rect(x + R[i][0], y + R[i][1], R[i][2], R[i][3], c, 0.45f);
}

static void grime_layer(const aq_state_t *s, int light, float strength) {
    if (strength <= 0) return;
    uint32_t film = shade_hex(0x6b9a5e, light);
    for (int y = ROWS[0][0] - 4; y <= ROWS[2][1]; y++) {
        float a = film_at(s, y);
        if (a == 0) continue;
        int lane = lane_at(y);
        edge_t e = lane >= 0 ? wipe_edge(s, lane) : (edge_t){0};
        int from = e.on ? (e.x > GLASS_X0 ? e.x : GLASS_X0) : GLASS_X0;
        blend_rect(from, y, GLASS_X1 - from, 1, film, 0.2f * a * strength);
        float ea = 0.16f * a * strength;
        int l = from > GLASS_X0 ? from : GLASS_X0, r = from > GLASS_X1 - 20 ? from : GLASS_X1 - 20;
        if (from < GLASS_X0 + 20) blend_rect(l, y, GLASS_X0 + 20 - l, 1, film, ea);
        blend_rect(r, y, GLASS_X1 - r, 1, film, ea);
    }
    for (int lane = 0; lane < AQ_ROWS; lane++) {
        if (!looks_dirty(s, lane)) continue;
        edge_t e = wipe_edge(s, lane);
        int count = (int)ceilf(SPOTS * strength);
        for (int i = 0; i < count && i < SPOTS; i++) {
            const spot_t *g = &GRIME[lane][i];
            if (e.on && g->x < e.x) continue;
            if (g->algae) algae_spot(g->x, g->y, g->size, light); else water_mark(g->x, g->y, light);
        }
    }
}

static void squeegee(int x, int y0, int y1, int light) {
    int mid = jround((y0 + y1) / 2.0), top = y0 + 5, h = y1 - y0 - 9;
    rect(x, top, 2, h, shade_hex(0x163c40, light)); rect(x + 2, top, 1, h, shade_hex(0x9bc4b7, light));
    rect(x - 3, top + 3, 3, h - 6, shade_hex(ACCENT, light)); rect(x - 3, top + 3, 1, h - 6, shade_hex(0xf9e1a3, light));
    rect(x - 11, mid - 2, 8, 4, shade_hex(0xc4b68d, light)); rect(x - 11, mid - 2, 8, 1, shade_hex(0xe9d9ae, light));
    rect(x - 12, mid - 1, 1, 2, shade_hex(0x74a18b, light));
}

static void shine(const aq_state_t *s, int lane, int light) {
    static const float GLINTS[3][3] = {{60, 22, 0.55f}, {66, 12, 0.35f}, {150, 16, 0.45f}};
    edge_t e = wipe_edge(s, lane);
    if (!e.on) return;
    float fade = e.after < 0 ? 1.0f : fmaxf(0.0f, 1.0f - e.after);
    if (fade <= 0) return;
    int y0 = ROWS[lane][0], y1 = ROWS[lane][1];
    uint32_t c = shade_hex(0xe4f3ea, light);
    for (int g = 0; g < 3; g++)
        for (int i = 0; i < (int)GLINTS[g][1]; i++) {
            int x = (int)GLINTS[g][0] + i, y = y1 - 10 - i * 2;
            if (x < e.x && y > y0 + 2) blend_rect(x, y, 1, 2, c, GLINTS[g][2] * fade);
        }
}

static float grime_strength(const aq_state_t *s) {
    if (s->mode == AQ_MODE_CLEAN) return 1;
    if (s->water >= 90) return 0;
    return fminf(1.0f, 0.35f + (90 - s->water) / 30.0f);
}

static void pellet(const aq_pellet_t *p, int x, int light) {
    int y = jround(p->y);
    uint32_t core = shade_hex(0xcf8a40, light), lit = shade_hex(0xf4c783, light), dark = shade_hex(0x875127, light);
    if (p->kind == 0) { rect(x, y, 2, 2, core); rect(x, y, 1, 1, lit); rect(x + 1, y + 1, 1, 1, dark); }
    else if (p->kind == 1) {
        rect(x, y + 1, 3, 1, core); rect(x + 1, y, 1, 3, core); rect(x + 1, y, 1, 1, lit);
        rect(x + 2, y + 1, 1, 1, dark); rect(x + 1, y + 2, 1, 1, dark);
    } else { rect(x, y, 3, 2, core); rect(x, y, 2, 1, lit); rect(x + 2, y + 1, 1, 1, dark); }
}

static void ripple(const aq_fx_t *r, const aq_state_t *s, int light) {
    float t = (float)(s->age - r->start) / 0.6f;
    int d = jround(2 + 12 * t), y = (int)AQ_SURFACE - 1, x = (int)r->x;
    uint32_t c = shade_hex(t < 0.5f ? 0xeef8f0 : 0x9cc7bb, light);
    if (t < 0.2f) rect(x - 1, y - 1, 3, 1, c);
    rect(x - d - 3, y, 4, 1, c); rect(x + d, y, 4, 1, c);
    if (t < 0.6f) { rect(x - d - 2, y - 1, 2, 1, c); rect(x + d + 1, y - 1, 2, 1, c); }
}

static void puff(const aq_fx_t *p, const aq_state_t *s, int light) {
    static const int D[4][2] = {{-1, -1}, {1, -1}, {-1, 1}, {1, 0}};
    float t = (float)(s->age - p->start) / 0.45f;
    int d = 1 + jround(3 * t);
    uint32_t c = shade_hex(t < 0.5f ? 0xf4c783 : 0xcfe3d6, light);
    for (int i = 0; i < 4; i++) rect(jround(p->x) + D[i][0] * d, jround(p->y) + D[i][1] * d, 1, 1, c);
}

// ---- Screens --------------------------------------------------------------

static void button(int x, int y, int w, const char *label, bool selected, bool disabled) {
    rect(x, y, w, 22, selected ? 0x245958 : 0x103a40);
    if (selected) rect(x + 8, y + 20, w - 16, 2, disabled ? MUTED : ACCENT);
    // The browser centres on x + w / 2 and rounds the half pixel of odd widths up.
    text(label, x + (w + 1) / 2, y + 5, disabled ? MUTED : selected ? ACCENT : PALE, CENTER);
}

// Water occupies rows WATER_TOP..WATER_BOTTOM of the background; the bars above and below hold the HUD.
enum { WATER_TOP = 21, WATER_BOTTOM = 270 };

// Immersive view: mirror the water into both bars so the scene fills the screen, darkening the
// mirrored sand towards the bottom edge and the mirrored surface slightly towards the top.
static void immersive_bars(const uint8_t *bg) {
    for (int y = 0; y < WATER_TOP; y++) {
        memcpy(&FB[y * AQ_W], bg + (2 * WATER_TOP - 1 - y) * AQ_W * 2, AQ_W * 2);
        blend_rect(0, y, AQ_W, 1, INK, 0.2f * (WATER_TOP - y) / WATER_TOP);
    }
    for (int y = WATER_BOTTOM + 1; y < AQ_H; y++) {
        memcpy(&FB[y * AQ_W], bg + (2 * WATER_BOTTOM + 1 - y) * AQ_W * 2, AQ_W * 2);
        blend_rect(0, y, AQ_W, 1, INK, 0.5f * (y - WATER_BOTTOM) / (AQ_H - 1 - WATER_BOTTOM));
    }
}

static int tank(const aq_state_t *s, int hour, int minute) {
    int light = aq_is_daytime(hour) ? SHADE_DAY : SHADE_NIGHT;
    const uint8_t *bg = light == SHADE_DAY ? A->bg_day : A->bg_night;
    memcpy(FB, bg, AQ_W * AQ_H * 2);
    if (s->immersive) immersive_bars(bg);
    else {
        char buf[48];
        snprintf(buf, sizeof buf, "鱼缸 %d/%d", s->fish_count, AQ_MAX_FISH);
        text(buf, 231, 4, MUTED, RIGHT);
        snprintf(buf, sizeof buf, "%02d:%02d", hour, minute);
        clock_digits(buf);
        static const char *WEEK[7] = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
        snprintf(buf, sizeof buf, "%04d.%02d.%02d %s", s->day.year, s->day.month, s->day.day, WEEK[aq_weekday(s->day)]);
        text(buf, 120, 79, MUTED, CENTER);
    }
    for (int i = 0; i < 4; i++) {
        int y = 231 - (((int)floor(s->age * 8) + i * 39) % 139), x = 224 + (i % 2) * 3;
        border(x, y, 3, 4, shade_hex(0x4b9197, light)); rect(x, y, 1, 1, shade_hex(0x9bc4b7, light));
    }
    mark(AQ_PROF_BG);
    // Back layer first, then the crab on the floor, then the front layer.
    int order[AQ_MAX_FISH];
    for (int i = 0; i < s->fish_count; i++) order[i] = i;
    for (int i = 1; i < s->fish_count; i++)
        for (int j = i; j > 0; j--) {
            const aq_fish_t *a = &s->fish[order[j - 1]], *b = &s->fish[order[j]];
            int ba = AQ_CATALOG[a->kind].bottom, bb = AQ_CATALOG[b->kind].bottom;
            int cmp = a->layer != b->layer ? a->layer - b->layer : ba != bb ? bb - ba : a->id - b->id;
            if (cmp <= 0) break;
            int t = order[j]; order[j] = order[j - 1]; order[j - 1] = t;
        }
    for (int i = 0; i < s->fish_count; i++) {
        const aq_fish_t *f = &s->fish[order[i]];
        draw_fish(f->kind, f->direction, f->pitch, aq_pose(f), f->x, f->y, f->adult ? 1 : 0, f->layer ? light : light + 1);
    }
    mark(AQ_PROF_FISH);
    for (int i = 0; i < s->pellet_count; i++) {
        const aq_pellet_t *p = &s->pellets[i];
        if (p->delay > 0) continue;
        int sway = p->y < AQ_SAND ? jround(sin(s->age * 2.4 + i * 1.7)) : 0;
        pellet(p, (int)p->x + sway, light);
    }
    for (int i = 0; i < s->ripple_count; i++) ripple(&s->ripples[i], s, light);
    for (int i = 0; i < s->puff_count; i++) puff(&s->puffs[i], s, light);
    grime_layer(s, light, grime_strength(s));
    for (int lane = 0; lane < AQ_ROWS; lane++) shine(s, lane, light);
    mark(AQ_PROF_GLASS);
    return light;
}

static void clean_overlay(const aq_state_t *s, int light) {
    int y0 = ROWS[s->lane][0], y1 = ROWS[s->lane][1];
    const int XS[2][2] = {{GLASS_X0 + 1, 1}, {GLASS_X1 - 2, -1}}, YS[2][2] = {{y0, 1}, {y1, -1}};
    for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) {
        int x = XS[i][0], dx = XS[i][1], y = YS[j][0], dy = YS[j][1];
        rect(dx > 0 ? x : x - 6, y, 7, 1, ACCENT); rect(x, dy > 0 ? y : y - 6, 1, 7, ACCENT);
    }
    edge_t e = s->wipe_active ? wipe_edge(s, s->wipe_lane) : (edge_t){0};
    if (e.on && e.t < 1) squeegee(e.x, ROWS[s->wipe_lane][0], ROWS[s->wipe_lane][1], light);
    else if (looks_dirty(s, s->lane)) squeegee(GLASS_X0 + 14 + jround(sin(s->age * 3)), y0, y1, light);
}

static void selection(const aq_state_t *s, int hour) {
    memcpy(FB, aq_is_daytime(hour) ? A->bg_day : A->bg_night, AQ_W * AQ_H * 2);
    rect(6, 28, 228, 228, 0x10434d);
    text(s->mode == AQ_MODE_SIZE ? "选择大小" : "选择伙伴", 120, 33, PALE, CENTER);
    char buf[32];
    snprintf(buf, sizeof buf, "%d/%d", s->fish_count, AQ_MAX_FISH);
    text(buf, 228, 4, MUTED, RIGHT);
    border(20, 58, 200, 133, 0x2e6b70);
    rect(21, 59, 198, 131, 0x134e59);
    const aq_kind_t *kind = &AQ_CATALOG[s->choice];
    int size = s->mode == AQ_MODE_SIZE ? (s->adult_choice ? 2 : 1) : 2, cycle = (int)floor(s->age * 6) % 4;
    draw_fish(s->choice, 1, 0, (aq_pose_t){kind->bottom ? AQ_ROLE_WALK : AQ_ROLE_SWIM, cycle}, 120, 110, size, SHADE_DAY);
    text(kind->name, 120, 156, ACCENT, CENTER);
    text(kind->trait, 120, 170, MUTED, CENTER);
    if (s->mode == AQ_MODE_SIZE) {
        button(24, 211, 88, kind->bottom ? "幼蟹" : "幼鱼", !s->adult_choice, false);
        button(128, 211, 88, kind->bottom ? "成蟹" : "成鱼", s->adult_choice, false);
        text(kind->bottom ? "沿着缸底慢慢爬行" : s->adult_choice ? "入住就能看大鱼" : "喂食后慢慢长大", 120, 245, PALE, CENTER);
    } else {
        for (int slot = 0; slot < 3; slot++) {
            int i = (s->choice + slot - 1 + AQ_KINDS) % AQ_KINDS;
            if (slot == 1) { rect(12 + slot * 76, 204, 65, 48, 0x285f61); border(12 + slot * 76, 204, 65, 48, ACCENT); }
            draw_fish(i, 1, 0, (aq_pose_t){AQ_CATALOG[i].bottom ? AQ_ROLE_WALK : AQ_ROLE_SWIM, 0}, 44 + slot * 76, 220, 0, SHADE_DAY);
            text(AQ_CATALOG[i].name, 44 + slot * 76, 237, slot == 1 ? ACCENT : MUTED, CENTER);
        }
        snprintf(buf, sizeof buf, "%d / %d", s->choice + 1, AQ_KINDS);
        text(buf, 120, 53, MUTED, CENTER);
    }
    bool full = s->fish_count >= AQ_MAX_FISH;
    button(20, 271, 200, full ? "鱼缸已满" : s->mode == AQ_MODE_SIZE ? "放入鱼缸" : "下一步：选择大小", true, full);
    text("上下切换 · 确定选择", 120, 302, MUTED, CENTER);
}

void aq_render_init(const aq_assets_t *assets) {
    A = assets;
    for (int sh = 0; sh < 4; sh++) {
        const aq_shade_t *s = &AQ_SHADES[sh];
        for (int v = 0; v < 64; v++) {
            int g8 = (v << 2) | (v >> 4), g = jround(g8 * s->mul[1] + s->add[1]);
            LUT_G[sh][v] = (uint8_t)((g > 255 ? 255 : g) >> 2);
            if (v >= 32) continue;
            int c8 = (v << 3) | (v >> 2), r = jround(c8 * s->mul[0] + s->add[0]), b = jround(c8 * s->mul[2] + s->add[2]);
            LUT_R[sh][v] = (uint8_t)((r > 255 ? 255 : r) >> 3);
            LUT_B[sh][v] = (uint8_t)((b > 255 ? 255 : b) >> 3);
        }
    }
    build_grime();
}

void aq_render(uint16_t *fb, const aq_state_t *s, int hour, int minute) {
    FB = fb;
    mark(-1);
    if (s->mode == AQ_MODE_SELECT || s->mode == AQ_MODE_SIZE) { selection(s, hour); mark(AQ_PROF_BG); return; }
    int light = tank(s, hour, minute);
    if (s->immersive) { mark(AQ_PROF_HUD); return; }
    char buf[48];
    if (s->mode == AQ_MODE_CLEAN) {
        clean_overlay(s, light);
        int cleaned = 0;
        for (int i = 0; i < AQ_ROWS; i++) cleaned += s->dirt_clean[i];
        snprintf(buf, sizeof buf, "已擦 %d/%d", cleaned, AQ_ROWS);
        text(buf, 10, 280, ACCENT, LEFT);
        snprintf(buf, sizeof buf, "水质 %d%%", jround(s->water));
        text(buf, 230, 280, PALE, RIGHT);
        text("上下选行 · 确定擦一下", 120, 302, MUTED, CENTER);
    } else {
        rect(9, 273, 222, 1, 0x35615e);
        snprintf(buf, sizeof buf, "水质 %d%%", jround(s->water));
        text(buf, 10, 278, s->water < 60 ? ACCENT : PALE, LEFT);
        rect(121, 277, 1, 12, 0x35615e);
        snprintf(buf, sizeof buf, "喂食 %d/%d", s->fed, AQ_DAILY_FOOD);
        text(buf, 230, 278, s->fed == AQ_DAILY_FOOD ? ACCENT : PALE, RIGHT);
        // Four 51 px buttons with 6 px gaps fill the 222 px HUD row.
        const char *names[AQ_HOME_BUTTONS] = {s->fed == AQ_DAILY_FOOD ? "已喂饱" : "喂食", "擦缸", "选鱼", s->sound ? "水声 开" : "水声 关"};
        for (int i = 0; i < AQ_HOME_BUTTONS; i++) button(9 + i * 57, 295, 51, names[i], s->selected == i, i == 0 && s->fed == AQ_DAILY_FOOD);
    }
    if (s->message && s->age < s->message_until) {
        rect(9, 250, 222, 18, 0x153e43); text(s->message, 120, 254, PAPER, CENTER);
    } else if (s->stamped && s->age < s->stamp_until) {
        snprintf(buf, sizeof buf, "照料章 +1  累计 %d", s->care_days);
        text(buf, 120, 254, ACCENT, CENTER);
    }
    mark(AQ_PROF_HUD);
}
