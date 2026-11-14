// One-shot network time: joins the Wi-Fi network already saved on the device (by the stock FoloToy
// firmware's provisioning page), asks a time server, then shuts the radio down again so the RAM goes
// back to the renderer and audio. Never writes Wi-Fi settings and never erases NVS.
#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    AQ_NET_OK,
    AQ_NET_NO_SAVED_WIFI,   // nothing saved, or Wi-Fi switched off in the stock firmware
    AQ_NET_NO_CONNECTION,   // saved network not reachable or wrong password
    AQ_NET_NO_TIME,         // connected, but neither SNTP nor the HTTP Date fallback answered
    AQ_NET_ERROR,           // driver could not start (usually not enough free RAM)
} aq_net_result_t;

// Blocking, about 2-25 s. On AQ_NET_OK *utc holds Unix seconds (UTC). Requires nvs_flash_init() first.
aq_net_result_t aq_net_sync_time(int64_t *utc);
const char *aq_net_result_text(aq_net_result_t r);
