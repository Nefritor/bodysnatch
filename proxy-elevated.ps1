# BodySnatch Desktop: privilegirovannyy pomoshchnik.
# Runs with elevation (UAC): enables/restores the system proxy or installs the CA.
# ASCII only on purpose: PowerShell 5.1 reads BOM-less files as ANSI.

param(
  [int]$Port = 8180,
  [string]$Mode = 'enable',       # enable | restore | cert
  [string]$Enabled = '0',
  [string]$Server = '',
  [string]$Override = '',
  [string]$CertFile = '',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Continue'

function Write-Log([string]$message) {
  if (-not $LogPath) { return }
  try {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Add-Content -LiteralPath $LogPath -Value ((Get-Date -Format 'HH:mm:ss.fff') + '  ' + $message) -Encoding UTF8
  } catch { }
}

$userKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$machineKey = 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings'
$overrideValue = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>'

function Repair-Key($hive, [string]$path) {
  try {
    $key = $hive.OpenSubKey($path, [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree, [System.Security.AccessControl.RegistryRights]::ChangePermissions)
    if (-not $key) { Write-Log ('acl ' + $path + ': key not opened'); return $false }
    $acl = $key.GetAccessControl()
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($me, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    $key.SetAccessControl($acl)
    $key.Close()
    Write-Log ('acl ' + $path + ': ok')
    return $true
  } catch {
    Write-Log ('acl ' + $path + ': ' + $_.Exception.Message)
    return $false
  }
}

function Add-RegValue([string]$key, [string]$name, [string]$type, [string]$value) {
  $out = & reg.exe add $key /v $name /t $type /d $value /f 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Log ('reg ' + $name + ': ' + (($out | Out-String).Trim() -replace '\r?\n', ' | '))
    return $false
  }
  Write-Log ('reg ' + $name + ': ok')
  return $true
}

function Remove-RegValue([string]$key, [string]$name) {
  $null = & reg.exe delete $key /v $name /f 2>&1
}

function Refresh-WinInet {
  try {
    $sig = '[DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);'
    Add-Type -Namespace Bs -Name WinInet -MemberDefinition $sig -ErrorAction SilentlyContinue | Out-Null
    [void][Bs.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
    [void][Bs.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)
  } catch { }
}

$admin = $false
try {
  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $admin = (New-Object System.Security.Principal.WindowsPrincipal($id)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { }

Write-Log ('start: user=' + $env:USERNAME + ', admin=' + $admin + ', mode=' + $Mode)

if ($Mode -eq 'enable') {
  # 1) if the key ACL is broken, try to repair it (needs elevation)
  Repair-Key ([Microsoft.Win32.Registry]::CurrentUser) 'Software\Microsoft\Windows\CurrentVersion\Internet Settings' | Out-Null
  Repair-Key ([Microsoft.Win32.Registry]::LocalMachine) 'SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings' | Out-Null

  # 2) write to HKCU
  $server = '127.0.0.1:' + $Port
  $userOk = (Add-RegValue $userKey 'ProxyEnable' 'REG_DWORD' '1') -and
            (Add-RegValue $userKey 'ProxyServer' 'REG_SZ' $server) -and
            (Add-RegValue $userKey 'ProxyOverride' 'REG_SZ' $overrideValue)

  # 3) if HKCU is locked, try machine-wide settings
  if (-not $userOk) {
    $machineOk = (Add-RegValue $machineKey 'ProxyEnable' 'REG_DWORD' '1') -and
                 (Add-RegValue $machineKey 'ProxyServer' 'REG_SZ' $server) -and
                 (Add-RegValue $machineKey 'ProxyOverride' 'REG_SZ' $overrideValue)
    if (-not $machineOk) {
      Write-Log 'failed: neither HKCU nor HKLM'
      exit 1
    }
  }

  Refresh-WinInet
  Write-Log 'enabled'
  exit 0
}

if ($Mode -eq 'restore') {
  Add-RegValue $userKey 'ProxyEnable' 'REG_DWORD' $Enabled | Out-Null
  if ($Server) { Add-RegValue $userKey 'ProxyServer' 'REG_SZ' $Server | Out-Null } else { Remove-RegValue $userKey 'ProxyServer' }
  if ($Override) { Add-RegValue $userKey 'ProxyOverride' 'REG_SZ' $Override | Out-Null } else { Remove-RegValue $userKey 'ProxyOverride' }

  # If HKLM was used (all-users policy), our address is still there - clear it too
  $machineRaw = (& reg.exe query $machineKey /v ProxyServer 2>$null | Out-String)
  if ($machineRaw -match '127\.0\.0\.1:') {
    Add-RegValue $machineKey 'ProxyEnable' 'REG_DWORD' '0' | Out-Null
    Remove-RegValue $machineKey 'ProxyServer'
    Remove-RegValue $machineKey 'ProxyOverride'
    Write-Log 'HKLM cleared'
  }

  Refresh-WinInet
  Write-Log ('restored: enabled=' + $Enabled)
  exit 0
}

if ($Mode -eq 'cert') {
  if (-not $CertFile -or -not (Test-Path -LiteralPath $CertFile)) {
    Write-Log ('cert: file not found: ' + $CertFile)
    exit 1
  }
  Write-Log ('cert: installing ' + $CertFile)

  # 1) machine-wide store: applies to all users and works even if UAC ran under
  #    another administrator account
  $out = & certutil.exe -addstore Root $CertFile 2>&1
  $code = $LASTEXITCODE
  Write-Log ('cert certutil machine exit=' + $code + ' ' + (($out | Out-String).Trim() -replace '\r?\n', ' | '))

  # 2) certutil, current user
  if ($code -ne 0) {
    $out = & certutil.exe -addstore -user Root $CertFile 2>&1
    $code = $LASTEXITCODE
    Write-Log ('cert certutil -user exit=' + $code + ' ' + (($out | Out-String).Trim() -replace '\r?\n', ' | '))
  }

  # 3) .NET API: sometimes works where certutil needs a window
  if ($code -ne 0) {
    try {
      $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertFile)
      $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $store.Add($c)
      $store.Close()
      $code = 0
      Write-Log 'cert X509Store machine: ok'
    } catch {
      Write-Log ('cert X509Store machine: ' + $_.Exception.Message)
      $code = 1
    }
  }

  if ($code -eq 0) {
    Write-Log 'cert: installed'
    exit 0
  }
  Write-Log 'cert: failed'
  exit 1
}

if ($Mode -eq 'certclean') {
  $removed = 0
  foreach ($loc in @('LocalMachine', 'CurrentUser')) {
    try {
      $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', $loc)
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $found = @($store.Certificates | Where-Object { $_.Subject -like '*BodySnatch*' })
      foreach ($c in $found) {
        try {
          $store.Remove($c)
          $removed = $removed + 1
          Write-Log ('certclean ' + $loc + ': removed ' + $c.Thumbprint)
        } catch {
          Write-Log ('certclean ' + $loc + ': remove failed ' + $_.Exception.Message)
        }
      }
      $store.Close()
    } catch {
      Write-Log ('certclean ' + $loc + ': ' + $_.Exception.Message)
    }
  }
  Write-Log ('certclean: removed ' + $removed)
  exit 0
}

exit 2
