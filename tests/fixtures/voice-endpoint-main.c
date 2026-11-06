#include "endpoint.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    unsigned previews,finals,accepted,min_voiced,last_voiced;
    size_t last_count;
    bool too_long;
    int16_t audio[KWS_MAX_UTTERANCE];
} result_t;

static kws_endpoint_t endpoint;
static result_t result;

static bool consume(const int16_t *audio,size_t count,unsigned voiced,bool too_long,bool final,void *context) {
    result_t *r=context;
    assert(count<=KWS_MAX_UTTERANCE);
    if(final) {
        r->finals++;
    } else {
        r->previews++;
    }
    r->last_voiced=voiced;r->last_count=count;r->too_long=too_long;
    memcpy(r->audio,audio,count*sizeof(*audio));
    bool accepted=!too_long&&voiced>=r->min_voiced;
    if(accepted) {
        r->accepted++;
    }
    return accepted;
}

static void reset(unsigned min_voiced) {
    kws_endpoint_reset(&endpoint);
    memset(&result,0,sizeof(result));
    result.min_voiced=min_voiced;
}

static void push(unsigned frames,bool voice) {
    int16_t pcm[KWS_HOP];
    for(unsigned i=0;i<KWS_HOP;i++) {
        pcm[i]=voice?(i%2?400:-400):0;
    }
    for(unsigned i=0;i<frames;i++) {
        /* Audio reads need not align with the endpoint's 20 ms frames. */
        kws_endpoint_push(&endpoint,pcm,137,consume,&result);
        kws_endpoint_push(&endpoint,pcm+137,KWS_HOP-137,consume,&result);
    }
}

int main(void) {
    reset(20);
    push(20,true);push(15,false);
    assert(result.previews==0&&result.finals==0);
    push(1,false);
    assert(result.accepted==1&&result.previews==1&&result.finals==0);
    push(100,false);
    assert(result.previews==1&&result.finals==0);
    puts("PASS: a confident command completes after 320 ms without a longer delay.");

    reset(40);
    push(20,true);push(16,false);
    assert(result.previews==1&&result.accepted==0&&result.finals==0);
    push(38,false); /* A 1080 ms pause inside the same utterance. */
    assert(result.finals==0);
    push(20,true);push(16,false);
    assert(result.previews==2&&result.accepted==1&&result.finals==0);
    assert(result.last_voiced==40&&result.last_count==114*KWS_HOP);
    for(unsigned i=24*KWS_HOP;i<78*KWS_HOP;i++) {
        assert(result.audio[i]==0);
    }
    assert(result.audio[78*KWS_HOP]!=0);
    push(60,false);
    assert(result.finals==0&&result.accepted==1);
    puts("PASS: a rejected fragment retains both words and their pause before acceptance.");

    reset(1000);
    push(20,true);push(59,false);
    assert(result.previews==1&&result.finals==0);
    push(1,false);
    assert(result.finals==1&&result.accepted==0);
    push(20,true);push(60,false);
    assert(result.previews==2&&result.finals==2&&result.last_voiced==20);
    puts("PASS: unknown speech finishes once after 1200 ms and cannot leak into the next utterance.");

    reset(1000);
    push(118,true);push(60,false);
    assert(result.finals==1&&!result.too_long&&result.last_count==KWS_MAX_UTTERANCE);
    reset(1000);
    push(200,true);push(60,false);
    assert(result.finals==1&&result.too_long&&result.accepted==0);
    puts("PASS: silence cannot overflow a valid phrase; overlong speech stays rejected.");

    reset(40);
    push(20,true);push(16,false);
    kws_endpoint_reset(&endpoint);
    push(20,true);push(16,false);
    assert(result.previews==2&&result.accepted==0&&result.last_voiced==20);
    kws_endpoint_discard(&endpoint);
    push(20,true);push(16,false);push(20,true);push(16,false);
    assert(result.previews==3&&result.accepted==0&&result.last_voiced==20);
    puts("PASS: activation resets and dropped audio discard any pending fragment.");
    return 0;
}
