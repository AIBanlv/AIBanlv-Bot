param([Parameter(Mandatory=$true)][string[]]$Handles)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowTaskbarProperties {
    [StructLayout(LayoutKind.Sequential)] public struct Key { public Guid format; public uint id; }
    [StructLayout(LayoutKind.Explicit, Size=24)] public struct Value {
        [FieldOffset(0)] public ushort type;
        [FieldOffset(8)] public IntPtr text;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface Store {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out Key key);
        [PreserveSig] int GetValue(ref Key key, out Value value);
        [PreserveSig] int SetValue(ref Key key, ref Value value);
        [PreserveSig] int Commit();
    }
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, out Store store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
    public static string Read(long handle, uint id) {
        var iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        Store store;
        Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(new IntPtr(handle), ref iid, out store));
        try {
            var key = new Key { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = id };
            Value value;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
            try { return value.type == 31 ? Marshal.PtrToStringUni(value.text) : null; }
            finally { PropVariantClear(ref value); }
        } finally { Marshal.ReleaseComObject(store); }
    }
}
'@
@(($Handles -split ',') | ForEach-Object {
    $windowHandle = [long]$_
    [ordered]@{
        appId = [WindowTaskbarProperties]::Read($windowHandle, 5)
        command = [WindowTaskbarProperties]::Read($windowHandle, 2)
        icon = [WindowTaskbarProperties]::Read($windowHandle, 3)
        displayName = [WindowTaskbarProperties]::Read($windowHandle, 4)
    }
}) | ConvertTo-Json -Compress
