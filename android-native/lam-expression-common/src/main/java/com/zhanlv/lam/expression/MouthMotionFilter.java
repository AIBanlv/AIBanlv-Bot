package com.zhanlv.lam.expression;

import java.util.ArrayList;
import java.util.List;

/** Renderer-order mouth only. Audio clocks are never delayed or rescaled. */
public final class MouthMotionFilter {
    private float[] previousModel, presented;
    private final float[] velocity = new float[52];
    private int catchUp;

    public void resetModelTimeline() { previousModel = null; }

    public List<float[]> stabilizeModels(List<float[]> frames) {
        List<float[]> result = new ArrayList<>(frames.size());
        if (frames.isEmpty()) return result;
        float[] boundary = previousModel == null ? frames.get(0) : previousModel;
        List<float[]> cleaned=new ArrayList<>();
        for(int f=0;f<frames.size();f++) {
            float[] row=frames.get(f).clone();
            if(f+1<frames.size())for(int i=0;i<52;i++)if(mouth(i)) {
                float a=safe((f==0?boundary:frames.get(f-1))[i]),b=safe(row[i]),c=safe(frames.get(f+1)[i]);
                if(b-Math.max(a,c)>.28f&&Math.abs(a-c)<.12f)row[i]=(a+c)*.5f;
            }
            cleaned.add(row);
        }
        float[] output = boundary;
        for (int f = 0; f < frames.size(); f++) {
            float[] current = cleaned.get(f), before = f == 0 ? boundary : cleaned.get(f-1);
            float[] after = f+1 < frames.size() ? cleaned.get(f+1) : current;
            float[] filtered = current.clone();
            for (int i=0;i<52;i++) if (mouth(i)) {
                float a=safe(before[i]), b=safe(current[i]), c=safe(after[i]);
                if(f+1<frames.size() && b-Math.max(a,c)>.28f && Math.abs(a-c)<.12f) b=(a+c)*.5f;
                float target=a*.20f+b*.60f+c*.20f;
                filtered[i]=output[i]+clamp(target-output[i],-(i==17?.13f:corner(i)?.065f:.12f),i==17?.16f:corner(i)?.075f:.14f);
            }
            result.add(filtered);output=filtered;
        }
        previousModel=output.clone();return result;
    }

    /** Call once per visible sample, never once per skipped hardware-clock slot. */
    public float[] present(float[] frame, int advance) {
        float[] result=frame.clone();
        if(presented==null)presented=new float[52];
        if(advance>1)catchUp=Math.max(catchUp,Math.min(4,advance-1));
        float gain=1+catchUp*.045f;
        if(catchUp>0)catchUp--;
        for(int i=0;i<52;i++)if(mouth(i)) {
            float target=calibrated(frame[i],i),delta=target-presented[i];
            float rise=i==17?.095f:corner(i)?.065f:(i>=37&&i<=40)?.11f:.14f;
            float accel=i==17?.035f:corner(i)?.025f:.05f;
            float fall=i==17?.13f:corner(i)?.085f:(i>=37&&i<=40)?.16f:.12f;
            if(delta>0){float step=Math.min(delta,Math.min(rise*gain,velocity[i]+accel*gain));result[i]=presented[i]+step;velocity[i]=step;}
            else {result[i]=presented[i]+Math.max(delta,-fall*gain);velocity[i]=0;}
        }
        presented=result.clone();return result;
    }

    public float[] hold(float[] frame) {
        float[] result=frame.clone();
        if(presented!=null)for(int i=0;i<52;i++)if(mouth(i))result[i]=presented[i];
        return result;
    }
    public void adopt(float[] frame) {
        presented=frame.clone();java.util.Arrays.fill(velocity,0);catchUp=0;
    }
    private static boolean mouth(int i){return (i>=14&&i<=40)||i==51;}
    private static boolean corner(int i){return i==23||i==24||i==29||i==30;}
    private static float safe(float v){return Float.isFinite(v)?clamp(v,0,1):0;}
    private static float calibrated(float v,int i){v=safe(v);return i==17?Math.min(.72f,v*.82f):(i==23||i==24)?Math.min(.50f,v*.68f):(i==29||i==30)?Math.min(.60f,v*.78f):v;}
    private static float clamp(float v,float lo,float hi){return Math.max(lo,Math.min(hi,v));}
}
