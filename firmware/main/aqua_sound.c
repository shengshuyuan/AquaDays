#include "aqua_sound.h"
#include <math.h>

// sin(2*pi*i/256) in Q15. Built once at start-up; the per-sample path stays integer.
static int16_t SINE[256];
static bool sine_ready;

static void build_sine(void) {
    for (int i = 0; i < 256; i++) SINE[i] = (int16_t)floor(sin(i * 6.283185307179586 / 256) * 32767 + 0.5);
    sine_ready = true;
}

static uint32_t rnd(aq_sound_t *s) { return s->seed = s->seed * 1664525u + 1013904223u; }
// Uniform integer in [lo, hi].
static int32_t between(aq_sound_t *s, int32_t lo, int32_t hi) { return lo + (int32_t)((rnd(s) >> 8) % (uint32_t)(hi - lo + 1)); }
static uint32_t hz(int32_t f) { return (uint32_t)((uint64_t)f * 4294967296ull / AQ_SOUND_RATE); }

static void start_voice(aq_sound_t *s, int32_t f0, int32_t amp, int32_t decay, int sweep_shift) {
    aq_voice_t *v = &s->voice[0];
    for (int i = 0; i < AQ_SOUND_VOICES; i++) if (s->voice[i].env < v->env) v = &s->voice[i];
    *v = (aq_voice_t){0, hz(f0), amp, decay, sweep_shift};
}

void aq_sound_init(aq_sound_t *s, uint32_t seed) {
    if (!sine_ready) build_sine();
    *s = (aq_sound_t){.seed = seed, .lfo = 26000, .lfo_target = 26000, .next_bubble = AQ_SOUND_RATE};
}

void aq_sound_plop(aq_sound_t *s) {
    // A short splash of noise, then the cavity "bloop": low, falling away fast, pitch rising.
    s->splash = 5000;
    start_voice(s, between(s, 380, 620), between(s, 7000, 9000), 32702, 10);
}

void aq_sound_render(aq_sound_t *s, int16_t *out, int n, bool water, bool immersive) {
    const int32_t target = water ? (immersive ? 26000 : 21000) : 0;
    for (int i = 0; i < n; i++, s->clock++) {
        // Gain ramps by 1 per sample at most: about two seconds from silence to full.
        if (s->gain < target) s->gain++;
        else if (s->gain > target) s->gain--;

        int32_t white = (int32_t)(rnd(s) >> 16) - 32768;
        // Air-stone fizz: band-limited noise (lowpass ~1.5 kHz minus lowpass ~250 Hz, so no hiss and
        // no rumble the small speaker cannot play), kept as a faint bed under the bubbles.
        s->lp_fast += ((white - s->lp_fast) * 14580) >> 15;
        s->lp_slow += ((s->lp_fast - s->lp_slow) * 3064) >> 15;
        int32_t fizz = s->lp_fast - s->lp_slow;

        // The fizz breathes a little, as the pump's air stream is never perfectly even.
        if (s->clock >= s->next_lfo) {
            s->lfo_target = between(s, 22000, 32767);
            s->next_lfo = s->clock + (uint32_t)between(s, 6000, 26000);
        }
        s->lfo += (s->lfo_target - s->lfo) >> 12;

        // The aerator itself: a steady stream of tiny, short, high bubbles, about 20 a second...
        if (s->gain > 0 && s->clock >= s->next_tiny) {
            start_voice(s, between(s, 1400, 3200), (between(s, 700, 1800) * s->gain) >> 15, 32480, 10);
            s->next_tiny = s->clock + (uint32_t)between(s, 300, 1400);
        }
        // ...and now and then a bigger one breaking at the surface.
        if (s->gain > 0 && s->clock >= s->next_bubble) {
            start_voice(s, between(s, 500, 900), (between(s, 1500, 2800) * s->gain) >> 15, 32640, 11);
            s->next_bubble = s->clock + (uint32_t)between(s, 12000, 40000);
        }

        // fizz can approach +/-65536, so the swell and fade products need 64 bits.
        int32_t mix = (int32_t)(((((int64_t)fizz * s->lfo) >> 15) * s->gain) >> 15) >> 5;   // fizz at 1/32 scale

        if (s->splash > 8) {
            s->splash_lp += ((white - s->splash_lp) * 20000) >> 15;
            mix += (s->splash_lp * s->splash) >> 15;
            s->splash = (s->splash * 32420) >> 15;   // ~6 ms
        }
        for (int v = 0; v < AQ_SOUND_VOICES; v++) {
            aq_voice_t *b = &s->voice[v];
            if (b->env < 16) continue;
            mix += (SINE[b->phase >> 24] * b->env) >> 15;
            b->phase += b->inc;
            b->inc += b->inc >> b->sweep_shift;
            b->env = (b->env * b->decay) >> 15;
        }
        out[i] = (int16_t)(mix > 32767 ? 32767 : mix < -32768 ? -32768 : mix);
    }
}
