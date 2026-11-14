// Host check for the C game rules that the browser tests cannot reach: save / restore and the clock
// editor. Build: cc -O2 -I../main game_host.c ../main/aqua_game.c -lm -o game_host
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "aqua_game.h"

int main(void) {
    static aq_state_t s, r;
    aq_create(&s, (aq_date_t){2026, 11, 6});
    s.selected = 2; aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_DOWN); aq_press(&s, AQ_KEY_OK);
    assert(s.fish_count == 8 && s.fish[7].adult);
    s.selected = 0; aq_press(&s, AQ_KEY_OK);
    for (int i = 0; i < 2400 && s.pellet_count; i++) aq_update(&s, 1.0f / 12);
    s.sound = true; s.dirt_clean[1] = true;
    aq_save_t v; aq_snapshot(&s, &v);
    assert(aq_restore(&r, &v, (aq_date_t){2026, 11, 6}));
    assert(r.fish_count == 8 && r.fed == 1 && r.sound && r.dirt_clean[1] && r.mode == AQ_MODE_HOME && !r.message);
    for (int i = 0; i < 8; i++) assert(r.fish[i].kind == s.fish[i].kind && r.fish[i].adult == s.fish[i].adult && r.fish[i].growth == s.fish[i].growth);
    assert(aq_restore(&r, &v, (aq_date_t){2026, 11, 8}) && r.fed == 0 && r.water < s.water);
    assert(aq_restore(&r, &v, (aq_date_t){2026, 11, 1}) && r.day.day == 6 && r.fed == 1);
    aq_save_t bad = v; bad.version = 99; assert(!aq_restore(&r, &bad, (aq_date_t){2026, 11, 6}) && r.fish_count == 7);
    bad = v; bad.fish_kind[3] = 99; assert(!aq_restore(&r, &bad, (aq_date_t){2026, 11, 6}));
    bad = v; bad.fed = 3; assert(!aq_restore(&r, &bad, (aq_date_t){2026, 11, 6}));
    bad = v; bad.month = 13; assert(!aq_restore(&r, &bad, (aq_date_t){2026, 11, 6}));

    aq_create(&s, (aq_date_t){2026, 11, 6});
    int now[5] = {2026, 1, 31, 23, 59}; memcpy(s.now, now, sizeof now);
    s.selected = 3; aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_DOWN); aq_press(&s, AQ_KEY_OK);
    assert(s.mode == AQ_MODE_CLOCK);
    aq_press(&s, AQ_KEY_BACK); assert(s.mode == AQ_MODE_SETTINGS && s.clock_sets == 0);
    aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_UP);
    assert(s.clock_edit[1] == 2 && s.clock_edit[2] == 28);
    aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_DOWN); assert(s.clock_edit[2] == 27);
    aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_UP); assert(s.clock_edit[3] == 0);
    aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_UP); assert(s.clock_edit[4] == 0);
    aq_press(&s, AQ_KEY_OK); assert(s.mode == AQ_MODE_SETTINGS && s.clock_sets == 1 && s.clock_set[2] == 27);
    aq_create(&s, (aq_date_t){2026, 11, 6});
    int ymin[5] = {AQ_YEAR_MIN, 2, 29, 0, 0}; memcpy(s.now, ymin, sizeof ymin);
    s.mode = AQ_MODE_SETTINGS; s.setting = 1; aq_press(&s, AQ_KEY_OK); aq_press(&s, AQ_KEY_DOWN);
    assert(s.clock_edit[0] == AQ_YEAR_MIN);
    s.clock_edit[0] = AQ_YEAR_MAX; aq_press(&s, AQ_KEY_UP); assert(s.clock_edit[0] == AQ_YEAR_MAX);
    assert(aq_days_in_month(2024, 2) == 29 && aq_days_in_month(2026, 2) == 28 && aq_days_in_month(2000, 2) == 29);
    printf("C save/restore and clock editor checks passed (save blob %zu bytes)\n", sizeof(aq_save_t));
    return 0;
}
