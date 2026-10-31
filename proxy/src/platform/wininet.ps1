param(
    [ValidateSet('Read', 'Set', 'Restore')][string]$Action = 'Read',
    [string]$PacUrl = '',
    [int]$AutoEnabled = 0
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BodySnatchWinInet {
    [StructLayout(LayoutKind.Explicit)] public struct Value {
        [FieldOffset(0)] public uint Number;
        [FieldOffset(0)] public IntPtr Text;
        [FieldOffset(0)] public long Time;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Option { public uint Id; public Value Data; }
    [StructLayout(LayoutKind.Sequential)] public struct List {
        public uint Size; public IntPtr Connection; public uint Count; public uint Error; public IntPtr Options;
    }
    [DllImport("wininet.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool InternetQueryOptionW(IntPtr handle, uint option, ref List list, ref uint size);
    [DllImport("wininet.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool InternetSetOptionW(IntPtr handle, uint option, ref List list, uint size);
    [DllImport("wininet.dll", EntryPoint = "InternetSetOptionW", SetLastError = true)]
    static extern bool Notify(IntPtr handle, uint option, IntPtr buffer, uint size);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr pointer);
    public static object[] Read() {
        int n = Marshal.SizeOf(typeof(Option));
        IntPtr options = Marshal.AllocHGlobal(3 * n);
        try {
            for (int i = 0; i < 3; i++) Marshal.StructureToPtr(new Option { Id = (uint)(i == 0 ? 10 : i == 1 ? 4 : 2) }, IntPtr.Add(options, i * n), false);
            var list = new List { Size = (uint)Marshal.SizeOf(typeof(List)), Count = 3, Options = options };
            uint size = list.Size;
            if (!InternetQueryOptionW(IntPtr.Zero, 75, ref list, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            var flags = (Option)Marshal.PtrToStructure(options, typeof(Option));
            var pac = (Option)Marshal.PtrToStructure(IntPtr.Add(options, n), typeof(Option));
            var server = (Option)Marshal.PtrToStructure(IntPtr.Add(options, 2 * n), typeof(Option));
            try { return new object[] { flags.Data.Number, Marshal.PtrToStringUni(pac.Data.Text) ?? "", Marshal.PtrToStringUni(server.Data.Text) ?? "" }; }
            finally { GlobalFree(pac.Data.Text); GlobalFree(server.Data.Text); }
        } finally { Marshal.FreeHGlobal(options); }
    }
    public static void Set(string pacUrl, bool enabled) {
        uint flags = Convert.ToUInt32(Read()[0]);
        // Меняем только PAC; ручной прокси и автообнаружение сохраняются.
        flags = (flags & ~4u) | (enabled ? 4u : 0u);
        if ((flags & 14u) == 0) flags |= 1u;
        int n = Marshal.SizeOf(typeof(Option));
        IntPtr options = Marshal.AllocHGlobal(2 * n);
        IntPtr text = Marshal.StringToHGlobalUni(pacUrl);
        try {
            Marshal.StructureToPtr(new Option { Id = 1, Data = new Value { Number = flags } }, options, false);
            Marshal.StructureToPtr(new Option { Id = 4, Data = new Value { Text = text } }, IntPtr.Add(options, n), false);
            var list = new List { Size = (uint)Marshal.SizeOf(typeof(List)), Count = 2, Options = options };
            if (!InternetSetOptionW(IntPtr.Zero, 75, ref list, list.Size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!Notify(IntPtr.Zero, 39, IntPtr.Zero, 0) || !Notify(IntPtr.Zero, 37, IntPtr.Zero, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { Marshal.FreeHGlobal(text); Marshal.FreeHGlobal(options); }
    }
}
'@
if ($Action -eq 'Set') { [BodySnatchWinInet]::Set($PacUrl, $true) }
elseif ($Action -eq 'Restore') { [BodySnatchWinInet]::Set($PacUrl, ($AutoEnabled -eq 1)) }
$values = [BodySnatchWinInet]::Read()
$flags = [uint32]$values[0]
@{
    pacUrl = $(if (($flags -band 4) -ne 0) { $values[1] } else { '' })
    autoConfigUrl = $values[1]
    autoEnabled = (($flags -band 4) -ne 0)
    manual = @{ enabled = (($flags -band 2) -ne 0); server = $values[2] }
} | ConvertTo-Json -Compress
