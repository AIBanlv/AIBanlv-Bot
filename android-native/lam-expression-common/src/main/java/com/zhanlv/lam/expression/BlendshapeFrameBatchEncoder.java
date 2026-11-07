package com.zhanlv.lam.expression;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.List;

/** Encodes model-order ARKit frames for the renderer's 52-channel batch bridge. */
public final class BlendshapeFrameBatchEncoder {
    private BlendshapeFrameBatchEncoder() {}

    public static byte[] encode(List<float[]> modelOrderFrames) {
        if (modelOrderFrames == null || modelOrderFrames.isEmpty()) return new byte[0];
        ByteBuffer buffer = ByteBuffer.allocate(
                modelOrderFrames.size() * ArkitChannels.count() * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);
        for (float[] frame : modelOrderFrames) {
            if (frame == null || frame.length != ArkitChannels.count()) {
                throw new IllegalArgumentException("Expected one 52-value ARKit frame");
            }
            for (int rendererIndex = 0; rendererIndex < ArkitChannels.count(); rendererIndex++) {
                buffer.putFloat(frame[ArkitChannels.modelIndexAtRendererIndex(rendererIndex)]);
            }
        }
        return buffer.array();
    }
}
