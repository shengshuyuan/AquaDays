// Host check for aqua_sound: renders a 20 s scripted sample to a WAV and prints level per second
// and energy per frequency band, so loudness and tone can be checked without the device.
// Build: cc -O2 -I../main sound_host.c ../main/aqua_sound.c -lm -o sound_host
// Script: 0-3 s water off with a pinch of food (plops only), 3-12 s water on, 12-16 s immersive,
// 16-20 s water off again (fades out).
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "aqua_sound.h"

#define SECONDS 20
#define N (AQ_SOUND_RATE * SECONDS)

static void put32(FILE *f, uint32_t v) { fwrite(&v, 4, 1, f); }
static void put16(FILE *f, uint16_t v) { fwrite(&v, 2, 1, f); }

static double band_energy(const int16_t *x, int n, double f) {
    double w = 2 * M_PI * f / AQ_SOUND_RATE, c = 2 * cos(w), s1 = 0, s2 = 0;
    for (int i = 0; i < n; i++) { double s0 = x[i] / 32768.0 + c * s1 - s2; s2 = s1; s1 = s0; }
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / n;
}

int main(int argc, char **argv) {
    static int16_t pcm[N];
    aq_sound_t s;
    aq_sound_init(&s, 1179);
    const double plops[] = {0.5, 0.62, 0.78, 0.95, 1.2, 6.0, 6.15, 6.4};
    int next = 0;
    for (int i = 0; i < N; i += 160) {
        double t = (double)i / AQ_SOUND_RATE;
        while (next < 8 && plops[next] <= t) { aq_sound_plop(&s); next++; }
        aq_sound_render(&s, pcm + i, 160, t >= 3 && t < 16, t >= 12 && t < 16);
    }
    for (int sec = 0; sec < SECONDS; sec++) {
        const int16_t *x = pcm + sec * AQ_SOUND_RATE;
        double sum = 0; int peak = 0;
        for (int i = 0; i < AQ_SOUND_RATE; i++) { sum += (double)x[i] * x[i]; if (abs(x[i]) > peak) peak = abs(x[i]); }
        printf("%2d s  rms %6.0f (%5.1f dBFS)  peak %6d (%5.1f dBFS)\n", sec, sqrt(sum / AQ_SOUND_RATE),
               20 * log10(sqrt(sum / AQ_SOUND_RATE) / 32768 + 1e-9), peak, 20 * log10(peak / 32768.0 + 1e-9));
    }
    const double bands[] = {80, 200, 400, 800, 1200, 2000, 3500, 6000};
    printf("water band energy (8-12 s, dB rel. 800 Hz):");
    double ref = band_energy(pcm + 8 * AQ_SOUND_RATE, 4 * AQ_SOUND_RATE, 800);
    for (int b = 0; b < 8; b++) printf("  %.0fHz %+.1f", bands[b], 10 * log10(band_energy(pcm + 8 * AQ_SOUND_RATE, 4 * AQ_SOUND_RATE, bands[b]) / ref));
    printf("\n");
    if (argc > 1) {
        FILE *f = fopen(argv[1], "wb");
        fwrite("RIFF", 1, 4, f); put32(f, 36 + N * 2); fwrite("WAVEfmt ", 1, 8, f);
        put32(f, 16); put16(f, 1); put16(f, 1); put32(f, AQ_SOUND_RATE); put32(f, AQ_SOUND_RATE * 2); put16(f, 2); put16(f, 16);
        fwrite("data", 1, 4, f); put32(f, N * 2); fwrite(pcm, 2, N, f); fclose(f);
        printf("wrote %s\n", argv[1]);
    }
    return 0;
}
