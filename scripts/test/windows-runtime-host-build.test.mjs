import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRuntimeHostBuild, verifyRuntimeHostPe } from "../build-windows-runtime-host.mjs";

test("Windows builds both supported architectures with the matching MSVC target", () => {
  assert.deepEqual(resolveRuntimeHostBuild("x64", "win32").configureArgs, [
    "-G",
    "Visual Studio 17 2022",
    "-A",
    "x64",
  ]);
  assert.deepEqual(resolveRuntimeHostBuild("arm64", "win32").configureArgs, [
    "-G",
    "Visual Studio 17 2022",
    "-A",
    "ARM64",
  ]);
  assert.throws(() => resolveRuntimeHostBuild("ia32", "win32"), /architecture/);
});
test("newer Visual Studio installs can override the CMake generator", () => {
  // 默认仍是 VS 2022（CI 基线）；只有装了更新 VS 的机器才需要覆盖生成器名。
  assert.deepEqual(
    resolveRuntimeHostBuild("x64", "win32", undefined, "Visual Studio 18 2026").configureArgs,
    ["-G", "Visual Studio 18 2026", "-A", "x64"],
  );
  assert.deepEqual(resolveRuntimeHostBuild("x64", "win32", undefined, "  ").configureArgs, [
    "-G",
    "Visual Studio 17 2022",
    "-A",
    "x64",
  ]);
});

test("cross builds explicitly select a Windows compiler", () => {
  assert.ok(
    resolveRuntimeHostBuild("x64", "linux").configureArgs.includes("-DCMAKE_SYSTEM_NAME=Windows"),
  );
  assert.ok(
    resolveRuntimeHostBuild("arm64", "linux", "example-clang++").configureArgs.includes(
      "-DCMAKE_CXX_COMPILER=example-clang++",
    ),
  );
});
test("packaging rejects wrong-architecture and corrupt PE binaries", () => {
  const bytes = Buffer.alloc(128);
  bytes.write("MZ");
  bytes.writeUInt32LE(64, 60);
  bytes.write("PE\0\0", 64);
  bytes.writeUInt16LE(0x8664, 68);
  verifyRuntimeHostPe(bytes, "x64");
  assert.throws(() => verifyRuntimeHostPe(bytes, "arm64"), /architecture/);
  assert.throws(() => verifyRuntimeHostPe(Buffer.from("bad"), "x64"), /PE/);
});
