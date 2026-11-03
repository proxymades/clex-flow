#include "features.h"
#include <math.h>
#include <string.h>
#define PI 3.14159265358979323846f
static float hann[KWS_FRAME], weights[KWS_MELS][KWS_FFT/2+1];
static float twiddle_real[KWS_FFT/2], twiddle_imag[KWS_FFT/2];
static int first_bin[KWS_MELS], last_bin[KWS_MELS];
void kws_features_init(void) {
    for (int i=0; i<KWS_FRAME; ++i) hann[i]=0.5f-0.5f*cosf(2*PI*i/(KWS_FRAME-1));
    for (int i=0; i<KWS_FFT/2; ++i) {
        twiddle_real[i]=cosf(-2*PI*i/KWS_FFT);
        twiddle_imag[i]=sinf(-2*PI*i/KWS_FFT);
    }
    float edges[KWS_MELS+2];
    float low=2595*log10f(1+80.0f/700), high=2595*log10f(1+7600.0f/700);
    for (int m=0; m<KWS_MELS+2; ++m) edges[m]=700*(powf(10,(low+(high-low)*m/(KWS_MELS+1))/2595)-1);
    for (int m=0; m<KWS_MELS; ++m) {
        first_bin[m]=KWS_FFT/2;
        last_bin[m]=0;
        for (int k=0; k<=KWS_FFT/2; ++k) {
            float hz=(float)k*KWS_RATE/KWS_FFT;
            float weight=fminf((hz-edges[m])/(edges[m+1]-edges[m]),(edges[m+2]-hz)/(edges[m+2]-edges[m+1]));
            weights[m][k]=fmaxf(0,weight);
            if (weight>0) {
                if (k<first_bin[m]) first_bin[m]=k;
                last_bin[m]=k;
            }
        }
    }
}
static void fft(float *re,float *im) {
    for (unsigned i=1,j=0; i<KWS_FFT; ++i) {
        unsigned bit=KWS_FFT>>1;
        for (; j&bit; bit>>=1) j^=bit;
        j^=bit;
        if (i<j) {
            float t=re[i];re[i]=re[j];re[j]=t;
        }
    }
    for (int size=2;size<=KWS_FFT;size<<=1) {
        int half=size/2, stride=KWS_FFT/size;
        for (int base=0;base<KWS_FFT;base+=size) {
            for (int j=0;j<half;++j) {
                int a=base+j,b=a+half,t=j*stride;
                float vr=re[b]*twiddle_real[t]-im[b]*twiddle_imag[t];
                float vi=re[b]*twiddle_imag[t]+im[b]*twiddle_real[t];
                float ur=re[a],ui=im[a];
                re[a]=ur+vr;im[a]=ui+vi;re[b]=ur-vr;im[b]=ui-vi;
            }
        }
    }
}
void kws_features(const int16_t *pcm,float *output) {
    float re[KWS_FFT],im[KWS_FFT],power[KWS_FFT/2+1];
    for (int frame=0;frame<KWS_FRAMES;++frame) {
        int start=frame*KWS_HOP;
        memset(re,0,sizeof(re));memset(im,0,sizeof(im));
        for (int i=0;i<KWS_FRAME;++i) {
            int index=start+i;
            float x=pcm[index]/32768.0f;
            float prev=index>0?pcm[index-1]/32768.0f:0;
            re[i]=(x-0.97f*prev)*hann[i];
        }
        fft(re,im);
        for (int k=0;k<=KWS_FFT/2;++k) power[k]=(re[k]*re[k]+im[k]*im[k])/KWS_FFT;
        for (int m=0;m<KWS_MELS;++m) {
            float sum=0;
            for (int k=first_bin[m];k<=last_bin[m];++k) sum+=power[k]*weights[m][k];
            float normalized=(10*log10f(fmaxf(sum,1e-10f))+80)/80;
            output[frame*KWS_MELS+m]=fminf(1,fmaxf(0,normalized));
        }
    }
}
