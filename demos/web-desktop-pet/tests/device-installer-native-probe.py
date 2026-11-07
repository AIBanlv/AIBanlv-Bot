"""Exercise the installer's non-truncating Win32 probe on caller-owned fixtures."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
file = root / '中文 空格 $文件.txt'
missing = root / 'missing.exe'
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
kernel.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
kernel.GetFileAttributesW.restype = wintypes.DWORD
kernel.SetFileAttributesW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD]
kernel.SetFileAttributesW.restype = wintypes.BOOL
invalid = ctypes.c_void_p(-1).value

def probe(target):
    # Keep these arguments identical to CheckInstallFileWritable's System::Call.
    handle = kernel.CreateFileW(str(target), 0x40000000, 0, None, 3, 0x80, None)
    if handle == invalid:
        return ctypes.get_last_error()
    assert kernel.CloseHandle(handle)
    return 0

unlocked = probe(file)
lock = kernel.CreateFileW(str(file), 0x80000000, 1, None, 3, 0x80, None)
assert lock != invalid
try:
    locked = probe(file)
finally:
    assert kernel.CloseHandle(lock)
after_unlock = probe(file)
attributes = kernel.GetFileAttributesW(str(file))
assert attributes != 0xffffffff
try:
    assert kernel.SetFileAttributesW(str(file), attributes | 1)
    read_only = probe(file)
finally:
    assert kernel.SetFileAttributesW(str(file), attributes)
print(json.dumps(dict(unlocked=unlocked, locked=locked, afterUnlock=after_unlock,
                      readOnly=read_only, missing=probe(missing), missingDirectory=probe(root / 'absent' / 'missing.exe'))))
