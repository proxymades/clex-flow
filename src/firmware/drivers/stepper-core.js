// Integer motion planning. Positions count STEP rising edges, never encoder feedback.
export const STEPPER_CORE=String.raw`
enum { SP_DONE=1, SP_STOPPED=2, SP_ERROR=4 };
enum { SP_OK=0, SP_BUSY=1, SP_NOT_READY=2, SP_POSITION_LIMIT=3, SP_TIMER_ERROR=4, SP_ARGUMENT=5 };
typedef struct {
 bool ready,moving,enabled,high,stop_requested,release_requested,reverse;
 uint32_t target,emitted,speed,acceleration,pulse_us,interval_us,events,owner,error;
 int32_t position;
} clex_sp_core_t;
static uint32_t clex_sp_sqrt(uint32_t value){uint32_t root=0,bit=1u<<30;while(bit>value)bit>>=2;while(bit){if(value>=root+bit){value-=root+bit;root=(root>>1)+bit;}else root>>=1;bit>>=2;}return root;}
static uint32_t clex_sp_interval(const clex_sp_core_t*s){
 uint32_t velocity=s->speed;
 if(s->acceleration){uint32_t distance=s->emitted>=10000000?10000000:s->emitted+1;if(s->target&&s->target-s->emitted<distance)distance=s->target-s->emitted;uint64_t squared=2ULL*s->acceleration*distance,limit=(uint64_t)s->speed*s->speed;velocity=clex_sp_sqrt((uint32_t)(squared<limit?squared:limit));if(!velocity)velocity=1;}
 return (1000000u+velocity-1)/velocity;
}
static unsigned clex_sp_begin(clex_sp_core_t*s,unsigned owner,uint32_t target,bool reverse,uint32_t speed,uint32_t acceleration){
 if(!s->ready)return SP_NOT_READY;
 if(s->moving)return SP_BUSY;
 if(!speed||speed>2000||acceleration>20000||target>10000000)return SP_ARGUMENT;
 if(target&&((!reverse&&(int64_t)s->position+target>INT32_MAX)||(reverse&&(int64_t)s->position-target<INT32_MIN)))return SP_POSITION_LIMIT;
 s->owner=owner;s->target=target;s->reverse=reverse;s->speed=speed;s->acceleration=acceleration;s->emitted=0;s->error=SP_OK;s->events=0;
 s->stop_requested=false;s->release_requested=false;s->high=false;s->moving=true;s->enabled=true;s->interval_us=clex_sp_interval(s);return SP_OK;
}
static void clex_sp_finish_stop(clex_sp_core_t*s){s->moving=false;s->high=false;if(s->release_requested)s->enabled=false;s->stop_requested=false;s->events|=SP_STOPPED;}
static void clex_sp_halt(clex_sp_core_t*s,unsigned owner,bool release){
 s->owner=owner;s->stop_requested=true;s->release_requested=release;
 if(!s->high)clex_sp_finish_stop(s);
}
static uint32_t clex_sp_tick(clex_sp_core_t*s){
 if(!s->moving)return 0;
 if(s->high){s->high=false;if(s->stop_requested){clex_sp_finish_stop(s);return 0;}if(s->target&&s->emitted==s->target){s->moving=false;s->events|=SP_DONE;return 0;}s->interval_us=clex_sp_interval(s);return s->interval_us-s->pulse_us;}
 if(s->stop_requested){clex_sp_finish_stop(s);return 0;}
 if((s->reverse&&s->position==INT32_MIN)||(!s->reverse&&s->position==INT32_MAX)){s->moving=false;s->enabled=false;s->error=SP_POSITION_LIMIT;s->events|=SP_ERROR;return 0;}
 s->high=true;s->position+=s->reverse?-1:1;if(s->emitted<UINT32_MAX)s->emitted++;return s->pulse_us;
}
`;
