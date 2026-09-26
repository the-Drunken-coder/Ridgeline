export const SENSOR_SIZE = 2048;
export const COVERAGE_SIZE = 512;
export const DISPLAY_SIZE = 1024;
export const sensorShader = `
precision highp float;
uniform vec3 u_sensor,u_right,u_up,u_forward;
uniform vec2 u_tan;
uniform float u_range,u_near;
uniform highp sampler2D u_depth;
vec3 camera(vec3 p){vec3 d=p-u_sensor;return vec3(dot(d,u_right),dot(d,u_up),dot(d,u_forward));}
vec4 sensorClip(vec3 p){vec3 c=camera(p);float n=u_near,f=u_range;return vec4(c.xy/u_tan,((f+n)*c.z-2.*f*n)/(f-n),c.z);}
`;
export const depthVertex = `#version 300 es
${sensorShader}
layout(location=0) in vec3 a_position;
out float v_forward;
void main(){v_forward=camera(a_position).z;gl_Position=sensorClip(a_position);}`;
export const depthFragment = `#version 300 es
precision highp float;in float v_forward;layout(location=0) out float color;void main(){color=v_forward;}`;
export const coverageVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;uniform float u_half;out vec3 v_position;
void main(){v_position=a_position;gl_Position=vec4(a_position.x/u_half,-a_position.y/u_half,0.,1.);}`;
// Shared physical visibility test for both coarse classification and boundary refinement.
const visibilityShader = `
uniform vec4 u_cap;
float visibility(vec3 position,vec3 normal){
 vec3 delta=position-u_sensor;
 if(dot(u_cap.xyz,delta)>u_cap.w+.001)return -1.;
 vec3 c=camera(position);
 if(c.z<=u_near||length(position-u_sensor)>u_range)return -1.;
 vec2 uv=c.xy/(c.z*u_tan)*.5+.5;
 if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return -1.;
 // Compare each neighboring depth against the receiver plane at that texel's ray.
 // Interpolate visibility, never terrain depths: averaging depths invents occluders.
 vec2 samplePosition=uv*${SENSOR_SIZE}.-.5;
 ivec2 base=ivec2(floor(samplePosition));
 vec2 fraction=fract(samplePosition);
 float result=0.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  ivec2 texel=clamp(base+ivec2(x,y),ivec2(0),ivec2(${SENSOR_SIZE - 1}));
  vec2 centre=(vec2(texel)+.5)/${SENSOR_SIZE}.;
  vec2 xy=(centre*2.-1.)*u_tan;
  vec3 ray=u_forward+xy.x*u_right+xy.y*u_up;
  float denominator=dot(normal,ray);
  float receiver=abs(denominator)>1.e-8 ? dot(normal,position-u_sensor)/denominator : c.z;
  float depth=texelFetch(u_depth,texel,0).r;
  vec2 weight=mix(1.-fraction,fraction,vec2(x,y));
  result+=weight.x*weight.y*(receiver<=depth+.35 ? 1. : 0.);
 }
 return result;
}`;

export const coverageFragment = `#version 300 es
${sensorShader}
${visibilityShader}
in vec3 v_position;out vec4 color;
void main(){
 vec3 normal=cross(dFdx(v_position),dFdy(v_position));
 float result=visibility(v_position,normal);
 if(result<0.)discard;
 color=vec4(result,0.,0.,1.);
}`;

export const voteVertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

/** Nine distinct terrain locations per output cell, independent of display colors and opacity. */
export const voteFragment = `#version 300 es
precision highp float;
uniform highp sampler2D u_samples;
out vec4 color;
void main(){
 ivec2 base=ivec2(gl_FragCoord.xy)*3;
 float visible=0.;int known=0;
 for(int y=0;y<3;y++)for(int x=0;x<3;x++){
  vec4 sampleValue=texelFetch(u_samples,base+ivec2(x,y),0);
  if(sampleValue.a>.5){known++;visible+=sampleValue.r;}
 }
 // Unknown coverage cannot certify an entire grid cell.
 color=vec4(visible/9.,float(known)/9.,0.,1.);
}`;

/** Re-test terrain depth near coarse boundaries, then integrate subpixel edge coverage. */
export const boundaryFragment = `#version 300 es
${sensorShader}
${visibilityShader}
uniform highp sampler2D u_votes;
uniform vec2 u_outputSize;
in vec3 v_position;
out vec4 color;
void main(){
 // Derivatives must be evaluated before branches. Subsamples follow this mesh triangle's plane.
 vec3 dx=dFdx(v_position),dy=dFdy(v_position),normal=cross(dx,dy);
 vec2 uv=gl_FragCoord.xy/u_outputSize;
 ivec2 size=textureSize(u_votes,0),cell=ivec2(uv*vec2(size));
 bool allVisible=true,allBlocked=true,allOutside=true;
 // Include neighboring cells: even two individually uniform cells can share a boundary.
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec4 vote=texelFetch(u_votes,clamp(cell+ivec2(x,y),ivec2(0),size-1),0);
  allVisible=allVisible&&vote.g>.999&&vote.r>.999;
  allBlocked=allBlocked&&vote.g>.999&&vote.r<.001;
  allOutside=allOutside&&vote.g<.001;
 }
 if(allOutside){color=vec4(0.);return;}
 if(allVisible||allBlocked){color=vec4(allVisible?1.:0.,allBlocked?1.:0.,0.,1.);return;}
 // Boundary pixels get 64 fresh depth comparisons, at 1/8 of a display texel.
 // This measures coverage of the contour; it does not blur neighboring classifications.
 float visible=0.,blocked=0.;
 for(int y=0;y<8;y++)for(int x=0;x<8;x++){
  vec2 offset=(vec2(x,y)+.5)/8.-.5;
  float result=visibility(v_position+dx*offset.x+dy*offset.y,normal);
  if(result>=0.){visible+=result;blocked+=1.-result;}
 }
 color=vec4(visible/64.,blocked/64.,0.,(visible+blocked)/64.);
}`;

/** Suppress small visibility islands before styling; retain the original footprint coverage. */
export const smoothRegionFragment = `#version 300 es
precision highp float;
uniform highp sampler2D u_regions;
out vec4 color;
void main(){
 ivec2 size=textureSize(u_regions,0),pixel=ivec2(gl_FragCoord.xy);
 vec4 centre=texelFetch(u_regions,pixel,0);
 float coverage=centre.r+centre.g;
 if(coverage<.001){color=vec4(0.);return;}
 float visible=0.,known=0.;
 for(int y=-3;y<=3;y++)for(int x=-3;x<=3;x++){
  ivec2 p=pixel+ivec2(x,y);
  if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,size)))continue;
  vec4 region=texelFetch(u_regions,p,0);
  float weight=float((4-abs(x))*(4-abs(y)));
  visible+=region.r*weight;
  known+=(region.r+region.g)*weight;
 }
 float fraction=smoothstep(.4,.6,visible/max(known,.0001));
 color=vec4(coverage*fraction,coverage*(1.-fraction),0.,coverage);
}`;

/** Style measured coverage and outline each region on its own side of the contour. */
export const regionStyleFragment = `#version 300 es
precision highp float;
uniform highp sampler2D u_regions;
uniform vec4 u_color,u_blocked;
uniform float u_borderWidth;
out vec4 color;
void main(){
 vec2 size=vec2(textureSize(u_regions,0)),uv=gl_FragCoord.xy/size;
 vec4 region=texture(u_regions,uv);
 float coverage=region.r+region.g;
 if(coverage<.001){color=vec4(0.);return;}
 float visible=region.r/coverage;
 float edge=0.;
 if(u_borderWidth>0.)for(int i=0;i<16;i++){
  float angle=float(i)*6.2831853/16.;
  vec4 other=texture(u_regions,uv+vec2(cos(angle),sin(angle))*u_borderWidth/size);
  float total=other.r+other.g;
  float difference=total<.001 ? 1. : abs(visible-other.r/total);
  edge=max(edge,difference);
 }
 float va=mix(u_color.a,1.,edge),ba=mix(u_blocked.a,1.,edge);
 float alpha=region.r*va+region.g*ba;
 vec3 rgb=alpha>0. ? (region.r*va*u_color.rgb+region.g*ba*u_blocked.rgb)/alpha : vec3(0.);
 color=vec4(rgb,alpha);
}`;
