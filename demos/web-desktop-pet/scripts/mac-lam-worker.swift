import Foundation
import CoreML

func emit(_ object: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
func invalid(_ reason: String) -> NSError { NSError(domain: reason, code: 1) }

// 24/16 kHz has two fractional phases; reuse the same band-limited kernels.
struct Resampler {
    let kernels: [[Double]] = (0..<2).map { phase in
        (-32...32).map { offset in
            let distance = Double(phase) * 0.5 - Double(offset)
            let x = distance * (2.0 / 3.0) * 0.99
            let sinc = abs(x) < 1e-12 ? 1.0 : sin(.pi * x) / (.pi * x)
            let window = abs(distance) <= 32 ? 0.5 + 0.5 * cos(.pi * distance / 32) : 0
            return sinc * window * (2.0 / 3.0) * 0.99
        }
    }
    func convert(_ data: Data) -> [Float] {
        let bytes = [UInt8](data)
        let pcm = stride(from: 0, to: bytes.count, by: 2).map {
            Float(Int16(bitPattern: UInt16(bytes[$0]) | UInt16(bytes[$0 + 1]) << 8)) / 32768
        }
        return (0..<34133).map { index in
            let center = index * 3 / 2, kernel = kernels[index % 2]
            var sum = 0.0
            for offset in -32...32 {
                let sample = center + offset
                if sample >= 0 && sample < pcm.count { sum += Double(pcm[sample]) * kernel[offset + 32] }
            }
            return Float(sum)
        }
    }
}

final class ModelRunner {
    let model: MLModel
    let input: MLMultiArray
    let provider: MLDictionaryFeatureProvider
    init(url: URL, backend: String) throws {
        let configuration = MLModelConfiguration()
        switch backend {
        case "cpuOnly": configuration.computeUnits = .cpuOnly
        case "cpuAndGPU": configuration.computeUnits = .cpuAndGPU
        case "cpuAndNeuralEngine": configuration.computeUnits = .cpuAndNeuralEngine
        case "all": configuration.computeUnits = .all
        default: throw invalid("Backend")
        }
        model = try MLModel(contentsOf: url, configuration: configuration)
        input = try MLMultiArray(shape: [1, 34133], dataType: .float32)
        provider = try MLDictionaryFeatureProvider(dictionary: ["audio": input])
    }
    func infer(_ audio: [Float]) throws -> [[Double]] {
        guard audio.count == 34133 else { throw invalid("InputShape") }
        let pointer = input.dataPointer.bindMemory(to: Float.self, capacity: 34133)
        audio.withUnsafeBufferPointer { pointer.update(from: $0.baseAddress!, count: audio.count) }
        return try autoreleasepool {
            let result = try model.prediction(from: provider)
            guard let output = result.featureValue(for: "expressions")?.multiArrayValue,
                  output.shape.map({ $0.intValue }) == [1, 30, 52] else { throw invalid("OutputShape") }
            let strides = output.strides.map { $0.intValue }
            let floats = output.dataPointer.assumingMemoryBound(to: Float.self)
            return try (0..<30).map { frame in
                try (0..<52).map { channel in
                    let value = output.dataType == .float32
                        ? Double(floats[frame * strides[1] + channel * strides[2]])
                        : output[[0, NSNumber(value: frame), NSNumber(value: channel)]].doubleValue
                    guard value.isFinite && value >= -0.0001 && value <= 1.0001 else { throw invalid("OutputValue") }
                    return min(1, max(0, value))
                }
            }
        }
    }
}

func probeAudio(_ index: Int) -> [Float] {
    (0..<34133).map { sample in
        let t = Double(sample) / 16000
        if index == 0 { return 0 }
        if index == 1 { return Float(sin(Double(sample) * 0.071) * 0.35) }
        return Float((sin(2 * .pi * (180 * t + 90 * t * t)) + sin(2 * .pi * 530 * t) * 0.4) * 0.2)
    }
}

do {
    let arguments = CommandLine.arguments
    guard arguments.count >= 3 else { throw invalid("Arguments") }
    let url = URL(fileURLWithPath: arguments[1])
    let names = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: arguments[2]))) as! [String]
    var backend = "cpuOnly"
    if let option = arguments.firstIndex(of: "--backend") {
        guard option + 1 < arguments.count else { throw invalid("Arguments") }
        backend = arguments[option + 1]
    }
    let start = ProcessInfo.processInfo.systemUptime
    let runner = try ModelRunner(url: url, backend: backend)
    let silent = try runner.infer(probeAudio(0))
    let voiced = try runner.infer(probeAudio(1))
    let difference = zip(silent.flatMap { $0 }, voiced.flatMap { $0 }).map { abs($0 - $1) }.max() ?? 0
    guard difference > 0.0001 else { throw invalid("FrozenOutput") }
    if arguments.contains("--probe") {
        var probes: [[[Double]]] = [], timings: [Double] = []
        for index in 0..<3 {
            let tick = ProcessInfo.processInfo.systemUptime
            probes.append(try runner.infer(probeAudio(index)))
            timings.append((ProcessInfo.processInfo.systemUptime - tick) * 1000)
        }
        try emit(["backend": backend, "healthy": true, "probes": probes,
                  "medianMs": timings.sorted()[1], "startupMs": (ProcessInfo.processInfo.systemUptime - start) * 1000])
        exit(0)
    }
    let resampler = Resampler()
    try emit(["type": "ready", "engine": "coreml-ios", "fps": 30, "names": names, "backend": backend])
    while let line = readLine() {
        var id: Any = NSNull()
        do {
            guard line.utf8.count <= 160000,
                  let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                  Set(request.keys) == Set(["id", "pcm"]), let requestID = request["id"] as? NSNumber,
                  CFGetTypeID(requestID) != CFBooleanGetTypeID(), requestID.doubleValue > 0,
                  requestID.doubleValue <= 9007199254740991, requestID.doubleValue.rounded() == requestID.doubleValue,
                  let base64 = request["pcm"] as? String,
                  let data = Data(base64Encoded: base64), data.count == 102400 else { throw invalid("Input") }
            id = requestID
            let tick = ProcessInfo.processInfo.systemUptime
            let frames = try runner.infer(resampler.convert(data))
            try emit(["id": id, "frames": frames, "inferenceMs": (ProcessInfo.processInfo.systemUptime - tick) * 1000])
        } catch { try emit(["id": id, "error": "INFERENCE_FAILED"]) }
    }
} catch {
    FileHandle.standardError.write(Data("Core ML worker failed: \((error as NSError).domain)\n".utf8))
    exit(1)
}
