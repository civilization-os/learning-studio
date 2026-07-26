import { spawn } from "node:child_process";

const entropyLabel = "learning-companion-pwa:credentials:v1";

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
      new Error("当前系统不支持 Windows DPAPI，无法安全持久化 API Key"),
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

export async function protectSecret(secret: string): Promise<string> {
  return runPowerShell(protectScript, secret);
}

export async function unprotectSecret(cipherText: string): Promise<string> {
  return runPowerShell(unprotectScript, cipherText);
}
