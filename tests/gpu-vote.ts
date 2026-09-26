import { voteVertex, voteFragment, boundaryFragment, coverageVertex, SENSOR_SIZE, regionStyleFragment, smoothRegionFragment, coverageFragment } from '../src/gpu-camera-shaders';

/** Run the production vote pass with controlled nine-location terrain classifications. */
export function checkGpuVote() {
  const gl=document.createElement('canvas').getContext('webgl2');
  if(!gl)throw new Error('WebGL2 unavailable');
  const program=gl.createProgram()!,texture=gl.createTexture()!;
  try {
    for(const [type,source] of [[gl.VERTEX_SHADER,voteVertex],[gl.FRAGMENT_SHADER,voteFragment]] as const){
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);gl.viewport(0,0,1,1);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.uniform1i(gl.getUniformLocation(program,'u_samples'),0);
    for(const blocked of [0,1,4,5,8,9]){
      const samples=new Uint8Array(36);
      for(let i=0;i<9;i++){samples[i*4]=i<blocked?0:255;samples[i*4+3]=255;}
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,3,3,0,gl.RGBA,gl.UNSIGNED_BYTE,samples);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      const expected=Math.round((9-blocked)*255/9);
      if(Math.abs(pixel[0]! - expected)>2||pixel[1]!==255)throw new Error(`Wrong vote for ${blocked} blocked samples: ${pixel}`);
    }
    const unknown=new Uint8Array(36);unknown.fill(255);unknown[3]=0;
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,3,3,0,gl.RGBA,gl.UNSIGNED_BYTE,unknown);
    gl.drawArrays(gl.TRIANGLES,0,3);
    const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if(pixel[1]===255)throw new Error('Unknown terrain was marked complete');
    const boundary=gl.createProgram()!,votes=gl.createTexture()!,region=gl.createTexture()!,regionFrame=gl.createFramebuffer()!,vertices=gl.createBuffer()!;
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,coverageVertex],[gl.FRAGMENT_SHADER,boundaryFragment]] as const){
        const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
        gl.attachShader(boundary,shader);gl.deleteShader(shader);
      }
      gl.linkProgram(boundary);
      if(!gl.getProgramParameter(boundary,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(boundary)!);
      gl.useProgram(boundary);gl.viewport(0,0,16,16);
      const u=(name:string)=>gl.getUniformLocation(boundary,name);
      gl.uniform1i(u('u_depth'),0);gl.uniform1i(u('u_votes'),1);
      gl.uniform2f(u('u_outputSize'),16,16);gl.uniform1f(u('u_half'),1);
      gl.uniform3f(u('u_sensor'),0,0,10);gl.uniform3f(u('u_forward'),0,0,-1);
      gl.uniform3f(u('u_right'),1,0,0);gl.uniform3f(u('u_up'),0,1,0);
      gl.uniform2f(u('u_tan'),.1,.1);gl.uniform1f(u('u_range'),20);gl.uniform1f(u('u_near'),.1);
      gl.bindBuffer(gl.ARRAY_BUFFER,vertices);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,1,-1,0,-1,1,0,1,-1,0,1,1,0,-1,1,0]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,votes);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,region);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,16,16,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,regionFrame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,region,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Boundary test framebuffer is incomplete');
      // A mixed coarse cell supplies no location information about the actual boundary.
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,votes);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,255,255,255]));
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      const depths=new Float32Array(SENSOR_SIZE*SENSOR_SIZE),pixels=new Uint8Array(16*16*4);
      const render=(shift:number)=>{
        for(let y=0;y<SENSOR_SIZE;y++)for(let x=0;x<SENSOR_SIZE;x++)
          depths[y*SENSOR_SIZE+x]=(x+y)/SENSOR_SIZE>1+shift?5:10;
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,SENSOR_SIZE,SENSOR_SIZE,0,gl.RED,gl.FLOAT,depths);
        gl.bindFramebuffer(gl.FRAMEBUFFER,regionFrame);
        gl.drawArrays(gl.TRIANGLES,0,6);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        return pixels.slice();
      };
      const first=render(.017),second=render(.032);
      let red=0,green=0,mixed=0,changed=0;
      for(let i=0;i<first.length;i+=4){
        if(first[i]===255)red++;else if(first[i+1]===255)green++;else mixed++;
        if(first[i]!==second[i]||first[i+1]!==second[i+1])changed++;
      }
      if(!red||!green||!mixed||mixed>32)throw new Error(`Expected a narrow measured contour: ${red} visible, ${green} blocked, ${mixed} edge`);
      if(!changed)throw new Error('Subpixel depth-boundary movement did not change coverage');
      const styling=gl.createProgram()!;
      try {
        for(const [type,source] of [[gl.VERTEX_SHADER,voteVertex],[gl.FRAGMENT_SHADER,regionStyleFragment]] as const){
          const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
          gl.attachShader(styling,shader);gl.deleteShader(shader);
        }
        gl.linkProgram(styling);
        if(!gl.getProgramParameter(styling,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(styling)!);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(styling);gl.viewport(0,0,16,16);
        gl.uniform1i(gl.getUniformLocation(styling,'u_regions'),0);
        gl.uniform4f(gl.getUniformLocation(styling,'u_color'),0,1,0,1);
        gl.uniform4f(gl.getUniformLocation(styling,'u_blocked'),1,0,0,0);
        gl.uniform1f(gl.getUniformLocation(styling,'u_borderWidth'),0);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,region);
        gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]!>0&&pixels[i]!==0)throw new Error('Transparent blocked color contaminated edge');
      } finally {gl.deleteProgram(styling);}
    } finally {gl.deleteProgram(boundary);gl.deleteTexture(votes);gl.deleteTexture(region);gl.deleteFramebuffer(regionFrame);gl.deleteBuffer(vertices);}

    const continuity=gl.createProgram()!;
    try {
      const vertex=`#version 300 es
      precision highp float;uniform float u_x;out vec3 v_position;
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2)*2.-1.;gl_Position=vec4(p,0.,1.);v_position=vec3(p*.00001+vec2(u_x,0.),0.);}`;
      for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,coverageFragment]] as const){
        const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
        gl.attachShader(continuity,shader);gl.deleteShader(shader);
      }
      gl.linkProgram(continuity);
      if(!gl.getProgramParameter(continuity,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(continuity)!);
      gl.disableVertexAttribArray(0);gl.useProgram(continuity);gl.viewport(0,0,1,1);
      const u=(name:string)=>gl.getUniformLocation(continuity,name);
      gl.uniform1i(u('u_depth'),0);gl.uniform3f(u('u_sensor'),0,0,10);
      gl.uniform3f(u('u_forward'),0,0,-1);gl.uniform3f(u('u_right'),1,0,0);gl.uniform3f(u('u_up'),0,1,0);
      gl.uniform2f(u('u_tan'),.1,.1);gl.uniform1f(u('u_range'),20);gl.uniform1f(u('u_near'),.1);
      const depths=new Float32Array(SENSOR_SIZE*SENSOR_SIZE);
      for(let y=0;y<SENSOR_SIZE;y++)for(let x=0;x<SENSOR_SIZE;x++)depths[y*SENSOR_SIZE+x]=x<SENSOR_SIZE/2?5:10;
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,SENSOR_SIZE,SENSOR_SIZE,0,gl.RED,gl.FLOAT,depths);
      const values:number[]=[];
      for(const offset of [-.5,0,.5]){
        gl.uniform1f(u('u_x'),offset/SENSOR_SIZE);gl.drawArrays(gl.TRIANGLES,0,3);
        const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);values.push(pixel[0]!);
      }
      if(values.some((v,i)=>Math.abs(v-[64,128,191][i]!)>3))throw new Error(`Depth texel transition snaps instead of tracking subpixel movement: ${values}`);
      // Both classification and wireframe must obey the same finite end cap.
      gl.uniform4fv(u('u_cap'),[0,0,-1,9]);
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
      const capped=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,capped);
      if(capped[3]!==0)throw new Error('Ground beyond wireframe end cap was shaded');
      gl.uniform4fv(u('u_cap'),[0,0,-1,11]);
      gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,capped);
      if(Number(capped[3])!==255)throw new Error('Ground inside wireframe end cap was excluded');

    } finally {gl.deleteProgram(continuity);}
    const smoothing=gl.createProgram()!;
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,voteVertex],[gl.FRAGMENT_SHADER,smoothRegionFragment]] as const){
        const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
        gl.attachShader(smoothing,shader);gl.deleteShader(shader);
      }
      gl.linkProgram(smoothing);
      if(!gl.getProgramParameter(smoothing,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(smoothing)!);
      gl.useProgram(smoothing);gl.viewport(0,0,16,16);
      gl.uniform1i(gl.getUniformLocation(smoothing,'u_regions'),0);
      const regions=new Uint8Array(16*16*4);
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){
        const i=(y*16+x)*4,blocked=x>=12||(x>=5&&x<=7&&y>=5&&y<=7);
        regions[i+(blocked?1:0)]=255;regions[i+3]=255;
      }
      regions[0]=0;regions[3]=0;regions[4]=128;regions[7]=128;
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,16,16,0,gl.RGBA,gl.UNSIGNED_BYTE,regions);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixels=new Uint8Array(16*16*4);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const centre=(6*16+6)*4,large=(6*16+15)*4;
      if(pixels[centre]!<250||pixels[centre+1]!>5)throw new Error('Small blocked island survived smoothing');
      if(pixels[large+1]!<250)throw new Error('Smoothing erased a large blocked region');
      if(pixels[3]!==0||pixels[7]!==128)throw new Error('Smoothing changed footprint coverage');
    } finally {gl.deleteProgram(smoothing);}
    const styling=gl.createProgram()!;
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,voteVertex],[gl.FRAGMENT_SHADER,regionStyleFragment]] as const){
        const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)!);
        gl.attachShader(styling,shader);gl.deleteShader(shader);
      }
      gl.linkProgram(styling);
      if(!gl.getProgramParameter(styling,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(styling)!);
      gl.disableVertexAttribArray(0);
      gl.useProgram(styling);gl.viewport(0,0,16,16);
      gl.uniform1i(gl.getUniformLocation(styling,'u_regions'),0);
      gl.uniform4f(gl.getUniformLocation(styling,'u_color'),0,1,0,.25);
      gl.uniform4f(gl.getUniformLocation(styling,'u_blocked'),1,0,0,.4);
      gl.uniform1f(gl.getUniformLocation(styling,'u_borderWidth'),2);
      const regions=new Uint8Array(16*16*4);
      for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;regions[i+(x<8?0:1)]=255;regions[i+3]=255;}
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,16,16,0,gl.RGBA,gl.UNSIGNED_BYTE,regions);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.drawArrays(gl.TRIANGLES,0,3);
      const pixels=new Uint8Array(16*16*4);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      const at=(x:number,channel:number)=>pixels[(8*16+x)*4+channel]!;
      if(at(7,1)!==255||at(7,3)<240||at(8,0)!==255||at(8,3)<240)throw new Error(`Both sides of the visibility border must retain their own opaque color: ${Array.from(pixels.slice((8*16+7)*4,(8*16+9)*4))}; GL ${gl.getError()}`);
      if(Math.abs(at(2,3)-64)>1||Math.abs(at(13,3)-102)>1)throw new Error('Border altered interior fill opacity');
      gl.uniform1f(gl.getUniformLocation(styling,'u_borderWidth'),0);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      if(Math.abs(at(7,3)-64)>1||Math.abs(at(8,3)-102)>1)throw new Error('Outline toggle did not remove region borders');
    } finally {gl.deleteProgram(styling);}

  } finally {gl.deleteProgram(program);gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
