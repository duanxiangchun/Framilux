#!/usr/bin/env node
/**
 * 拉取 Web 原型运行所需的本地资源。
 *
 * 为什么要这一步：AGENTS.md 的离线红线要求**运行时**不得访问网络，
 * 所以 MediaPipe 的 wasm 运行时与 .task 模型必须落在 public/ 里由本地服务提供。
 * 这些文件体积大、不入 git（见 .gitignore），clone 后跑一次即可：
 *
 *   pnpm assets          # 缺什么补什么
 *   pnpm assets --force  # 全部重新拉
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = join(root, "public", "mediapipe", "wasm");
const modelsDst = join(root, "public", "models");
const force = process.argv.includes("--force");

/** MediaPipe 官方模型库（Apache-2.0）。来源见 models/manifest.json 的 mediapipe_tasks 条目 */
const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    minBytes: 3_000_000,
    note: "人脸 478 关键点 + 模糊/变换矩阵",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    minBytes: 4_000_000,
    note: "人体 33 关键点（COCO 17 点子集可映射）",
  },
];

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function copyWasm() {
  let names;
  try {
    names = await readdir(wasmSrc);
  } catch {
    console.error("✗ 找不到 " + wasmSrc);
    console.error("  先跑 pnpm install（@mediapipe/tasks-vision 会带上 wasm 运行时）");
    process.exitCode = 1;
    return [];
  }
  await mkdir(wasmDst, { recursive: true });
  const copied = [];
  for (const name of names) {
    const dst = join(wasmDst, name);
    if (!force && (await sizeOf(dst)) > 0) continue;
    await copyFile(join(wasmSrc, name), dst);
    copied.push(name);
  }
  console.log(`wasm 运行时：${copied.length} 个文件复制到 public/mediapipe/wasm/（共 ${names.length} 个）`);
  return names;
}

async function download(model) {
  const dst = join(modelsDst, model.file);
  const existing = await sizeOf(dst);
  if (!force && existing >= model.minBytes) {
    console.log(`跳过 ${model.file}（已存在 ${mb(existing)}）`);
    return null;
  }

  process.stdout.write(`下载 ${model.file} … `);
  const res = await fetch(model.url);
  if (!res.ok || !res.body) {
    console.error(`\n✗ HTTP ${res.status} — ${model.url}`);
    process.exitCode = 1;
    return null;
  }
  await mkdir(modelsDst, { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
  const got = await sizeOf(dst);
  if (got < model.minBytes) {
    console.error(`\n✗ 文件偏小（${mb(got)}），可能是错误页而非模型`);
    process.exitCode = 1;
    return null;
  }
  console.log(mb(got));
  return { file: model.file, size: got, sha256: await sha256(dst), note: model.note };
}

const names = await copyWasm();
const hashes = [];
for (const model of MODELS) {
  const info = await download(model);
  if (info) hashes.push(info);
}

if (hashes.length > 0) {
  const lines = [
    "# Web 原型本地模型资源（由 scripts/fetch-assets.mjs 生成，不入 git）",
    "# 用于人工核对权重是否被替换；Android 侧以 models/lock.json 为准",
    "",
    ...hashes.map((h) => `${h.sha256}  ${h.file}  ${mb(h.size)}  ${h.note}`),
  ];
  await writeFile(join(modelsDst, "CHECKSUMS.txt"), lines.join("\n") + "\n", "utf8");
  console.log("\n本次新下载的校验和已写入 public/models/CHECKSUMS.txt");
}

console.log("\n完成。wasm " + names.length + " 个文件，模型 " + MODELS.length + " 个。");
if (process.exitCode) console.error("\n有失败项，请检查网络/代理后重试。");
