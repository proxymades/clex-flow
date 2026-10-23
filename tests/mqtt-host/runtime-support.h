// Platform services for the generated MQTT runtime on a POSIX host.
// Networking and MQTT remain real; netif readiness/MAC/SNTP represent board services.
#include "mqtt_client.h"
#include "mqtt5_client.h"
#include "cJSON.h"
#include "mbedtls/base64.h"
#include <stdatomic.h>
#include <sys/socket.h>
#include <signal.h>
typedef struct {bool up;} esp_netif_t;
typedef struct {struct {uint32_t addr;} ip,netmask,gw;} esp_netif_ip_info_t;
static esp_netif_t host_netif={.up=true},host_netif_second={.up=true};
static _Atomic(esp_netif_t*) clex_rt_dns_wan=&host_netif;
static esp_netif_t *esp_netif_get_default_netif(void){return &host_netif;}
static esp_netif_t *esp_netif_get_handle_from_ifkey(const char *key){(void)key;return &host_netif;}
static bool esp_netif_is_netif_up(esp_netif_t *netif){return netif->up;}
static esp_err_t esp_netif_get_ip_info(esp_netif_t *netif,esp_netif_ip_info_t *info){(void)netif;memset(info,0,sizeof(*info));info->ip.addr=0x0100007f;return ESP_OK;}
static esp_err_t esp_netif_get_netif_impl_name(esp_netif_t *netif,char *name){(void)netif;snprintf(name,IFNAMSIZ,"lo0");return ESP_OK;}
static esp_err_t esp_efuse_mac_get_default(uint8_t *mac){const uint8_t bytes[]={2,1,2,3,4,5};memcpy(mac,bytes,6);return ESP_OK;}
static esp_err_t esp_crt_bundle_attach(void *conf){(void)conf;return ESP_OK;}
#define SNTP_OPMODE_POLL 0
static bool esp_sntp_enabled(void){return true;}
static void esp_sntp_setoperatingmode(int mode){(void)mode;}
static void esp_sntp_setservername(int index,const char *name){(void)index;(void)name;}
static void esp_sntp_init(void){}
// Controlled wall clock for TLS synchronization state tests only.
static time_t host_clock_value=(time_t)-1;
static time_t host_clock_time(time_t *out){struct timespec now;clock_gettime(CLOCK_REALTIME,&now);time_t value=host_clock_value==(time_t)-1?now.tv_sec:host_clock_value;if(out)*out=value;return value;}
#define time host_clock_time
