import ctypes, ctypes.wintypes as wt
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.CreateMutexW.restype = wt.HANDLE
k.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
ctypes.set_last_error(0)
h = k.CreateMutexW(None, False, r"Global\XArenaNoFogPro")
print("handle =", h, " lastError =", ctypes.get_last_error())
ctypes.set_last_error(0)
h2 = k.CreateMutexW(None, False, r"Global\XArenaNoFogPro_Zz_probe_%d")
print("unique handle =", h2, " lastError =", ctypes.get_last_error())
k.CloseHandle(h)
