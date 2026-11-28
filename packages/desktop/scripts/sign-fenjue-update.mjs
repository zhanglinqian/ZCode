#!/usr/bin/env node
// Fen Jue 自更新发布物签名工具：对 mac 更新 zip 计算 sha512 并产 Ed25519 签名（.sig）。
// 私钥在发布方 ~/.workbuddy/secrets/fenjue-update-ed25519.md（不入仓库/服务器）；
// 对应公钥编进客户端 packages/desktop/src/main/macSelfUpdate.ts。
// 用法：node packages/desktop/scripts/sign-fenjue-update.mjs <更新zip路径> [私钥pem路径]
import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("usage: node sign-fenjue-update.mjs <update-zip> [private-key-pem]");
  process.exit(1);
}
const keyPath =
  process.argv[3] ?? resolve(homedir(), ".workbuddy/secrets/fenjue-update-ed25519.md");

const zipBytes = await readFile(zipPath);
const digest = createHash("sha512").update(zipBytes).digest("hex");

const keyMaterial = await readFile(keyPath, "utf8");
const pemMatch = keyMaterial.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/);
if (!pemMatch) {
  console.error(`no PKCS8 private key found in ${keyPath}`);
  process.exit(1);
}
const privateKey = createPrivateKey(pemMatch[0]);
// Ed25519 是纯消息签名（无预摘要），算法参数必须传 null；sha512 仅另行打印作记录校验。
const signature = cryptoSign(null, zipBytes, { key: privateKey });

const sigPath = `${zipPath}.sig`;
await writeFile(sigPath, signature.toString("base64"));
console.log(`zip: ${zipPath}`);
console.log(`sha512: ${digest}`);
console.log(`signature: ${sigPath} (${signature.length} bytes)`);
console.log(`# 发布时把 zip/.blockmap/.sig/latest-mac.yml 一起传到版本目录；`);
console.log(`# latest-mac.yml 内相对 url 改写为绝对 URL 后再传 current/macos-arm64/。`);
