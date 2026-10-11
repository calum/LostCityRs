import struct,math,colorsys,sys
from PIL import Image,ImageDraw
def gs(d,p):
    if d[p]<0x80: return d[p]-0x40,p+1
    return struct.unpack('>H',d[p:p+2])[0]-0xc000,p+2
def load(path):
    d=open(path,'rb').read()
    nv,nf,nt,rt,pr,al,fl,vl,lx,ly,lz,lf=struct.unpack('>HHBBBBBBHHHH',d[-18:])
    pos=0;vo=0;pos+=nv;fo=pos;pos+=nf
    if pr==255: pos+=nf
    if fl==1: pos+=nf
    if rt==1: pos+=nf
    if vl==1: pos+=nv
    if al==1: pos+=nf
    fio=pos;pos+=lf;fc=pos;pos+=nf*2+nt*6
    xo=pos;pos+=lx;yo=pos;pos+=ly;zo=pos
    V=[];x=y=z=0;px,py,pz=xo,yo,zo
    for v in range(nv):
        o=d[vo+v]
        if o&1:dx,px=gs(d,px)
        else:dx=0
        if o&2:dy,py=gs(d,py)
        else:dy=0
        if o&4:dz,pz=gs(d,pz)
        else:dz=0
        x+=dx;y+=dy;z+=dz;V.append((x,y,z))
    F=[];a=b=c=last=0;p=fio
    for f in range(nf):
        o=d[fo+f]
        if o==1:
            t,p=gs(d,p);a=t+last
            t,p=gs(d,p);b=t+a
            t,p=gs(d,p);c=t+b;last=c
        elif o==2:
            b=c;t,p=gs(d,p);c=t+last;last=c
        elif o==3:
            a=c;t,p=gs(d,p);c=t+last;last=c
        elif o==4:
            a,b=b,a;t,p=gs(d,p);c=t+last;last=c
        F.append((a,b,c))
    cols=list(struct.unpack('>%dH'%nf,d[fc:fc+2*nf]))
    return V,F,cols
def rgb(c):
    h=(c>>10)/64+0.0078;s=((c>>7)&7)/8+0.0625;l=(c&127)/128
    r,g,b=colorsys.hls_to_rgb(h,l,s);return (r,g,b)
def render(path,recol=(),xan=0,yan=0,zoom=1000,xof=0,yof=0,size=128):
    V,F,cols=load(path)
    cols=[dict(recol).get(c,c) for c in cols]
    ay=yan*2*math.pi/2048;ax=xan*2*math.pi/2048
    P=[]
    for x,y,z in V:
        # y up is negative in RS; rotate
        x1=x*math.cos(ay)+z*math.sin(ay);z1=-x*math.sin(ay)+z*math.cos(ay)
        y1=y*math.cos(ax)-z1*math.sin(ax);z2=y*math.sin(ax)+z1*math.cos(ax)
        P.append((x1,y1,z2))
    xs=[q[0] for q in P];ys=[q[1] for q in P]
    cx=(max(xs)+min(xs))/2;cy=(max(ys)+min(ys))/2
    S=size*0.85/max(max(xs)-min(xs),max(ys)-min(ys),1)
    img=Image.new('RGBA',(size,size),(60,50,40,255));dr=ImageDraw.Draw(img)
    order=sorted(range(len(F)),key=lambda i:-sum(P[v][2] for v in F[i]))
    for i in order:
        a,b,c=[P[v] for v in F[i]]
        ux,uy,uz=b[0]-a[0],b[1]-a[1],b[2]-a[2];wx,wy,wz=c[0]-a[0],c[1]-a[1],c[2]-a[2]
        n=(uy*wz-uz*wy,uz*wx-ux*wz,ux*wy-uy*wx);m=math.sqrt(sum(k*k for k in n)) or 1
        if n[2]/m>0.0 and False: continue
        lit=0.55+0.45*abs(n[0]*-0.4/m+n[1]*-0.6/m+n[2]*-0.7/m)
        r,g,bb=rgb(cols[i]);col=tuple(int(min(255,k*lit*255)) for k in (r,g,bb))
        pts=[(size/2+(q[0]-cx)*S, size/2+(q[1]-cy)*S) for q in (a,b,c)]
        dr.polygon(pts,fill=col)
    return img
