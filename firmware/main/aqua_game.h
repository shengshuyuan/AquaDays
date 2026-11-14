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
// Home buttons: feed, clean, choose fish, settings.
#define AQ_HOME_BUTTONS 4
// Settings rows: water sound, set the clock, back to the tank. A pressed button sinks for AQ_PRESS_SECONDS.
#define AQ_SETTINGS_ROWS 3
#define AQ_PRESS_SECONDS 0.15
// Clock editor fields in order: year, month, day, hour, minute.
#define AQ_CLOCK_FIELDS 5
#define AQ_YEAR_MIN 2024
#define AQ_YEAR_MAX 2036
#define AQ_SAVE_VERSION 1

#define AQ_TURN 0.36f
#define AQ_TURN_COOLDOWN 1.2f
#define AQ_SWIM_FRAMES 4
#define AQ_STEP_PX 3.0f
#define AQ_BODY_RX 34.0f
#define AQ_BODY_RY 20.0f
#define AQ_MAX_TAIL_HZ 3.0f

typedef enum { AQ_MODE_HOME, AQ_MODE_SELECT, AQ_MODE_SIZE, AQ_MODE_CLEAN, AQ_MODE_SETTINGS, AQ_MODE_CLOCK } aq_mode_t;
// Where the wall clock came from, shown on the settings page.
typedef enum {
    AQ_CLOCK_BUILD,   // compile-time fallback
    AQ_CLOCK_SAVED,   // last power-off
    AQ_CLOCK_WIFI,    // SNTP / HTTP Date
    AQ_CLOCK_MANUAL,  // settings editor
    AQ_CLOCK_FLASH,   // baked in at flash time from the computer
} aq_clock_source_t;
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
    int fed, care_days, selected, choice, lane, setting;
    // sound: the aerator loop (off by default); plops counts food splashes for the audio task.
    bool stamped, adult_choice, immersive, sound;
    uint32_t plops;
    float water, clean_step;
    aq_mode_t mode;
    double age, message_until, stamp_until, last_input, pressed_at;
    // Written by the platform every frame: now = {year, month, day, hour, minute}, battery 0-100 or -1.
    int now[5], battery;
    aq_clock_source_t clock_source;
    // Clock editor values and field; clock_sets counts confirmed edits, the platform applies clock_set.
    int clock_edit[5], clock_field, clock_set[5];
    uint32_t clock_sets;
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

// What survives a power cut, stored as one NVS blob. Fixed-size fields only; bump AQ_SAVE_VERSION when
// the layout changes so an old blob is ignored instead of misread.
typedef struct {
    uint8_t version, fed, stamped, sound, fish_count;
    uint8_t dirt_clean[AQ_ROWS];
    uint16_t year;
    uint8_t month, day;
    int16_t water_tenths;
    uint16_t care_days;
    uint8_t fish_kind[AQ_MAX_FISH], fish_adult[AQ_MAX_FISH], fish_growth[AQ_MAX_FISH];
} aq_save_t;

bool aq_is_daytime(int hour);
int aq_days_in_month(int year, int month);
void aq_snapshot(const aq_state_t *s, aq_save_t *out);
// Rebuilds the game from a save and moves it on to today; returns false (fresh tank) if the save is invalid.
bool aq_restore(aq_state_t *s, const aq_save_t *save, aq_date_t today);
void aq_create(aq_state_t *s, aq_date_t day);
// Moves the game to a later calendar day; returns false for the same or an earlier day.
bool aq_next_day(aq_state_t *s, aq_date_t day);
void aq_press(aq_state_t *s, aq_key_t key);
void aq_update(aq_state_t *s, float dt);
aq_pose_t aq_pose(const aq_fish_t *f);
// Days since 1970-01-01 (proleptic Gregorian) and weekday 0 = Sunday.
long aq_days_from_civil(aq_date_t d);
int aq_weekday(aq_date_t d);
