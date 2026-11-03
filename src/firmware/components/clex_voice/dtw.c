#include <math.h>
#include <stdlib.h>
float kws_dtw(const float *a,int n,const float *b,int m,int dims,float band,float early_weight) {
    if(n<1||m<1||m>256||n>256)return 1e9f;
    float prev[257],cur[257];
    for(int j=0;j<=m;++j)prev[j]=1e9f;
    prev[0]=0;
    for(int i=1;i<=n;++i){
        for(int j=0;j<=m;++j)cur[j]=1e9f;
        for(int j=1;j<=m;++j){
            float pos_a=(float)(i-1)/n,pos_b=(float)(j-1)/m;
            if(fabsf(pos_a-pos_b)>band)continue;
            float cost=0;
            for(int k=0;k<dims;++k){float diff=a[(i-1)*dims+k]-b[(j-1)*dims+k];cost+=diff*diff;}
            cost/=dims;
            cost*=pos_a<.35f?early_weight:1;
            cur[j]=cost+fminf(prev[j-1],fminf(prev[j],cur[j-1]));
        }
        for(int j=0;j<=m;++j)prev[j]=cur[j];
    }
    return prev[m]/(n+m);
}
