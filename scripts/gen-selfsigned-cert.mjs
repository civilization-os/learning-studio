#!/usr/bin/env node
// 重新生成自签 HTTPS 证书。
// 仓库默认已带一份(CN=learning-studio,有效期 825 天),通常无需执行;
// 需要更换有效期、或把局域网 IP 加进证书 SAN 时使用本脚本。
//
// 用法:
//   node scripts/gen-selfsigned-cert.mjs
//   node scripts/gen-selfsigned-cert.mjs --ip 192.168.1.9
//   node scripts/gen-selfsigned-cert.mjs --ip 192.168.1.9 --days 365
//
// 生成位置:deploy/certs/{cert.pem,key.pem},compose 会挂载给 nginx。
// 注意:自签证书不会被浏览器自动信任,需在访问设备上导入 cert.pem。
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const certDir = join(root, "deploy", "certs");
mkdirSync(certDir, { recursive: true });

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const days = argValue("--days") ?? "825";
const extraIps = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ip" && args[i + 1]) extraIps.push(args[i + 1]);
}

const san = ["DNS:localhost", "IP:127.0.0.1", ...extraIps.map((ip) => `IP:${ip}`)].join(",");

const result = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    days,
    "-keyout",
    join(certDir, "key.pem"),
    "-out",
    join(certDir, "cert.pem"),
    "-subj",
    "/CN=learning-studio",
    "-addext",
    `subjectAltName=${san}`,
  ],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  console.error(
    "\n证书生成失败:请确认已安装 openssl(Git for Windows / Linux / macOS 自带;Windows 控制台找不到时,在 Git Bash 里运行本脚本)",
  );
  process.exit(1);
}

console.log(`\n已生成自签证书:${join(certDir, "cert.pem")}`);
console.log(`SAN: ${san}`);
console.log("浏览器访问 https 时会提示不受信任——正常现象;");
console.log("在访问设备上导入 cert.pem 到“受信任的根证书颁发机构”后不再提示。");
