package com.zhanlv.lam.expression;

/** Selected 61-channel capture. Never replaces locally inferred articulation. */
public final class RemoteMotionPlayer {
    private KeyframeFaceLibrary library;
    private KeyframeFaceLibrary.Clip clip;
    private double start;
    private String mode;
    private float[] lastFace;
    private IosExpressionProcessor.PoseV1 lastPose;
    private float[] entryFace;
    private IosExpressionProcessor.PoseV1 entryPose;
    private double lastAt=Double.NaN;
    public void install(KeyframeFaceLibrary next,String mode,double now) {
        entryFace=lastFace==null?null:lastFace.clone();entryPose=lastPose;
        library=next;clip=next.clips.get(0);this.mode=mode;start=now;
    }
    public void seed(IosExpressionProcessor.Output presented,double now){
        if(presented!=null){lastFace=presented.frame.clone();lastPose=presented.pose;lastAt=now;}
    }
    public void clear(){clip=null;library=null;lastFace=null;lastPose=null;entryFace=null;entryPose=null;lastAt=Double.NaN;}
    public IosExpressionProcessor.Output mix(IosExpressionProcessor.Output local,double now,String state) {
        if(clip==null || !state.equals(mode))return local;
        double t=Math.max(0,now-start),duration=(clip.frameCount()-1)/clip.fps;
        if(t>duration+.4){clear();return local;}
        if(lastFace==null){lastFace=local.frame.clone();lastPose=local.pose;}
        float dt=(float)(Double.isNaN(lastAt)?1.0/30:Math.min(.1,Math.max(0,now-lastAt)));lastAt=now;
        float phase=(float)Math.min(clip.frameCount()-1,t*clip.fps);
        int lo=(int)phase,hi=Math.min(clip.frameCount()-1,lo+1);float alpha=phase-lo;
        float[] a=clip.frames[lo],b=clip.frames[hi],face=local.frame.clone();
        int[] faceIndices=library.rendererIndices(),head=library.headIndices();
        float enter=smooth((float)(t/.55)),exit=(float)Math.min(1,Math.max(0,(duration+.4-t)/.4));
        for(int i=0;i<52;i++)if(!IosExpressionProcessor.isArticulation(i)) {
            float target=a[faceIndices[i]]+(b[faceIndices[i]]-a[faceIndices[i]])*alpha;
            float from=entryFace==null?local.frame[i]:entryFace[i];
            float blend=i==0||i==7?smooth((float)(t/.12)):enter;
            target=from+(target-from)*blend;
            target=local.frame[i]+(target-local.frame[i])*exit;
            float limit=(i==0||i==7?8.4f:1.8f)*dt;
            face[i]=lastFace[i]+clamp(target-lastFace[i],-limit,limit);
        }
        float[] pose=new float[3];
        float[] previous={lastPose.pitch,lastPose.yaw,lastPose.roll};
        float[] base={local.pose.pitch,local.pose.yaw,local.pose.roll};
        float[] entry=entryPose==null?base:new float[]{entryPose.pitch,entryPose.yaw,entryPose.roll};
        for(int i=0;i<3;i++) {
            float value=(a[head[i]]+(b[head[i]]-a[head[i]])*alpha)*.55f;
            float target=entry[i]+(value-entry[i])*enter;
            target=base[i]+(target-base[i])*exit;
            pose[i]=previous[i]+clamp(target-previous[i],-.9f*dt,.9f*dt);
        }
        lastFace=face;lastPose=new IosExpressionProcessor.PoseV1(pose[0],pose[1],pose[2],0,0,local.pose.depth,true);
        return new IosExpressionProcessor.Output(face,lastPose,state,clip.id);
    }
    private static float clamp(float v,float lo,float hi){return Math.max(lo,Math.min(hi,v));}
    private static float smooth(float v){float x=clamp(v,0,1);return x*x*(3-2*x);}
}
