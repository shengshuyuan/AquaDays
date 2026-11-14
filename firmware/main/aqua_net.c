#include "aqua_net.h"
#include <netdb.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "nvs.h"

static const char *TAG = "aqua_net";

#define CONNECTED_BIT BIT0
#define FAILED_BIT BIT1
#define CONNECT_TIMEOUT_MS 12000
#define SNTP_TIMEOUT_MS 8000
#define CONNECT_RETRIES 3
// Anything earlier than 2024-01-01 means the clock was never set.
#define MIN_VALID_UTC 1704067200LL

static EventGroupHandle_t s_events;
static int s_retries;

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) esp_wifi_connect();
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (++s_retries <= CONNECT_RETRIES) { ESP_LOGW(TAG, "disconnected, retry %d", s_retries); esp_wifi_connect(); }
        else xEventGroupSetBits(s_events, FAILED_BIT);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) xEventGroupSetBits(s_events, CONNECTED_BIT);
}

// The stock firmware lets the user switch Wi-Fi off; respect that choice.
static bool wifi_switched_off(void) {
    nvs_handle_t h;
    uint8_t on = 1;
    if (nvs_open("wifi_ui", NVS_READONLY, &h) != ESP_OK) return false;
    nvs_get_u8(h, "enabled", &on);
    nvs_close(h);
    return on == 0;
}

// Parse "Date: Fri, 14 Nov 2026 11:29:00 GMT" into a Unix UTC second.
static int64_t parse_http_date(const char *value) {
    static const char *MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";
    char mon[4] = {0};
    int d, y, h, m, s;
    if (sscanf(value, "%*3s, %d %3s %d %d:%d:%d", &d, mon, &y, &h, &m, &s) != 6) return 0;
    const char *p = strstr(MONTHS, mon);
    if (!p) return 0;
    int mo = (int)(p - MONTHS) / 3 + 1, yy = y - (mo <= 2);
    long era = yy / 400, yoe = yy - era * 400, doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    long days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    return (int64_t)days * 86400 + h * 3600 + m * 60 + s;
}

// UDP/123 is blocked on some networks, so a plain HTTP Date header is the fallback.
// Uses a raw socket instead of esp_http_client to keep the Wi-Fi one-shot small.
static int64_t http_date(const char *host, const char *path) {
    struct addrinfo hints = {.ai_family = AF_INET, .ai_socktype = SOCK_STREAM}, *res = NULL;
    if (getaddrinfo(host, "80", &hints, &res) != 0 || !res) {
        ESP_LOGW(TAG, "HTTP Date DNS failed for a host");
        return 0;
    }
    int sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
    if (sock < 0) { freeaddrinfo(res); return 0; }
    struct timeval tv = {.tv_sec = 4, .tv_usec = 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    int64_t utc = 0;
    if (connect(sock, res->ai_addr, res->ai_addrlen) == 0) {
        char req[160];
        int n = snprintf(req, sizeof req, "HEAD %s HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n", path, host);
        if (n > 0 && n < (int)sizeof req && send(sock, req, (size_t)n, 0) == n) {
            char buf[512];
            int got = 0;
            while (got < (int)sizeof buf - 1) {
                int r = recv(sock, buf + got, (size_t)(sizeof buf - 1 - got), 0);
                if (r <= 0) break;
                got += r;
                buf[got] = 0;
                if (strstr(buf, "\r\n\r\n")) break;
            }
            char *line = buf;
            while (line && *line) {
                char *end = strstr(line, "\r\n");
                if (end) *end = 0;
                if (!strncasecmp(line, "Date:", 5)) {
                    const char *v = line + 5;
                    while (*v == ' ' || *v == '\t') v++;
                    utc = parse_http_date(v);
                    break;
                }
                line = end ? end + 2 : NULL;
            }
        }
    } else ESP_LOGW(TAG, "HTTP Date connect failed for a host");
    close(sock);
    freeaddrinfo(res);
    return utc;
}

aq_net_result_t aq_net_sync_time(int64_t *utc) {
    *utc = 0;
    if (wifi_switched_off()) return AQ_NET_NO_SAVED_WIFI;
    ESP_LOGI(TAG, "start, free heap %u", (unsigned)esp_get_free_heap_size());
    aq_net_result_t result = AQ_NET_ERROR;
    esp_netif_t *netif = NULL;
    bool wifi_inited = false, sntp_on = false;
    esp_event_handler_instance_t h_wifi = NULL, h_ip = NULL;
    s_retries = 0;
    if (!s_events) s_events = xEventGroupCreate();
    xEventGroupClearBits(s_events, CONNECTED_BIT | FAILED_BIT);

    esp_err_t e = esp_netif_init();
    if (e == ESP_OK) { e = esp_event_loop_create_default(); if (e == ESP_ERR_INVALID_STATE) e = ESP_OK; }
    if (e == ESP_OK && !(netif = esp_netif_create_default_wifi_sta())) e = ESP_FAIL;
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    if (e == ESP_OK && (e = esp_wifi_init(&init)) == ESP_OK) wifi_inited = true;
    if (e != ESP_OK) { ESP_LOGE(TAG, "Wi-Fi driver start failed: %s", esp_err_to_name(e)); goto done; }

    // esp_wifi_init() loads the station settings the stock firmware saved; we only read them.
    wifi_config_t saved = {0};
    esp_wifi_get_config(WIFI_IF_STA, &saved);
    if (!saved.sta.ssid[0]) { result = AQ_NET_NO_SAVED_WIFI; goto done; }
    ESP_LOGI(TAG, "saved Wi-Fi found, connecting");

    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL, &h_wifi);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL, &h_ip);
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    esp_wifi_set_mode(WIFI_MODE_STA);
    if ((e = esp_wifi_start()) != ESP_OK) { ESP_LOGE(TAG, "esp_wifi_start: %s", esp_err_to_name(e)); goto done; }
    EventBits_t bits = xEventGroupWaitBits(s_events, CONNECTED_BIT | FAILED_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(CONNECT_TIMEOUT_MS));
    if (!(bits & CONNECTED_BIT)) { result = AQ_NET_NO_CONNECTION; goto done; }
    ESP_LOGI(TAG, "connected, asking for the time");

    esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG_MULTIPLE(2, ESP_SNTP_SERVER_LIST("ntp.aliyun.com", "cn.pool.ntp.org"));
    if (esp_netif_sntp_init(&sntp) == ESP_OK) {
        sntp_on = true;
        if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(SNTP_TIMEOUT_MS)) == ESP_OK) {
            struct timeval tv;
            gettimeofday(&tv, NULL);
            *utc = tv.tv_sec;
        } else ESP_LOGW(TAG, "SNTP timed out, trying HTTP Date");
    }
    if (*utc < MIN_VALID_UTC) *utc = http_date("www.baidu.com", "/");
    if (*utc < MIN_VALID_UTC) *utc = http_date("connect.rom.miui.com", "/generate_204");
    result = *utc >= MIN_VALID_UTC ? AQ_NET_OK : AQ_NET_NO_TIME;

done:
    if (sntp_on) esp_netif_sntp_deinit();
    if (wifi_inited) { esp_wifi_disconnect(); esp_wifi_stop(); esp_wifi_deinit(); }
    if (h_wifi) esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, h_wifi);
    if (h_ip) esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, h_ip);
    if (netif) esp_netif_destroy_default_wifi(netif);
    ESP_LOGI(TAG, "%s, radio off, free heap %u", aq_net_result_text(result), (unsigned)esp_get_free_heap_size());
    return result;
}

const char *aq_net_result_text(aq_net_result_t r) {
    switch (r) {
        case AQ_NET_OK: return "time synced";
        case AQ_NET_NO_SAVED_WIFI: return "no saved Wi-Fi";
        case AQ_NET_NO_CONNECTION: return "saved Wi-Fi not reachable";
        case AQ_NET_NO_TIME: return "no time server answered";
        default: return "Wi-Fi driver error";
    }
}
