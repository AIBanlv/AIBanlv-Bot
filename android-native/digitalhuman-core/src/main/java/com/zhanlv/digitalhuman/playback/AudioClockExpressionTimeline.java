package com.zhanlv.digitalhuman.playback;

import com.zhanlv.lam.expression.IosExpressionProcessor;
import com.zhanlv.lam.expression.MouthMotionFilter;
import com.zhanlv.lam.expression.RemoteMotionPlayer;
import com.zhanlv.lam.expression.KeyframeFaceLibrary;
import java.util.ArrayList;
import java.util.List;
import java.util.NavigableMap;
import java.util.TreeMap;

/** Hardware-clock adapter. All stored frames have already crossed the named order boundary. */
public final class AudioClockExpressionTimeline {
    private final IosExpressionProcessor processor;
    private final MouthMotionFilter mouth = new MouthMotionFilter();
    private final RemoteMotionPlayer remote = new RemoteMotionPlayer();
    private IosExpressionProcessor.Output displayed;
    private final NavigableMap<Integer, float[]> frames = new TreeMap<>();
    private final boolean pcmFallback;
    private final NavigableMap<Integer, Float> audioJaws = new TreeMap<>();
    private int envelopeIndex, envelopeSamples, fallbackFrameCount;
    private double envelopeEnergy;
    private float smoothedJaw;
    private String articulationSource = "held";
    private long generation = Long.MIN_VALUE, lastStarted = Long.MIN_VALUE;
    private long audioBaseMs, playbackStartMs, ambientBaseMs;
    private int nextIndex, sampledIndex = -1, ambientIndex = -1, audioFrames;
    private long presentationTick = -1;
    private long sampledAtMs,voiceUntilMs;
    private boolean microphoneEnabled=true;
    private boolean active, playing, ended, lateCurrent;
    private float[] held = new float[52];

    public AudioClockExpressionTimeline(IosExpressionProcessor processor) {
        this(processor, false);
    }

    public AudioClockExpressionTimeline(IosExpressionProcessor processor, boolean pcmFallback) {
        if (processor == null) throw new IllegalArgumentException("processor required");
        this.processor = processor;
        this.pcmFallback = pcmFallback;
    }

    public synchronized void begin(long nextGeneration, long nowMs) {
        if (nextGeneration < generation || nextGeneration <= lastStarted) return;
        generation = lastStarted = nextGeneration;
        frames.clear(); nextIndex = audioFrames = 0;
        audioSampleCount = 0;
        resetEnvelope();
        sampledIndex = -1; playing = ended = lateCurrent = false; active = true;
        held = new float[52];
        ambientBaseMs = nowMs; ambientIndex = -1;
        remote.clear();
        remote.seed(displayed,nowMs/1000.0);
        if(displayed!=null)processor.adoptPresented(displayed);
        processor.beginTurn(generation);
        mouth.resetModelTimeline();
    }

    public synchronized void setReply(long owner, String emotion, boolean explicit, String clip,
            String performance, String text, String head, String gaze, String depth) {
        if (accepts(owner)) processor.setReply(emotion, explicit, clip, performance, text, head, gaze, depth);
    }

    public synchronized void setListening(boolean active, String text, String emotion) {
        voiceUntilMs=active?sampledAtMs+3000:0;
        processor.setListening(active, text, emotion);
    }

    public synchronized void setListeningEnabled(boolean enabled) {
        microphoneEnabled=enabled;
        if(!enabled)processor.setListeningEnabled(false);
    }
    public synchronized void voiceOnset(float level,long nowMs) {
        if(!playing && level>.016f){voiceUntilMs=nowMs+2500;processor.setListeningEnabled(true);}
    }
    public synchronized void installRemote(KeyframeFaceLibrary library,String mode,long nowMs) {
        remote.seed(displayed,nowMs/1000.0);
        remote.install(library,mode,nowMs/1000.0);
    }
    private float touchX,touchY,touchYaw,touchPitch;
    private boolean touching;
    public synchronized void followTouch(float x,float y,boolean active) {
        touching=active;touchX=active?Math.max(-1,Math.min(1,x)):0;touchY=active?Math.max(-1,Math.min(1,y)):0;
    }
    private IosExpressionProcessor.Output composeVisible(IosExpressionProcessor.Output input,long nowMs) {
        IosExpressionProcessor.Output out=remote.mix(input,nowMs/1000.0,playing?"speaking":input.state);
        float weight=playing?.2f:1;
        touchYaw+=(touchX*.58f*weight-touchYaw)*.60f;
        touchPitch+=(touchY*.50f*weight-touchPitch)*.60f;
        if(!touching&&Math.abs(touchYaw)+Math.abs(touchPitch)<.002f)touchYaw=touchPitch=0;
        IosExpressionProcessor.PoseV1 p=out.pose;
        return new IosExpressionProcessor.Output(out.frame,new IosExpressionProcessor.PoseV1(
                p.pitch+touchPitch,p.yaw+touchYaw,p.roll,p.gazeX,p.gazeY,p.depth,true),out.state,out.clip);
    }

    public synchronized void addAudio(long owner, int samples16k) {
        if (accepts(owner) && samples16k > 0) {
            audioSampleCount += samples16k;
            audioFrames = (int) Math.min(Integer.MAX_VALUE, (audioSampleCount * 30 + 15999) / 16000);
        }
    }
    private long audioSampleCount;

    /** PCM and models use the same absolute 30 Hz slots; arrival never advances playback. */
    public synchronized void addAudio(long owner, byte[] pcm16k) {
        if (!accepts(owner) || pcm16k == null || pcm16k.length < 2) return;
        long start = audioSampleCount;
        addAudio(owner, pcm16k.length / 2);
        if (!pcmFallback) return;
        for (int offset = 0; offset + 1 < pcm16k.length; offset += 2) {
            short sample = (short) ((pcm16k[offset] & 255) | (pcm16k[offset + 1] << 8));
            double normalized = sample / 32768.0;
            envelopeEnergy += normalized * normalized;
            envelopeSamples++;
            long consumed = start + offset / 2 + 1;
            if (consumed >= (envelopeIndex + 1L) * 16000 / 30) finishEnvelopeFrame();
        }
    }

    private void finishEnvelopeFrame() {
        float rms = (float) Math.sqrt(envelopeEnergy / envelopeSamples);
        float jaw = Math.min(.35f, Math.max(0, (rms - .008f) * 2.5f));
        smoothedJaw += (jaw - smoothedJaw) * (jaw > smoothedJaw ? .65f : .45f);
        if (envelopeIndex >= sampledIndex - 1) audioJaws.put(envelopeIndex, smoothedJaw);
        envelopeIndex++;
        envelopeSamples = 0;
        envelopeEnergy = 0;
    }

    private void resetEnvelope() {
        audioJaws.clear();
        envelopeIndex = envelopeSamples = fallbackFrameCount = 0;
        envelopeEnergy = 0;
        smoothedJaw = 0;
        articulationSource = "held";
    }

    public synchronized void endInput(long owner) {
        if (accepts(owner)) {
            ended = true;
            if (pcmFallback && envelopeSamples > 0) finishEnvelopeFrame();
        }
    }

    public synchronized void enqueue(long owner, List<float[]> models, int skipped) {
        if (!accepts(owner) || models == null || models.isEmpty()) return;
        if (skipped < 0 || (long) nextIndex + skipped + models.size() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Invalid timeline range");
        }
        List<float[]> prepared = new ArrayList<>(models.size());
        for (float[] model : models) prepared.add(IosExpressionProcessor.prepareModelFrame(model));
        prepared = mouth.stabilizeModels(prepared);
        // Missing inference slots retain their absolute positions; never shift sound to fit data.
        nextIndex += skipped;
        for (float[] frame : prepared) {
            if (nextIndex >= sampledIndex - 1) frames.put(nextIndex, frame);
            nextIndex++;
        }
        if (audioSampleCount == 0) audioFrames = nextIndex;
        lateCurrent = frames.containsKey(sampledIndex);
    }

    public synchronized void startPlayback(long owner, long hardwareMs, long nowMs) {
        if (!accepts(owner) || playing) return;
        playing = true; audioBaseMs = hardwareMs; playbackStartMs = nowMs;
        sampledIndex = -1; presentationTick = -1;
    }

    public synchronized IosExpressionProcessor.Output sample(long nowMs, long hardwareMs) {
        sampledAtMs=nowMs;
        if (!playing) {
            processor.setListeningEnabled(microphoneEnabled && nowMs<voiceUntilMs);
            int target = (int) Math.max(0, (nowMs - ambientBaseMs) * 30 / 1000);
            while (ambientIndex < target) {
                ambientIndex++;
                processor.ambient((ambientBaseMs + ambientIndex * (1000.0 / 30)) / 1000);
            }
            displayed = composeVisible(processor.current(),nowMs);
            mouth.adopt(displayed.frame);
            return displayed;
        }
        // A reset/backward hardware sample freezes this generation; never substitute wall time.
        int previousIndex=sampledIndex;
        boolean refresh=lateCurrent;
        int target = (int) Math.max(sampledIndex, Math.max(0, hardwareMs - audioBaseMs) * 30 / 1000);
        long wallTick = Math.max(0, (nowMs - playbackStartMs) * 30 / 1000);
        while (sampledIndex < target) {
            sampledIndex++;
            float[] source = at(sampledIndex);
            if (source != null) held = source;
            // A delayed hardware read may catch up over already-presented gap slots.
            // Recompose their face, but never spend the same presentation time twice.
            long nextTick = sampledIndex == 0 ? 0
                    : Math.max(presentationTick, Math.max(0, wallTick - (target - sampledIndex)));
            // Replay missing presentation slots before changing the held phoneme.
            // AmbientMotion bounds dt, so jumping its timestamp would lose gap time.
            while (presentationTick + 1 < nextTick) {
                presentationTick++;
                processor.holdSpeech((playbackStartMs + presentationTick * (1000.0 / 30)) / 1000);
            }
            presentationTick = nextTick;
            processor.speech(held, sampledIndex, audioFrames, ended,
                    (playbackStartMs + presentationTick * (1000.0 / 30)) / 1000);
        }
        if (lateCurrent) {
            float[] source = at(sampledIndex);
            if (source != null) {
                held = source;
                processor.refreshArticulation(source);
            }
            lateCurrent = false;
        }
        while (presentationTick < wallTick) {
            presentationTick++;
            processor.holdSpeech((playbackStartMs + presentationTick * (1000.0 / 30)) / 1000);
        }
        discardBefore(sampledIndex - 1);
        IosExpressionProcessor.Output composed=composeVisible(processor.current(),nowMs);
        float[] face=target>previousIndex || refresh
                ?mouth.present(composed.frame,Math.max(1,target-previousIndex)):mouth.hold(composed.frame);
        displayed=new IosExpressionProcessor.Output(face,composed.pose,composed.state,composed.clip);
        return displayed;
    }

    private float[] at(int index) {
        float[] model = frames.get(index);
        if (model != null) {
            articulationSource = "model";
            return model;
        }
        Float jaw = audioJaws.get(index);
        if (jaw == null) {
            articulationSource = "held";
            return null;
        }
        // Inference can remain slower than sound indefinitely. Never replay an old
        // phoneme at a new time; use this audible slot's energy until its model is ready.
        float[] fallback = held.clone();
        for (int channel = 0; channel < fallback.length; channel++) {
            if (IosExpressionProcessor.isArticulation(channel)) fallback[channel] = 0;
        }
        fallback[17] = jaw;
        articulationSource = "pcm";
        fallbackFrameCount++;
        return fallback;
    }

    private void discardBefore(int index) {
        // Retain only unplayed data and one preceding sample. Never truncate a long
        // reply's unplayed beginning; skipped PCM ranges occupy no queue memory.
        frames.headMap(index, false).clear();
        audioJaws.headMap(index, false).clear();
    }

    public synchronized void complete(long owner, long nowMs, long hardwareMs) {
        if (!accepts(owner)) return;
        sample(nowMs, hardwareMs);
        if(displayed!=null)processor.adoptPresented(displayed);
        active = playing = false;
        frames.clear();
        processor.finish();
        ambientBaseMs = nowMs; ambientIndex = -1;
        audioSampleCount = 0;
        resetEnvelope();
    }

    public synchronized void invalidate(long nextGeneration, long nowMs) {
        if (nextGeneration < generation) return;
        generation = nextGeneration; active = playing = false;
        frames.clear(); nextIndex = 0;
        if(displayed!=null)processor.adoptPresented(displayed);
        processor.interrupt(); held = new float[52]; audioSampleCount = 0;
        resetEnvelope();
        remote.clear();followTouch(0,0,false);
        ambientBaseMs = nowMs; ambientIndex = -1;
    }

    public synchronized long generation() { return generation; }
    public synchronized int sampledIndex() { return sampledIndex; }
    public synchronized boolean isPlaying() { return playing; }
    public synchronized String articulationSource() { return articulationSource; }
    public synchronized int fallbackFrameCount() { return fallbackFrameCount; }
    public synchronized int nextModelIndex() { return nextIndex; }
    private boolean accepts(long owner) { return active && owner == generation; }
}
