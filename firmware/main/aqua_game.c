// C port of prototype/game.js. Keep the two in step: tuning values, order of random draws and
// rules match so the device behaves like the browser preview.
#include "aqua_game.h"
#include <math.h>
#include <string.h>

#define TAU 6.28318530718f

const aq_kind_t AQ_CATALOG[AQ_KINDS] = {
    {"ryukin", "琉金", "高背 · 飘尾", false},
    {"ranchu", "兰寿", "圆背 · 无背鳍", false},
    {"oranda", "鹤顶红", "红帽 · 有背鳍", false},
    {"moor", "黑龙睛", "墨色 · 龙睛", false},
    {"pearlscale", "珍珠鳞", "圆身 · 珠鳞", false},
    {"shubunkin", "朱文金", "五花 · 单尾", false},
    {"guppy", "孔雀鱼", "小身 · 扇尾", false},
    {"crab", "螃蟹", "缸底 · 横行", true},
};
enum { KIND_GUPPY = 6 };

static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static float signf(float v) { return v > 0 ? 1.0f : v < 0 ? -1.0f : 0.0f; }
// JavaScript Math.round: halves round towards +infinity.
static float jround(float v) { return floorf(v + 0.5f); }

bool aq_is_daytime(int hour) { return hour >= 7 && hour < 18; }

long aq_days_from_civil(aq_date_t d) {
    int y = d.year - (d.month <= 2);
    long era = (y >= 0 ? y : y - 399) / 400;
    unsigned yoe = (unsigned)(y - era * 400);
    unsigned doy = (153u * (unsigned)(d.month + (d.month > 2 ? -3 : 9)) + 2u) / 5u + (unsigned)d.day - 1u;
    unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
    return era * 146097L + (long)doe - 719468L;
}

int aq_weekday(aq_date_t d) {
    long z = aq_days_from_civil(d);
    return (int)(z >= -4 ? (z + 4) % 7 : (z + 5) % 7 + 6);
}

static float random01(aq_state_t *s) {
    s->seed = s->seed * 1664525u + 1013904223u;
    return (float)((double)s->seed / 4294967296.0);
}

static void make_fish(aq_fish_t *f, int id, int kind, bool adult) {
    static const float XS[8] = {64, 155, 73, 172, 119, 180, 100, 145};
    static const float YS[8] = {135, 145, 191, 202, 220, 174, 160, 180};
    bool bottom = AQ_CATALOG[kind].bottom;
    memset(f, 0, sizeof(*f));
    f->id = id; f->kind = kind; f->adult = adult; f->growth = adult ? AQ_GROWTH : 0;
    f->x = XS[id]; f->y = bottom ? AQ_FLOOR : YS[id];
    f->direction = bottom ? 1 : (id % 2 ? -1 : 1); f->heading = f->direction;
    f->tx = clampf(f->x + f->direction * 70.0f, AQ_X0 + 4, AQ_X1 - 4); f->ty = f->y;
    f->next_turn = 3.0f + id; f->layer = bottom ? 1 : id % 2;
    f->phase = id * 1.7f; f->last_turn = -9.0f;
}

void aq_create(aq_state_t *s, aq_date_t day) {
    static const int KINDS[7] = {0, 2, 1, 3, 5, 6, 7};
    static const bool ADULT[7] = {true, true, false, false, false, true, true};
    memset(s, 0, sizeof(*s));
    s->day = day; s->water = 68.0f; s->seed = 1179u; s->mode = AQ_MODE_HOME;
    s->fish_count = 7;
    for (int i = 0; i < 7; i++) make_fish(&s->fish[i], i, KINDS[i], ADULT[i]);
}

static void note(aq_state_t *s, const char *text) { s->message = text; s->message_until = s->age + 3.0; }

static void reward(aq_state_t *s) {
    if (!s->stamped && s->fed > 0 && s->water >= 90.0f) {
        s->stamped = true; s->stamp_until = s->age + AQ_STAMP_SECONDS; s->care_days++; note(s, "今日照料完成！");
    }
}

static bool all_clean(const aq_state_t *s) {
    for (int i = 0; i < AQ_ROWS; i++) if (!s->dirt_clean[i]) return false;
    return true;
}

static int first_dirty(const aq_state_t *s) {
    for (int i = 0; i < AQ_ROWS; i++) if (!s->dirt_clean[i]) return i;
    return -1;
}

bool aq_next_day(aq_state_t *s, aq_date_t day) {
    long from = aq_days_from_civil(s->day), to = aq_days_from_civil(day);
    // shortcut: state lives in RAM like the browser preview; persisting date and quotas in NVS is future work.
    if (to <= from) return false;
    long elapsed = to - from;
    s->day = day; s->fed = 0; s->stamped = false;
    s->pellet_count = 0; s->ripple_count = 0; s->puff_count = 0; s->wipe_active = false;
    s->water = fmaxf(20.0f, s->water - (float)(elapsed < 10 ? elapsed : 10) * 8.0f);
    for (int i = 0; i < AQ_ROWS; i++) s->dirt_clean[i] = false;
    s->mode = AQ_MODE_HOME;
    note(s, "新的一天，看看鱼儿");
    return true;
}

static void feed(aq_state_t *s) {
    float spot = 70.0f + random01(s) * 100.0f;
    s->pellet_count = s->fish_count * 2;
    for (int i = 0; i < s->pellet_count; i++) {
        aq_pellet_t *p = &s->pellets[i];
        p->x = clampf(jround(spot + (random01(s) - 0.5f) * 40.0f), AQ_X0, AQ_X1);
        p->y = AQ_SURFACE;
        p->vy = 34.0f + random01(s) * 10.0f;
        p->delay = i * 0.05f + random01(s) * 0.12f;
        p->kind = i % 3; p->target = i % s->fish_count;
    }
}

void aq_press(aq_state_t *s, aq_key_t key) {
    s->last_input = s->age;
    // The first key after the idle hide only brings the HUD back, so it never feeds by accident.
    if (s->immersive) { s->immersive = false; return; }
    if (key == AQ_KEY_BACK) { s->mode = AQ_MODE_HOME; return; }
    int delta = key == AQ_KEY_UP ? -1 : 1;
    if (s->mode == AQ_MODE_HOME) {
        if (key != AQ_KEY_OK) { s->selected = (s->selected + delta + AQ_HOME_BUTTONS) % AQ_HOME_BUTTONS; return; }
        if (s->selected == 3) { s->sound = !s->sound; note(s, s->sound ? "水声已打开" : "水声已关闭"); return; }
        if (s->selected == 0) {
            if (s->fed >= AQ_DAILY_FOOD) { note(s, "今天吃饱啦，明天再喂"); return; }
            if (s->pellet_count) { note(s, "等鱼儿吃完这一份"); return; }
            s->fed++; s->water = fmaxf(0.0f, s->water - 3.0f);
            feed(s);
            note(s, "开饭啦！"); reward(s);
        } else if (s->selected == 1) {
            if (s->water >= 99.9f) { note(s, "鱼缸已经很干净啦"); return; }
            s->mode = AQ_MODE_CLEAN; s->lane = 0;
            if (all_clean(s)) for (int i = 0; i < AQ_ROWS; i++) s->dirt_clean[i] = false;
            int dirty = 0;
            for (int i = 0; i < AQ_ROWS; i++) dirty += !s->dirt_clean[i];
            s->clean_step = (100.0f - s->water) / dirty;
            s->lane = first_dirty(s);
        } else { s->mode = AQ_MODE_SELECT; s->choice = 0; }
    } else if (s->mode == AQ_MODE_SELECT) {
        if (key != AQ_KEY_OK) s->choice = (s->choice + delta + AQ_KINDS) % AQ_KINDS;
        else if (s->fish_count >= AQ_MAX_FISH) note(s, "鱼缸满啦，先照料它们");
        else { s->mode = AQ_MODE_SIZE; s->adult_choice = false; }
    } else if (s->mode == AQ_MODE_SIZE) {
        if (key != AQ_KEY_OK) { s->adult_choice = !s->adult_choice; return; }
        if (s->fish_count >= AQ_MAX_FISH) { note(s, "鱼缸满啦"); return; }
        aq_fish_t *f = &s->fish[s->fish_count];
        make_fish(f, s->fish_count, s->choice, s->adult_choice);
        f->x = 125.0f; f->y = AQ_CATALOG[f->kind].bottom ? AQ_FLOOR : 190.0f;
        f->tx = 125.0f + f->direction * 60.0f; f->ty = f->y;
        s->fish_count++; s->mode = AQ_MODE_HOME; note(s, "新朋友入住啦！");
    } else if (s->mode == AQ_MODE_CLEAN) {
        if (key != AQ_KEY_OK) { s->lane = (s->lane + delta + AQ_ROWS) % AQ_ROWS; return; }
        if (s->dirt_clean[s->lane]) { note(s, "这一行很干净，换一行吧"); return; }
        s->dirt_clean[s->lane] = true;
        s->wipe_active = true; s->wipe_lane = s->lane; s->wipe_start = s->age;
        s->water = fminf(100.0f, s->water + s->clean_step);
        int next = first_dirty(s);
        if (next >= 0) s->lane = next;
        else { s->water = 100.0f; note(s, "擦干净啦！长按确定返回"); reward(s); }
    }
}

// Crabs walk sideways and never mirror; the gait frame follows distance walked so feet do not slide.
static bool crawl(aq_state_t *s, aq_fish_t *f, const aq_pellet_t *food, float dt) {
    if (food) { f->tx = food->x; f->pause_until = fminf(f->pause_until, (float)s->age); }
    else if (s->age >= f->next_turn) {
        f->tx = 40.0f + random01(s) * 160.0f;
        f->pause_until = (float)s->age + 1.0f + random01(s) * 3.0f;
        f->next_turn = f->pause_until + 5.0f + random01(s) * 8.0f;
    }
    float dx = f->tx - f->x;
    bool moving = s->age >= f->pause_until && fabsf(dx) > 2.0f;
    float rhythm = 0.3f + 0.7f * (0.5f + 0.5f * cosf(f->stride * TAU / 12.0f));
    float target = moving ? signf(dx) * (food ? 9.0f : 5.0f) * rhythm : 0.0f;
    f->vx += (target - f->vx) * fminf(1.0f, dt * 4.0f);
    float x = clampf(f->x + f->vx * dt, AQ_X0, AQ_X1);
    f->stride += fabsf(x - f->x); f->x = x; f->y = AQ_FLOOR + sinf(f->x / 23.0f) * 2.0f;
    if (food && fabsf(f->x - food->x) < 10.0f) { f->pause_until = (float)s->age + 0.8f; return true; }
    return false;
}

static void wander(aq_state_t *s, aq_fish_t *f) {
    bool guppy = f->kind == KIND_GUPPY;
    int ahead = random01(s) < 0.75f ? f->direction : -f->direction;
    float reach = 40.0f + random01(s) * 90.0f, tx = f->x + ahead * reach;
    if (tx < AQ_X0 + 4 || tx > AQ_X1 - 4) tx = f->x - ahead * reach;
    f->tx = clampf(tx, AQ_X0 + 4, AQ_X1 - 4);
    f->ty = clampf(f->y + (random01(s) - 0.5f) * 56.0f, AQ_Y0 + 4, guppy ? 185.0f : AQ_Y1 - 4);
    f->pause_until = random01(s) < 0.3f ? (float)s->age + 0.6f + random01(s) * 1.4f : 0.0f;
    f->next_turn = (float)s->age + 5.0f + random01(s) * 6.0f;
}

static bool swim(aq_state_t *s, aq_fish_t *f, const aq_pellet_t *food, float dt) {
    bool guppy = f->kind == KIND_GUPPY;
    if (food) { f->tx = clampf(food->x, AQ_X0, AQ_X1); f->ty = clampf(food->y, AQ_Y0, AQ_Y1); }
    else if (s->age >= f->next_turn) wander(s, f);
    float dx = f->tx - f->x, dy = f->ty - f->y, distance = hypotf(dx, dy);
    float cruise = (guppy ? 15.0f : f->adult ? 9.0f : 13.0f) * (0.85f + 0.15f * sinf((float)s->age * 0.7f + f->id));
    float speed = food ? 24.0f : s->age < f->pause_until ? 0.0f : cruise * fminf(1.0f, distance / 20.0f);
    float wx = distance > 3 ? dx / distance * speed : 0.0f;
    float wy = distance > 3 ? clampf(dy / distance * speed, -speed * 0.45f, speed * 0.45f) : 0.0f;
    float goal = wx;
    for (int i = 0; i < s->fish_count; i++) {
        const aq_fish_t *o = &s->fish[i];
        if (o == f || AQ_CATALOG[o->kind].bottom) continue;
        float ox = (f->x - o->x) / AQ_BODY_RX, oy = (f->y - o->y) / AQ_BODY_RY, e = hypotf(ox, oy);
        if (e >= 1.8f) continue;
        float push = (1.8f - e) / 1.8f * (o->layer == f->layer ? 1.0f : 0.35f) * (food ? 0.5f : 1.0f);
        float nx = e > 1e-6f ? ox / e : (f->id > o->id ? 1.0f : -1.0f), ny = e > 1e-6f ? oy / e : 0.0f;
        bool below = ny > 0 || (ny == 0 && f->id > o->id);
        wx += nx * push * 8.0f; wy += (ny + (below ? 0.4f : -0.4f)) * push * 12.0f;
    }
    if (f->x < AQ_X0 + 14) wx += (AQ_X0 + 14 - f->x) * 0.8f; else if (f->x > AQ_X1 - 14) wx -= (f->x - AQ_X1 + 14) * 0.8f;
    if (f->y < AQ_Y0 + 8) wy += (AQ_Y0 + 8 - f->y) * 0.6f; else if (f->y > AQ_Y1 - 8) wy -= (f->y - AQ_Y1 + 8) * 0.6f;
    if (f->turn > 0) {
        f->turn = fmaxf(0.0f, f->turn - dt);
        if (f->turn <= AQ_TURN / 2) f->direction = f->heading;
    }
    int want = fabsf(goal) > 1.2f ? (int)signf(goal) : f->direction;
    if (f->turn == 0 && want != f->direction && (food || s->age - f->last_turn > AQ_TURN_COOLDOWN)) {
        f->heading = want; f->turn = AQ_TURN; f->last_turn = (float)s->age;
        if (!food && random01(s) < 0.3f) f->layer ^= 1;
    }
    if (f->turn > 0 || (int)signf(wx) != f->direction) wx *= 0.25f;
    f->vx += (wx - f->vx) * fminf(1.0f, dt * 2.5f);
    f->vy += (wy - f->vy) * fminf(1.0f, dt * 2.0f);
    f->x = clampf(f->x + f->vx * dt, AQ_X0, AQ_X1);
    f->y = clampf(f->y + f->vy * dt, AQ_Y0, AQ_Y1);
    float pitch = f->turn > 0 ? 0.0f : clampf(f->vy / (fabsf(f->vx) + 3.0f), -0.6f, 0.6f);
    f->pitch += (pitch - f->pitch) * fminf(1.0f, dt * 3.0f);
    float hz = fminf(AQ_MAX_TAIL_HZ, 0.7f + hypotf(f->vx, f->vy) * 0.12f);
    f->phase = fmodf(f->phase + dt * TAU * hz, TAU);
    if (!food) return false;
    float reach = fmaxf(0.0f, fabsf(f->y - food->y) - fmaxf(0.0f, food->y - AQ_Y1));
    return hypotf(f->x - food->x, reach) < 16.0f;
}

void aq_update(aq_state_t *s, float dt) {
    if (!(dt > 0) || isinf(dt)) return;
    if (dt > 0.25f) dt = 0.25f;
    s->age += dt;
    if (!s->immersive && s->age - s->last_input >= AQ_IDLE_SECONDS) { s->immersive = true; s->mode = AQ_MODE_HOME; }
    for (int i = 0; i < s->pellet_count; i++) {
        aq_pellet_t *p = &s->pellets[i];
        if (p->delay > 0) {
            p->delay -= dt;
            if (p->delay <= 0) {
                bool near = false;
                for (int r = 0; r < s->ripple_count; r++)
                    if (fabsf(s->ripples[r].x - p->x) < 24.0f && s->age - s->ripples[r].start < 0.4) near = true;
                if (!near && s->ripple_count < AQ_MAX_RIPPLES) {
                    s->ripples[s->ripple_count++] = (aq_fx_t){p->x, AQ_SURFACE, s->age};
                    s->plops++;
                }
            }
            continue;
        }
        p->vy += (14.0f + p->kind * 3.0f - p->vy) * fminf(1.0f, dt * 2.5f);
        p->y = fminf(AQ_SAND, p->y + p->vy * dt);
    }
    int n = 0;
    for (int i = 0; i < s->ripple_count; i++) if (s->age - s->ripples[i].start < 0.6) s->ripples[n++] = s->ripples[i];
    s->ripple_count = n; n = 0;
    for (int i = 0; i < s->puff_count; i++) if (s->age - s->puffs[i].start < 0.45) s->puffs[n++] = s->puffs[i];
    s->puff_count = n;
    if (s->wipe_active && s->age - s->wipe_start > AQ_WIPE + 1.0f) s->wipe_active = false;
    for (int k = 0; k < s->fish_count; k++) {
        aq_fish_t *f = &s->fish[k];
        bool bottom = AQ_CATALOG[f->kind].bottom;
        int fi = -1;
        for (int i = 0; i < s->pellet_count; i++) {
            const aq_pellet_t *p = &s->pellets[i];
            if (p->target == f->id && p->delay <= 0 && (!bottom || p->y >= 240.0f)) { fi = i; break; }
        }
        const aq_pellet_t *food = fi >= 0 ? &s->pellets[fi] : NULL;
        bool ate = bottom ? crawl(s, f, food, dt) : swim(s, f, food, dt);
        if (!ate) continue;
        if (s->puff_count < AQ_MAX_PUFFS) s->puffs[s->puff_count++] = (aq_fx_t){food->x, food->y, s->age};
        memmove(&s->pellets[fi], &s->pellets[fi + 1], (size_t)(s->pellet_count - fi - 1) * sizeof(aq_pellet_t));
        s->pellet_count--;
        if (!f->adult) {
            f->growth = f->growth + 2 > AQ_GROWTH ? AQ_GROWTH : f->growth + 2;
            if (f->growth == AQ_GROWTH) { f->adult = true; if (!bottom) note(s, "一条小鱼长大啦！"); }
        }
    }
}

aq_pose_t aq_pose(const aq_fish_t *f) {
    if (AQ_CATALOG[f->kind].bottom)
        return (aq_pose_t){AQ_ROLE_WALK, fabsf(f->vx) > 0.4f ? (int)floorf(f->stride / AQ_STEP_PX) % 4 : 0};
    if (f->turn > 0) {
        float t = 1.0f - f->turn / AQ_TURN;
        return (aq_pose_t){AQ_ROLE_TURN, t < 0.25f || t >= 0.75f ? 0 : 1};
    }
    return (aq_pose_t){AQ_ROLE_SWIM, (int)floorf(f->phase / TAU * AQ_SWIM_FRAMES) % AQ_SWIM_FRAMES};
}
