// AquaDays firmware entry: display + buttons + 12 Hz game loop on the FoloToy AI Passport.
// No LVGL: the whole 240x320 frame is drawn into one RGB565 buffer and pushed in strips.
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "bsp_audio.h"
#include "bsp_battery.h"
#include "bsp_button.h"
#include "bsp_display.h"
#include "aqua_game.h"
#include "aqua_net.h"
#include "aqua_render.h"
#include "aqua_sound.h"
#include "aq_flash_epoch.h"

static const char *TAG = "aquadays";

#define STRIP_H 40
#define FRAME_MS 83
#define STATS_EVERY_FRAMES 120

extern const uint8_t bg_day_start[] asm("_binary_background_rgb565_start");
extern const uint8_t bg_night_start[] asm("_binary_background_night_rgb565_start");
extern const uint8_t sprites_start[] asm("_binary_fish_rgb565a8_start");
extern const uint8_t font_start[] asm("_binary_font_1bpp_bin_start");

static uint16_t s_fb[AQ_W * AQ_H];
static aq_state_t s_game;
static QueueHandle_t s_keys;

// Runs in the button timer task: only forwards keys, the game itself lives in the main loop.
// UP/DOWN act on press like the browser preview; OK acts on release, a long hold means back.
static void on_button(bsp_btn_t btn, bsp_btn_ev_t ev, void *user) {
    (void)user;
    aq_key_t key;
    int count = 1;
    if (btn != BSP_BTN_OK && ev == BSP_BTN_PRESS) key = btn == BSP_BTN_UP ? AQ_KEY_UP : AQ_KEY_DOWN;
    else if (btn == BSP_BTN_OK && ev == BSP_BTN_CLICK) key = AQ_KEY_OK;
    else if (btn == BSP_BTN_OK && ev == BSP_BTN_DOUBLE) { key = AQ_KEY_OK; count = 2; }
    else if (btn == BSP_BTN_OK && ev == BSP_BTN_LONG) key = AQ_KEY_BACK;
    else return;
    for (int i = 0; i < count; i++)
        if (xQueueSend(s_keys, &key, 0) != pdTRUE) ESP_LOGW(TAG, "key queue full, dropped key %d", key);
}

// Streams tank sounds. Reads sound/immersive/plops from the game state written by the main loop;
// single-word reads, and the blocking write between blocks makes the compiler reload them.
#define AUDIO_BLOCK 320   // 20 ms at 16 kHz
#define AUDIO_VOLUME 70

static void audio_task(void *arg) {
    (void)arg;
    static int16_t block[AUDIO_BLOCK];
    static aq_sound_t synth;
    aq_sound_init(&synth, 1179);
    uint32_t heard = s_game.plops;
    int failures = 0;
    for (;;) {
        uint32_t plops = s_game.plops;
        if (plops < heard) heard = plops;
        for (; heard < plops; heard++) aq_sound_plop(&synth);
        aq_sound_render(&synth, block, AUDIO_BLOCK, s_game.sound, s_game.immersive);
        if (bsp_audio_write(block, sizeof block) != ESP_OK) {
            if (failures++ % 250 == 0) ESP_LOGE(TAG, "audio write failed (%d so far)", failures);
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
}

static void start_audio(void) {
    esp_err_t e = bsp_audio_init();
    if (e == ESP_OK) e = bsp_audio_set_format(AQ_SOUND_RATE, 16, 1);
    if (e != ESP_OK) { ESP_LOGE(TAG, "audio unavailable, running silent: %s", esp_err_to_name(e)); return; }
    bsp_audio_set_volume(AUDIO_VOLUME);
    if (xTaskCreate(audio_task, "aqua_audio", 4096, NULL, 5, NULL) != pdPASS) ESP_LOGE(TAG, "audio task not started");
    else ESP_LOGI(TAG, "audio ready: %d Hz mono, volume %d, water sound off until toggled", AQ_SOUND_RATE, AUDIO_VOLUME);
}

// ---- Storage --------------------------------------------------------------
// Our own NVS namespace, next to the stock firmware's keys. NVS is never erased here: on this
// device it also holds the saved Wi-Fi network, and erasing flash would destroy device identity.
#define NVS_NS "aquadays"
#define CLOCK_SAVE_EVERY_S 60
static bool s_nvs_ok;

static void storage_init(void) {
    esp_err_t e = nvs_flash_init();
    s_nvs_ok = e == ESP_OK;
    if (!s_nvs_ok) ESP_LOGE(TAG, "NVS unavailable (%s): progress and clock will not be saved", esp_err_to_name(e));
}

static bool load_blob(const char *key, void *out, size_t size) {
    nvs_handle_t h;
    if (!s_nvs_ok || nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t n = size;
    esp_err_t e = nvs_get_blob(h, key, out, &n);
    nvs_close(h);
    return e == ESP_OK && n == size;
}

static void save_blob(const char *key, const void *data, size_t size) {
    nvs_handle_t h;
    if (!s_nvs_ok) return;
    esp_err_t e = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (e == ESP_OK) {
        e = nvs_set_blob(h, key, data, size);
        if (e == ESP_OK) e = nvs_commit(h);
        nvs_close(h);
    }
    if (e != ESP_OK) ESP_LOGE(TAG, "saving %s failed: %s", key, esp_err_to_name(e));
}

// ---- Wall clock -----------------------------------------------------------
// Beijing local seconds since 1970 = s_clock_base + uptime. Sources, best last: build time, the
// time saved before the last power-off, a manual edit, network time.
static int64_t s_clock_base;
static aq_clock_source_t s_clock_source;

static int64_t uptime_s(void) { return esp_timer_get_time() / 1000000; }
static int64_t local_seconds(void) { return s_clock_base + uptime_s(); }

static int64_t build_epoch(void) {
    static const char *MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0};
    int day = 1, year = 2026, h = 0, m = 0, sec = 0;
    sscanf(__DATE__, "%3s %d %d", mon, &day, &year);
    sscanf(__TIME__, "%d:%d:%d", &h, &m, &sec);
    const char *p = strstr(MONTHS, mon);
    aq_date_t d = {year, p ? (int)(p - MONTHS) / 3 + 1 : 1, day};
    return (int64_t)aq_days_from_civil(d) * 86400 + h * 3600 + m * 60 + sec;
}

// Reject absurd timestamps (e.g. year 2098 from a wrapped year editor) so they cannot stick in NVS.
// Cap at 2036: far enough for daily use, short of the old wrap-around into the 2090s.
static bool clock_sane(int64_t local) {
    if (local < 1704067200LL) return false;  // before 2024-01-01
    time_t t = (time_t)local;
    struct tm tm;
    gmtime_r(&t, &tm);
    int year = tm.tm_year + 1900;
    return year >= AQ_YEAR_MIN && year <= 2036;
}

static void set_clock(int64_t local, aq_clock_source_t source) {
    if (!clock_sane(local)) {
        ESP_LOGW(TAG, "ignoring out-of-range clock (%lld)", (long long)local);
        return;
    }
    s_clock_base = local - uptime_s();
    s_clock_source = source;
    save_blob("clock", &local, sizeof local);
}

static void clock_boot(void) {
    // Prefer: compile time < flash-time PC clock (when injected) < saved < (Wi-Fi later).
    // A non-zero flash epoch always beats compile time: the build finishes a few seconds after the
    // header is written, so comparing flash > build would ignore the computer clock we just baked in.
    int64_t build = build_epoch(), flash = AQ_FLASH_EPOCH, saved = 0, best = build;
    s_clock_source = AQ_CLOCK_BUILD;
    if (flash != 0 && clock_sane(flash)) {
        best = flash;
        s_clock_source = AQ_CLOCK_FLASH;
    }
    bool loaded = load_blob("clock", &saved, sizeof saved);
    if (loaded && saved > best && clock_sane(saved)) {
        best = saved;
        s_clock_source = AQ_CLOCK_SAVED;
    } else if (loaded && !clock_sane(saved)) {
        // Overwrite a corrupt saved value (without erasing the rest of NVS) so the next boot is clean.
        ESP_LOGW(TAG, "discarding corrupt saved clock");
        save_blob("clock", &best, sizeof best);
    }
    s_clock_base = best - uptime_s();
    // Persist a freshly flashed PC clock so the next reboot keeps it without needing Wi-Fi.
    if (s_clock_source == AQ_CLOCK_FLASH) {
        int64_t now = local_seconds();
        save_blob("clock", &now, sizeof now);
    }
    static const char *NAMES[] = {"build time", "the time saved before power-off", "network", "manual", "computer at flash"};
    ESP_LOGI(TAG, "clock from %s", NAMES[s_clock_source]);
}

static void local_now(aq_date_t *date, int *hour, int *minute) {
    time_t t = (time_t)local_seconds();
    struct tm tm;
    gmtime_r(&t, &tm);
    *date = (aq_date_t){tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday};
    *hour = tm.tm_hour;
    *minute = tm.tm_min;
}

// The CW2017 fuel gauge shares the I2C bus with the codec; reading it every 30 s is plenty.
#define BATTERY_EVERY_MS 30000
static volatile int s_battery = -1;

static void battery_task(void *arg) {
    (void)arg;
    esp_err_t e = bsp_battery_init();
    if (e != ESP_OK) { ESP_LOGW(TAG, "fuel gauge unavailable: %s", esp_err_to_name(e)); vTaskDelete(NULL); return; }
    for (int last = -2;; vTaskDelay(pdMS_TO_TICKS(BATTERY_EVERY_MS))) {
        int soc = bsp_battery_soc();
        if (soc > 100) soc = 100;
        s_battery = soc;
        if (soc != last) ESP_LOGI(TAG, "battery %d%% (%d mV)", soc, bsp_battery_mv());
        last = soc;
    }
}

// One-shot Wi-Fi time sync before the display buffers are allocated, so the radio gets the heap
// peak it needs; afterwards the driver is torn down and that RAM goes back to the game.
static void sync_network_time(void) {
    if (!s_nvs_ok) { ESP_LOGI(TAG, "network time: skipped, NVS unavailable"); return; }
    int64_t utc = 0;
    aq_net_result_t r = aq_net_sync_time(&utc);
    ESP_LOGI(TAG, "network time: %s", aq_net_result_text(r));
    if (r == AQ_NET_OK) {
        set_clock(utc + 8 * 3600, AQ_CLOCK_WIFI);
        ESP_LOGI(TAG, "clock set from network time");
    }
}

// ST7789 expects big-endian RGB565; swap each strip into a DMA buffer. Two buffers alternate,
// which is safe because the next draw_bitmap waits for the previous strip before sending.
static void present(esp_lcd_panel_handle_t panel, uint16_t *strips[2]) {
    for (int y = 0, n = 0; y < AQ_H; y += STRIP_H, n ^= 1) {
        uint16_t *dst = strips[n];
        const uint16_t *src = &s_fb[y * AQ_W];
        for (int i = 0; i < AQ_W * STRIP_H; i++) dst[i] = (uint16_t)(src[i] << 8 | src[i] >> 8);
        esp_err_t e = esp_lcd_panel_draw_bitmap(panel, 0, y, AQ_W, y + STRIP_H, dst);
        if (e != ESP_OK) ESP_LOGE(TAG, "draw_bitmap y=%d failed: %s", y, esp_err_to_name(e));
    }
}

void app_main(void) {
    ESP_LOGI(TAG, "AquaDays boot, free heap %u", (unsigned)esp_get_free_heap_size());
    storage_init();
    clock_boot();
    // Backlight is still off: use the full heap for a short Wi-Fi connect, then tear the radio down.
    sync_network_time();
    ESP_LOGI(TAG, "after network, free heap %u", (unsigned)esp_get_free_heap_size());

    ESP_ERROR_CHECK(bsp_display_init());
    esp_lcd_panel_handle_t panel = bsp_display_panel();
    uint16_t *strips[2];
    for (int i = 0; i < 2; i++) {
        strips[i] = heap_caps_malloc(AQ_W * STRIP_H * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
        if (!strips[i]) { ESP_LOGE(TAG, "no DMA memory for strip %d", i); return; }
    }

    static const aq_assets_t assets = {bg_day_start, bg_night_start, sprites_start, font_start};
    aq_render_init(&assets);

    aq_date_t today;
    int hour, minute;
    local_now(&today, &hour, &minute);
    // saved mirrors what is in NVS; the loop writes whenever the live snapshot differs from it.
    aq_save_t saved = {0};
    bool had_save = load_blob("save", &saved, sizeof saved);
    if (had_save && aq_restore(&s_game, &saved, today))
        ESP_LOGI(TAG, "progress restored: %d creatures, fed %d/%d, water %d", s_game.fish_count, s_game.fed,
                 AQ_DAILY_FOOD, (int)s_game.water);
    else {
        aq_create(&s_game, today);
        ESP_LOGI(TAG, "%s", had_save ? "saved progress unreadable, fresh tank" : "no saved progress, fresh tank");
        memset(&saved, 0, sizeof saved);
    }
    ESP_LOGI(TAG, "clock starts at %04d-%02d-%02d %02d:%02d", today.year, today.month, today.day, hour, minute);

    aq_render_clock = esp_timer_get_time;
    // First frame before the backlight comes on, so the screen never flashes old content.
    s_game.clock_source = s_clock_source;
    aq_render(s_fb, &s_game, hour, minute);
    present(panel, strips);
    bsp_display_backlight(80);

    start_audio();
    if (xTaskCreate(battery_task, "aqua_batt", 3072, NULL, 2, NULL) != pdPASS) ESP_LOGE(TAG, "battery task not started");

    s_keys = xQueueCreate(16, sizeof(aq_key_t));
    esp_err_t be = bsp_button_init(on_button, NULL);
    if (be != ESP_OK) ESP_LOGE(TAG, "buttons unavailable: %s", esp_err_to_name(be));

    TickType_t wake = xTaskGetTickCount();
    int64_t busy_us = 0, worst_us = 0, render_us = 0, present_us = 0;
    bool immersive = false;
    uint32_t clock_sets = s_game.clock_sets;
    for (uint32_t frame = 1;; frame++) {
        int64_t t0 = esp_timer_get_time();
        aq_key_t key;
        while (xQueueReceive(s_keys, &key, 0) == pdTRUE) {
            aq_press(&s_game, key);
            ESP_LOGI(TAG, "key %d -> mode %d selected %d lane %d", key, s_game.mode, s_game.selected, s_game.lane);
        }
        if (s_game.clock_sets != clock_sets) {
            clock_sets = s_game.clock_sets;
            const int *v = s_game.clock_set;
            set_clock((int64_t)aq_days_from_civil((aq_date_t){v[0], v[1], v[2]}) * 86400 + v[3] * 3600 + v[4] * 60, AQ_CLOCK_MANUAL);
            ESP_LOGI(TAG, "clock set by hand to %04d-%02d-%02d %02d:%02d", v[0], v[1], v[2], v[3], v[4]);
        }
        local_now(&today, &hour, &minute);
        s_game.now[0] = today.year; s_game.now[1] = today.month; s_game.now[2] = today.day;
        s_game.now[3] = hour; s_game.now[4] = minute;
        s_game.clock_source = s_clock_source;
        s_game.battery = s_battery;
        if (aq_next_day(&s_game, today)) ESP_LOGI(TAG, "new day %04d-%02d-%02d", today.year, today.month, today.day);
        aq_update(&s_game, 1.0f / 12);
        // Once a second: persist progress if anything that survives a restart changed.
        if (frame % 12 == 0) {
            aq_save_t now_save;
            aq_snapshot(&s_game, &now_save);
            if (memcmp(&now_save, &saved, sizeof saved)) {
                saved = now_save;
                save_blob("save", &saved, sizeof saved);
                ESP_LOGI(TAG, "progress saved");
            }
        }
        if (frame % (12 * CLOCK_SAVE_EVERY_S) == 0) {
            int64_t t = local_seconds();
            if (clock_sane(t)) save_blob("clock", &t, sizeof t);
        }
        if (s_game.immersive != immersive) {
            immersive = s_game.immersive;
            ESP_LOGI(TAG, "HUD %s", immersive ? "hidden after idle" : "shown again by a key");
        }
        int64_t t1 = esp_timer_get_time();
        aq_render(s_fb, &s_game, hour, minute);
        int64_t t2 = esp_timer_get_time();
        present(panel, strips);

        int64_t used = esp_timer_get_time() - t0;
        busy_us += used;
        render_us += t2 - t1;
        present_us += esp_timer_get_time() - t2;
        if (used > worst_us) worst_us = used;
        if (frame % STATS_EVERY_FRAMES == 0) {
            const int64_t *sec = aq_render_sections, n = STATS_EVERY_FRAMES * 1000;
            ESP_LOGI(TAG, "frame avg %lld ms (render %lld = bg %lld + fish %lld + glass %lld + hud %lld, present %lld), "
                     "worst %lld ms (budget %d) | mode %d fish %d water %d battery %d | heap %u, min %u",
                     busy_us / n, render_us / n, sec[AQ_PROF_BG] / n, sec[AQ_PROF_FISH] / n, sec[AQ_PROF_GLASS] / n,
                     sec[AQ_PROF_HUD] / n, present_us / n, worst_us / 1000, FRAME_MS, s_game.mode, s_game.fish_count,
                     (int)s_game.water, s_game.battery, (unsigned)esp_get_free_heap_size(), (unsigned)esp_get_minimum_free_heap_size());
            busy_us = worst_us = render_us = present_us = 0;
            memset(aq_render_sections, 0, sizeof aq_render_sections);
        }
        if (used / 1000 >= FRAME_MS) wake = xTaskGetTickCount();
        else vTaskDelayUntil(&wake, pdMS_TO_TICKS(FRAME_MS));
    }
}
