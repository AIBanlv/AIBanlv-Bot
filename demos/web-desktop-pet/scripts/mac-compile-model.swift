import Foundation
import CoreML

let source = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
let compiled = try MLModel.compileModel(at: source)
defer { try? FileManager.default.removeItem(at: compiled) }
try FileManager.default.copyItem(at: compiled, to: destination)
print(destination.path)
