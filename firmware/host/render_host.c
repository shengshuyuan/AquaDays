// Host check for the firmware renderer: builds the same scenarios as AquaRender.scenario() and
// writes raw 240x320 RGB565 frames, so tools/compare_host.cjs can diff them against the browser.
// Build: cc -O2 -I../main render_host.c ../main/aqua_game.c ../main/aqua_render.c -lm -o render_host
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "aqua_render.h"

static uint8_t *load(const char *dir, const char *name) {
    char path[1024];
    snprintf(path, sizeof path, "%s/%s", dir, name);
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); exit(1); }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)n);
    if (fread(buf, 1, (size_t)n, f) != (size_t)n) { fprintf(stderr, "short read %s\n", path); exit(1); }
    fclose(f);
    return buf;
}

static void scenario(aq_state_t *s, const char *name) {
    aq_create(s, (aq_date_t){2026, 11, 6});
    if (!strcmp(name, "select")) { s->mode = AQ_MODE_SELECT; s->choice = 1; }
    if (!strcmp(name, "feed")) {
        s->fed = 1; aq_press(s, AQ_KEY_OK);
        for (int i = 0; i < 14; i++) aq_update(s, 1.0f / 12);
        s->message = "今天吃饱啦，明天再喂"; s->message_until = s->age + 20;
    }
    if (!strcmp(name, "clean")) {
        s->selected = 1; aq_press(s, AQ_KEY_OK); aq_press(s, AQ_KEY_OK);
        for (int i = 0; i < 20; i++) aq_update(s, 1.0f / 12);
        aq_press(s, AQ_KEY_OK);
        for (int i = 0; i < 4; i++) aq_update(s, 1.0f / 12);
        s->message = NULL;
    }
    if (!strcmp(name, "size")) { s->mode = AQ_MODE_SIZE; s->choice = 3; s->adult_choice = true; }
    if (!strcmp(name, "swim")) for (int i = 0; i < 120; i++) aq_update(s, 1.0f / 12);
    if (!strcmp(name, "immersive")) for (int i = 0; i < (int)AQ_IDLE_SECONDS * 12 + 24; i++) aq_update(s, 1.0f / 12);
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: render_host <assets-dir> <out-dir>\n"); return 1; }
    aq_assets_t a = {load(argv[1], "background.rgb565"), load(argv[1], "background-night.rgb565"),
                     load(argv[1], "fish.rgb565a8"), load(argv[1], "font-1bpp.bin")};
    aq_render_init(&a);
    static uint16_t fb[AQ_W * AQ_H];
    static aq_state_t s;
    const char *names[] = {"home", "select", "size", "feed", "clean", "swim", "immersive"};
    for (int n = 0; n < 7; n++)
        for (int night = 0; night < 2; night++) {
            scenario(&s, names[n]);
            aq_render(fb, &s, night ? 21 : 14, 36);
            char path[1024];
            snprintf(path, sizeof path, "%s/%s-%s.rgb565", argv[2], names[n], night ? "night" : "day");
            FILE *f = fopen(path, "wb");
            fwrite(fb, 2, AQ_W * AQ_H, f);
            fclose(f);
        }
    puts("host frames written");
    return 0;
}
