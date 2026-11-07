package com.zhanlv.lam.expression;

/** Channel order at the model output and at the WebView batch boundary. */
public final class ArkitChannels {
    private static final String[] MODEL_NAMES = {
            "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft",
            "browOuterUpRight", "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
            "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
            "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
            "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
            "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft",
            "jawOpen", "jawRight", "mouthClose", "mouthDimpleLeft",
            "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
            "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
            "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower",
            "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
            "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft",
            "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight", "tongueOut"
    };
    private static final String[] RENDERER_NAMES = {
            "eyeBlinkLeft", "eyeLookDownLeft", "eyeLookInLeft", "eyeLookOutLeft",
            "eyeLookUpLeft", "eyeSquintLeft", "eyeWideLeft", "eyeBlinkRight",
            "eyeLookDownRight", "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight",
            "eyeSquintRight", "eyeWideRight", "jawForward", "jawLeft", "jawRight",
            "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthLeft",
            "mouthRight", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft",
            "mouthFrownRight", "mouthDimpleLeft", "mouthDimpleRight", "mouthStretchLeft",
            "mouthStretchRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower",
            "mouthShrugUpper", "mouthPressLeft", "mouthPressRight", "mouthLowerDownLeft",
            "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight", "browDownLeft",
            "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
            "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft",
            "noseSneerRight", "tongueOut"
    };
    private static final int[] MODEL_INDEX_BY_RENDERER_INDEX = buildMapping();

    private ArkitChannels() {}

    public static int count() { return MODEL_NAMES.length; }

    public static String nameAt(int modelIndex) { return MODEL_NAMES[modelIndex]; }

    public static String[] modelNames() { return MODEL_NAMES.clone(); }

    public static int indexOf(String name) {
        if (name == null) return -1;
        for (int index = 0; index < MODEL_NAMES.length; index++) {
            if (MODEL_NAMES[index].equalsIgnoreCase(name)) return index;
        }
        return -1;
    }

    public static int rendererIndexOf(String name) {
        if (name == null) return -1;
        for (int index = 0; index < RENDERER_NAMES.length; index++) {
            if (RENDERER_NAMES[index].equalsIgnoreCase(name)) return index;
        }
        return -1;
    }

    public static int modelIndexAtRendererIndex(int rendererIndex) {
        return MODEL_INDEX_BY_RENDERER_INDEX[rendererIndex];
    }

    private static int[] buildMapping() {
        if (MODEL_NAMES.length != 52 || RENDERER_NAMES.length != MODEL_NAMES.length) {
            throw new IllegalStateException("Expected 52 ARKit channels in both orders");
        }
        int[] mapping = new int[RENDERER_NAMES.length];
        boolean[] seen = new boolean[MODEL_NAMES.length];
        for (int rendererIndex = 0; rendererIndex < mapping.length; rendererIndex++) {
            int modelIndex = indexOf(RENDERER_NAMES[rendererIndex]);
            if (modelIndex < 0 || seen[modelIndex]) {
                throw new IllegalStateException("Missing or repeated renderer channel: "
                        + RENDERER_NAMES[rendererIndex]);
            }
            seen[modelIndex] = true;
            mapping[rendererIndex] = modelIndex;
        }
        return mapping;
    }
}
