// AquaDays game state and rules. C port of prototype/game.js; no ESP-IDF or display dependencies,
// so the host build in firmware/host can run it unchanged.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define AQ_KINDS 8
#define AQ_MAX_FISH 8
#define AQ_DAILY_FOOD 2
#define AQ_GROWTH 24
#define AQ_ROWS 3
#define AQ_MAX_PELLETS (AQ_MAX_FISH * 2)
#define AQ_MAX_RIPPLES 8
#define AQ_MAX_PUFFS 16

#define AQ_X0 36.0f
#define AQ_X1 204.0f
#define AQ_Y0 116.0f
#define AQ_Y1 226.0f
#define AQ_FLOOR 249.0f
#define AQ_SURFACE 30.0f
#define AQ_SAND 252.0f
#define AQ_WIPE 0.7f
// The care stamp line shows for AQ_STAMP_SECONDS; after AQ_IDLE_SECONDS without a key the HUD hides.
#define AQ_STAMP_SECONDS 10.0
#define AQ_IDLE_SECONDS 180.0
// Home buttons: feed, clean, choose fish, water sound.
#define AQ_HOME_BUTTONS 4

#define AQ_TURN 0.36f
#define AQ_TURN_COOLDOWN 1.2f
#define AQ_SWIM_FRAMES 4
#define AQ_STEP_PX 3.0f
#define AQ_BODY_RX 34.0f
#define AQ_BODY_RY 20.0f
#define AQ_MAX_TAIL_HZ 3.0f

typedef enum { AQ_MODE_HOME, AQ_MODE_SELECT, AQ_MODE_SIZE, AQ_MODE_CLEAN } aq_mode_t;
typedef enum { AQ_KEY_UP, AQ_KEY_DOWN, AQ_KEY_OK, AQ_KEY_BACK } aq_key_t;
typedef enum { AQ_ROLE_SWIM = 0, AQ_ROLE_TURN = 1, AQ_ROLE_WALK = 2 } aq_role_t;

typedef struct { const char *id, *name, *trait; bool bottom; } aq_kind_t;
extern const aq_kind_t AQ_CATALOG[AQ_KINDS];

typedef struct {
    int id, kind, growth, direction, heading, layer;
    bool adult;
    float x, y, vx, vy, tx, ty, next_turn, pause_until, phase, turn, last_turn, pitch, stride;
} aq_fish_t;

typedef struct { float x, y, vy, delay; int kind, target; } aq_pellet_t;
typedef struct { float x, y; double start; } aq_fx_t;
typedef struct { int year, month, day; } aq_date_t;
typedef struct { aq_role_t role; int frame; } aq_pose_t;

typedef struct {
    aq_date_t day;
    int fed, care_days, selected, choice, lane;
    // sound: the running-water loop (off by default); plops counts food splashes for the audio task.
    bool stamped, adult_choice, immersive, sound;
    uint32_t plops;
    float water, clean_step;
    aq_mode_t mode;
    double age, message_until, stamp_until, last_input;
    uint32_t seed;
    const char *message;
    aq_fish_t fish[AQ_MAX_FISH];
    int fish_count;
    aq_pellet_t pellets[AQ_MAX_PELLETS];
    int pellet_count;
    bool dirt_clean[AQ_ROWS];
    bool wipe_active;
    int wipe_lane;
    double wipe_start;
    aq_fx_t ripples[AQ_MAX_RIPPLES];
    int ripple_count;
    aq_fx_t puffs[AQ_MAX_PUFFS];
    int puff_count;
} aq_state_t;

bool aq_is_daytime(int hour);
void aq_create(aq_state_t *s, aq_date_t day);
// Moves the game to a later calendar day; returns false for the same or an earlier day.
bool aq_next_day(aq_state_t *s, aq_date_t day);
void aq_press(aq_state_t *s, aq_key_t key);
void aq_update(aq_state_t *s, float dt);
aq_pose_t aq_pose(const aq_fish_t *f);
// Days since 1970-01-01 (proleptic Gregorian) and weekday 0 = Sunday.
long aq_days_from_civil(aq_date_t d);
int aq_weekday(aq_date_t d);
