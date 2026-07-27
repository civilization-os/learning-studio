import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const entropyLabel = "learning-companion-pwa:credentials:v1";
const linuxKeyVariable = "APP_ENCRYPTION_KEY";

export type SecretProtectionFormat =
  | "windows-dpapi-current-user-v1"
  | "aes-256-gcm-environment-key-v1";

export type SecretProtectionStatus =
  | "windows-dpapi-current-user"
  | "aes-256-gcm-environment-key"
  | "unavailable";

export type ProtectedSecret = {
  format: SecretProtectionFormat;
  value: string;
};

const protectScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$plainText = [Console]::In.ReadToEnd()
$plainBytes = [Text.Encoding]::UTF8.GetBytes($plainText)
$entropy = [Text.Encoding]::UTF8.GetBytes('${entropyLabel}')
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
`;

const unprotectScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$cipherText = [Console]::In.ReadToEnd()
$protectedBytes = [Convert]::FromBase64String($cipherText)
$entropy = [Text.Encoding]::UTF8.GetBytes('${entropyLabel}')
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $entropy,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))
`;

function runPowerShell(script: string, input: string): Promise<string> {
  if (process.platform !== "win32") {
    return Promise.reject(
      new Error("当前系统无法解密由 Windows DPAPI 保护的密钥"),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => {
      reject(new Error("无法启动 Windows 密钥保护服务"));
    });
    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          stderr.trim()
            ? `Windows 密钥保护失败：${stderr.trim()}`
            : "Windows 密钥保护失败",
        ),
      );
    });
    child.stdin.end(input, "utf8");
  });
}

function getLinuxEncryptionKey(): any | null {
  const rawKey = process.env[linuxKeyVariable]?.trim();
  if (!rawKey) return null;

  const key = /^[0-9a-f]{64}$/i.test(rawKey)
    ? Buffer.from(rawKey, "hex")
    : Buffer.from(rawKey, "base64");

  if (key.length !== 32) {
    throw new Error(
      `${linuxKeyVariable} 必须是 32 字节密钥（64 位十六进制或 Base64）`,
    );
  }
  return key;
}

function protectWithAes(secret: string): ProtectedSecret {
  const key = getLinuxEncryptionKey();
  if (!key) {
    throw new Error(
      `当前系统未配置 ${linuxKeyVariable}，无法安全持久化 API Key`,
    );
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(entropyLabel, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    format: "aes-256-gcm-environment-key-v1",
    value: [
      iv.toString("base64"),
      authTag.toString("base64"),
      encrypted.toString("base64"),
    ].join(":"),
  };
}

function unprotectWithAes(value: string): string {
  const key = getLinuxEncryptionKey();
  if (!key) {
    throw new Error(
      `缺少 ${linuxKeyVariable}，无法解密已保存的 API Key`,
    );
  }

  const parts = value.split(":");
  if (parts.length !== 3) {
    throw new Error("AES 密钥记录格式无效");
  }
  const [ivPart, authTagPart, encryptedPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(authTagPart, "base64");
  const encrypted = Buffer.from(encryptedPart, "base64");
  if (iv.length !== 12 || authTag.length !== 16 || encrypted.length === 0) {
    throw new Error("AES 密钥记录内容无效");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(entropyLabel, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

export function isSecretProtectionFormat(
  value: unknown,
): value is SecretProtectionFormat {
  return (
    value === "windows-dpapi-current-user-v1" ||
    value === "aes-256-gcm-environment-key-v1"
  );
}

export function getSecretProtectionStatus(): SecretProtectionStatus {
  if (process.platform === "win32") return "windows-dpapi-current-user";
  return getLinuxEncryptionKey()
    ? "aes-256-gcm-environment-key"
    : "unavailable";
}

export function canPersistSecrets(): boolean {
  return getSecretProtectionStatus() !== "unavailable";
}

export async function protectSecret(secret: string): Promise<ProtectedSecret> {
  if (process.platform === "win32") {
    return {
      format: "windows-dpapi-current-user-v1",
      value: await runPowerShell(protectScript, secret),
    };
  }
  return protectWithAes(secret);
}

export async function unprotectSecret(
  protectedSecret: ProtectedSecret,
): Promise<string> {
  if (protectedSecret.format === "windows-dpapi-current-user-v1") {
    return runPowerShell(unprotectScript, protectedSecret.value);
  }
  return unprotectWithAes(protectedSecret.value);
}
