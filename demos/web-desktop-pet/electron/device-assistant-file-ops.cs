using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Handle-based, non-replacing moves. Parent handles exclude write/delete sharing
// so a validated directory cannot become a junction while an operation is running.
public static class AssistantFileOps
{
    [StructLayout(LayoutKind.Sequential)]
    struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)]
    struct FileInfo
    {
        public uint Attributes;
        public FileTime Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder name, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, IntPtr data, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateDirectoryW(string name, IntPtr security);

    static Exception Error() { return new Win32Exception(Marshal.GetLastWin32Error()); }
    static string Full(string value)
    {
        string result = Path.GetFullPath(value).TrimEnd('\\');
        if (result.StartsWith(@"\\") || result.Length < 3) throw new IOException("Local path required");
        return result;
    }
    static FileInfo Information(SafeFileHandle handle)
    {
        FileInfo info;
        if (!GetFileInformationByHandle(handle, out info)) throw Error();
        return info;
    }
    static SafeFileHandle Open(string file, bool directory, bool deleting)
    {
        var handle = CreateFileW(file, 0x80u | (deleting ? 0x10000u : 0u), 1,
            IntPtr.Zero, 3, 0x200000u | (directory ? 0x2000000u : 0u), IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw Error(); }
        try
        {
            var info = Information(handle);
            if ((info.Attributes & 0x400) != 0 || ((info.Attributes & 0x10) != 0) != directory)
                throw new IOException("Unexpected file type");
            var final = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandleW(handle, final, (uint)final.Capacity, 0);
            if (length == 0 || length >= final.Capacity) throw Error();
            string resolved = final.ToString();
            if (resolved.StartsWith(@"\\?\")) resolved = resolved.Substring(4);
            if (!String.Equals(Full(resolved), Full(file), StringComparison.OrdinalIgnoreCase))
                throw new IOException("Redirected path");
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    static void Parents(string root, string file, List<SafeFileHandle> handles)
    {
        root = Full(root);
        file = Full(file);
        if (!file.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase))
            throw new IOException("Outside desktop");
        handles.Add(Open(root, true, false));
        string relative = Path.GetDirectoryName(file).Substring(root.Length).TrimStart('\\');
        string parent = root;
        foreach (string name in relative.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
        {
            parent = Path.Combine(parent, name);
            handles.Add(Open(parent, true, false));
        }
    }
    public static void Move(string root, string source, string target,
        string dev, string ino, string size, string mtime)
    {
        var parents = new List<SafeFileHandle>();
        try
        {
            Parents(root, source, parents);
            Parents(root, target, parents);
            using (var file = Open(source, false, true))
            {
                var info = Information(file);
                if ((info.Attributes & 6) != 0) throw new IOException("Hidden or system file");
                ulong index = ((ulong)info.IndexHigh << 32) | info.IndexLow;
                ulong length = ((ulong)info.SizeHigh << 32) | info.SizeLow;
                long write = (long)(((ulong)info.Write.High << 32) | info.Write.Low);
                long nanos = checked((write - 116444736000000000L) * 100L);
                if (!String.IsNullOrEmpty(dev) && (info.Volume.ToString() != dev || index.ToString() != ino ||
                    length.ToString() != size || nanos.ToString() != mtime))
                    throw new IOException("File identity changed");
                byte[] name = Encoding.Unicode.GetBytes(Full(target));
                int nameOffset = IntPtr.Size == 8 ? 20 : 12;
                int bytes = nameOffset + name.Length + 2;
                IntPtr buffer = Marshal.AllocHGlobal(bytes);
                try
                {
                    Marshal.Copy(new byte[bytes], 0, buffer, bytes);
                    Marshal.WriteInt32(buffer, nameOffset - 4, name.Length);
                    Marshal.Copy(name, 0, IntPtr.Add(buffer, nameOffset), name.Length);
                    // FILE_RENAME_INFO: ReplaceIfExists=false, RootDirectory=NULL.
                    if (!SetFileInformationByHandle(file, 3, buffer, (uint)bytes)) throw Error();
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
        }
        finally { foreach (var handle in parents) handle.Dispose(); }
    }
    public static void Prepare(string root, string directory, string[] categories)
    {
        var parents = new List<SafeFileHandle>();
        try
        {
            root = Full(root);
            directory = Full(directory);
            if (!String.Equals(Path.GetDirectoryName(directory), root, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Invalid desktop folder");
            Parents(root, directory, parents);
            if (!CreateDirectoryW(directory, IntPtr.Zero)) throw Error();
            parents.Add(Open(directory, true, false));
            foreach (string category in categories)
            {
                if (category != "Documents" && category != "Images" && category != "Audio" &&
                    category != "Video" && category != "Archives") throw new IOException("Invalid category");
                string child = Path.Combine(directory, category);
                if (!CreateDirectoryW(child, IntPtr.Zero)) throw Error();
                parents.Add(Open(child, true, false));
            }
        }
        finally { foreach (var handle in parents) handle.Dispose(); }
    }
    public static bool RemoveEmpty(string root, string directory)
    {
        var parents = new List<SafeFileHandle>();
        try
        {
            Parents(root, directory, parents);
            using (var file = Open(directory, true, true))
            {
                IntPtr buffer = Marshal.AllocHGlobal(4);
                try
                {
                    Marshal.WriteInt32(buffer, 1);
                    if (SetFileInformationByHandle(file, 4, buffer, 4)) return true;
                    int error = Marshal.GetLastWin32Error();
                    if (error == 145) return false; // Directory is not empty.
                    throw new Win32Exception(error);
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
        }
        finally { foreach (var handle in parents) handle.Dispose(); }
    }
}
