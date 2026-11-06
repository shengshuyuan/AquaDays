// Procedural tank sounds: a quiet aerator (faint fizz plus a stream of tiny bubbles), and a "plop" for each
// splash of food. Integer-only (the ESP32-C3 has no FPU) and free of ESP-IDF, so the host can
// render it to a WAV; prototype/sound.js is the same algorithm for the browser preview.
#pragma once
#include <stdbool.h>
#include <stdint.h>

#define AQ_SOUND_RATE 16000
#define AQ_SOUND_VOICES 8

typedef struct {
    uint32_t phase, inc;
    int32_t env, decay;   // Q15 amplitude and per-sample decay factor
    int sweep_shift;      // inc grows by inc >> sweep_shift per sample: the rising bubble pitch
} aq_voice_t;

typedef struct {
    uint32_t seed, clock, next_bubble, next_tiny, next_lfo;
    int32_t lp_fast, lp_slow, lfo, lfo_target, gain, splash, splash_lp;
    aq_voice_t voice[AQ_SOUND_VOICES];
} aq_sound_t;

void aq_sound_init(aq_sound_t *s, uint32_t seed);
// One splash of food entering the water.
void aq_sound_plop(aq_sound_t *s);
// Fills n mono 16-bit samples. Water fades in or out over about two seconds when toggled and is
// a little louder in the immersive view; plops always play.
void aq_sound_render(aq_sound_t *s, int16_t *out, int n, bool water, bool immersive);
