// Stable LAN resolver: DHCP leases keep the gateway address across WAN/DNS changes.
export const ROUTER_DNS=String.raw`
static bool clex_rt_dns_io(int fd,void*buffer,size_t length,bool sending){
 uint8_t*p=buffer;
while(length){int n=sending?send(fd,p,length,0):recv(fd,p,length,0);
if(n<=0)return false;
p+=n;
length-=n;
}return true;
}
static void clex_rt_dns_timeout(int fd,unsigned milliseconds){struct timeval timeout={.tv_sec=milliseconds/1000,.tv_usec=(milliseconds%1000)*1000};
setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));
setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&timeout,sizeof(timeout));
}
static int clex_rt_dns_listener(uint32_t ip,int type){
 int fd=socket(AF_INET,type,IPPROTO_IP);
if(fd<0)return -1;
int reuse=1;
setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&reuse,sizeof(reuse));
struct sockaddr_in address={.sin_family=AF_INET,.sin_port=htons(53),.sin_addr.s_addr=ip};
 if(bind(fd,(struct sockaddr*)&address,sizeof(address))||(type==SOCK_STREAM&&listen(fd,3))){close(fd);
return -1;
}clex_rt_dns_timeout(fd,2000);
return fd;
}
static size_t clex_rt_dns_exchange(uint8_t*packet,size_t length,bool tcp,uint32_t server,esp_netif_t*wan,unsigned timeout){
 if(!wan||length<12||length>4096||(packet[2]&0x80))return 0;
struct ifreq interface={0};
if(esp_netif_get_netif_impl_name(wan,interface.ifr_name)!=ESP_OK)return 0;
 int fd=socket(AF_INET,tcp?SOCK_STREAM:SOCK_DGRAM,IPPROTO_IP);
if(fd<0)return 0;
clex_rt_dns_timeout(fd,timeout);
uint8_t id[2]={packet[0],packet[1]};
size_t count=0;
uint16_t prefix;
 struct sockaddr_in destination={.sin_family=AF_INET,.sin_port=htons(53),.sin_addr.s_addr=server};
 if(setsockopt(fd,SOL_SOCKET,SO_BINDTODEVICE,&interface,sizeof(interface))||connect(fd,(struct sockaddr*)&destination,sizeof(destination)))goto done;
 if(tcp){prefix=htons(length);
if(!clex_rt_dns_io(fd,&prefix,2,true)||!clex_rt_dns_io(fd,packet,length,true)||!clex_rt_dns_io(fd,&prefix,2,false))goto done;
count=ntohs(prefix);
if(count<12||count>4096||!clex_rt_dns_io(fd,packet,count,false)){count=0;
goto done;
}}
 else {if(send(fd,packet,length,0)!=(int)length)goto done;
int n=recv(fd,packet,4096,0);
if(n<12)goto done;
count=n;
}
 if(packet[0]!=id[0]||packet[1]!=id[1]||!(packet[2]&0x80))count=0;
done:close(fd);
return count;
}
static size_t clex_rt_dns_name_end(const uint8_t*p,size_t length,size_t offset){
 while(offset<length){uint8_t n=p[offset++];if(!n)return offset;if((n&0xc0)==0xc0)return offset<length?offset+1:0;if(n>63||offset+n>length)return 0;offset+=n;}return 0;
}
static bool clex_rt_resolve(esp_netif_t*wan,const char*host,esp_ip4_addr_t*out,unsigned timeout){
 if(esp_netif_str_to_ip4(host,out)==ESP_OK&&out->addr)return true;
 esp_netif_dns_info_t dns={0};if(esp_netif_get_dns_info(wan,ESP_NETIF_DNS_MAIN,&dns)!=ESP_OK||dns.ip.type!=ESP_IPADDR_TYPE_V4||!dns.ip.u_addr.ip4.addr)return false;
 uint8_t packet[1024]={0};uint16_t id=esp_random();packet[0]=id>>8;packet[1]=id;packet[2]=1;packet[5]=1;size_t offset=12;const char*label=host;
 while(*label){const char*dot=strchr(label,'.');size_t length=dot?(size_t)(dot-label):strlen(label);if(!length||length>63||offset+length+6>sizeof(packet))return false;packet[offset++]=length;memcpy(packet+offset,label,length);offset+=length;if(!dot)break;label=dot+1;}
 packet[offset++]=0;packet[offset++]=0;packet[offset++]=1;packet[offset++]=0;packet[offset++]=1;
 // The exchange helper accepts 4096-byte buffers; keep the resolver's bounded packet on heap.
 uint8_t*reply=malloc(4096);if(!reply)return false;memcpy(reply,packet,offset);size_t size=clex_rt_dns_exchange(reply,offset,false,dns.ip.u_addr.ip4.addr,wan,timeout<2000?timeout:2000);bool found=false;
 if(size>=12&&!(reply[3]&15)&&!(reply[2]&2)){unsigned questions=((unsigned)reply[4]<<8)|reply[5],answers=((unsigned)reply[6]<<8)|reply[7];size_t at=12;if(questions>4||answers>64)goto done;
  for(unsigned i=0;i<questions;i++){at=clex_rt_dns_name_end(reply,size,at);if(!at||at+4>size)goto done;at+=4;}
  for(unsigned i=0;i<answers;i++){at=clex_rt_dns_name_end(reply,size,at);if(!at||at+10>size)goto done;unsigned type=((unsigned)reply[at]<<8)|reply[at+1],class=((unsigned)reply[at+2]<<8)|reply[at+3],length=((unsigned)reply[at+8]<<8)|reply[at+9];at+=10;if(at+length>size)goto done;if(type==1&&class==1&&length==4){memcpy(&out->addr,reply+at,4);found=out->addr!=0;break;}at+=length;}
 }
done:free(reply);return found;
}
static void clex_rt_dns_task(void*unused){
 (void)unused;
int udp=-1,tcp=-1;
uint32_t bound=0;
uint8_t*packet=malloc(4096);
if(!packet){clex_rt_error(ESP_ERR_NO_MEM,"DNS buffers");
vTaskDelete(NULL);
return;
}
 for(;;){
  clex_rt_config_t config;
xSemaphoreTake(clex_rt_mutex,portMAX_DELAY);
config=clex_rt_config;
bool running=clex_rt_value.running;
xSemaphoreGive(clex_rt_mutex);
  uint32_t address=running?clex_rt_ip(config.lan_ip):0;
  if(bound!=address){if(udp>=0)close(udp);
if(tcp>=0)close(tcp);
udp=tcp=-1;
bound=address;
}
  if(!address){vTaskDelay(pdMS_TO_TICKS(250));
continue;
}
  if(udp<0)udp=clex_rt_dns_listener(address,SOCK_DGRAM);
if(tcp<0)tcp=clex_rt_dns_listener(address,SOCK_STREAM);
  if(udp<0||tcp<0){clex_rt_error(ESP_FAIL,"DNS listener");
vTaskDelay(pdMS_TO_TICKS(1000));
continue;
}
  fd_set readfds;
FD_ZERO(&readfds);
FD_SET(udp,&readfds);
FD_SET(tcp,&readfds);
struct timeval wait={.tv_sec=0,.tv_usec=250000};
int highest=udp>tcp?udp:tcp;
if(select(highest+1,&readfds,NULL,NULL,&wait)<=0)continue;
  bool stream=FD_ISSET(tcp,&readfds);
struct sockaddr_in peer={0};
socklen_t size=sizeof(peer);
int client=stream?accept(tcp,(struct sockaddr*)&peer,&size):udp;
if(client<0)continue;
size_t length=0;
uint16_t prefix;
  if(stream){clex_rt_dns_timeout(client,2000);
if(clex_rt_dns_io(client,&prefix,2,false)){length=ntohs(prefix);
if(length<12||length>4096||!clex_rt_dns_io(client,packet,length,false))length=0;
}}
  else {int n=recvfrom(udp,packet,4096,0,(struct sockaddr*)&peer,&size);
if(n>=12)length=n;
}
  uint32_t mask=clex_rt_ip(config.lan_mask);
if(length&&(peer.sin_addr.s_addr&mask)==(address&mask)){
   clex_rt_snapshot_t value=clex_rt_read();
uint32_t server=clex_rt_ip(config.lan_dns[0]?config.lan_dns:value.dns[0]?value.dns:"1.1.1.1");
esp_netif_t*wan=atomic_load(&clex_rt_dns_wan);
size_t received=server!=address?clex_rt_dns_exchange(packet,length,stream,server,wan,2000):0;
   if(received){if(stream){prefix=htons(received);
clex_rt_dns_io(client,&prefix,2,true);
clex_rt_dns_io(client,packet,received,true);
}else sendto(udp,packet,received,0,(struct sockaddr*)&peer,size);
}
  }
  if(stream)close(client);
 }
}
`;
