export const windowsFolderPicker = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
class VireloFileOpenDialog { }

// COM slots must retain their native order, including methods not called here.
[ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface VireloIFileDialog {
  [PreserveSig] int Show(IntPtr owner);
  void SetFileTypes(uint count, IntPtr filters);
  void SetFileTypeIndex(uint index);
  void GetFileTypeIndex(out uint index);
  void Advise(VireloIFileDialogEvents events, out uint cookie);
  void Unadvise(uint cookie);
  void SetOptions(uint options);
  void GetOptions(out uint options);
  void SetDefaultFolder(VireloIShellItem folder);
  void SetFolder(VireloIShellItem folder);
  void GetFolder(out VireloIShellItem folder);
  void GetCurrentSelection(out VireloIShellItem item);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
  void GetFileName(out IntPtr name);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
  void GetResult(out VireloIShellItem item);
  void AddPlace(VireloIShellItem item, uint placement);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
  void Close(int result);
  void SetClientGuid(ref Guid guid);
}
[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface VireloIShellItem {
  void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
  void GetParent(out VireloIShellItem parent);
  void GetDisplayName(uint type, out IntPtr name);
}
[ComImport, Guid("00000114-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface VireloIOleWindow { void GetWindow(out IntPtr window); }
[ComImport, Guid("973510DB-7D7F-452B-8975-74A85828D354"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface VireloIFileDialogEvents {
  [PreserveSig] int OnFileOk(VireloIFileDialog dialog);
  [PreserveSig] int OnFolderChanging(VireloIFileDialog dialog, VireloIShellItem folder);
  [PreserveSig] int OnFolderChange(VireloIFileDialog dialog);
  [PreserveSig] int OnSelectionChange(VireloIFileDialog dialog);
  [PreserveSig] int OnShareViolation(VireloIFileDialog dialog, VireloIShellItem item, out uint response);
  [PreserveSig] int OnTypeChange(VireloIFileDialog dialog);
  [PreserveSig] int OnOverwrite(VireloIFileDialog dialog, VireloIShellItem item, out uint response);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class VireloFolderPicker : VireloIFileDialogEvents, IDisposable {
  delegate void TimerCallback(IntPtr window, uint message, UIntPtr timer, uint time);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint thread, uint target, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, TimerCallback callback);
  [DllImport("user32.dll")] static extern bool KillTimer(IntPtr window, UIntPtr id);
  bool presented;
  TimerCallback presentation;
  UIntPtr timer;
  public static string Pick() {
    var dialog = (VireloIFileDialog)new VireloFileOpenDialog();
    var events = new VireloFolderPicker();
    uint cookie = 0;
    bool advised = false;
    try {
      uint options;
      dialog.GetOptions(out options);
      // Pick existing filesystem folders, without changing cwd or adding Recent items.
      dialog.SetOptions(options | 0x20 | 0x40 | 0x800 | 0x08 | 0x02000000);
      dialog.SetTitle("Choose a media folder - Virelo");
      dialog.SetOkButtonLabel("Select folder");
      var client = new Guid("D3A5FD57-86BA-4120-A0FB-669D12FB8EF7");
      dialog.SetClientGuid(ref client);
      dialog.Advise(events, out cookie);
      advised = true;
      // An out-of-process dialog must not disable a browser window on cancellation.
      int result = dialog.Show(IntPtr.Zero);
      if (result == unchecked((int)0x800704C7)) return null;
      Marshal.ThrowExceptionForHR(result);
      VireloIShellItem item;
      dialog.GetResult(out item);
      IntPtr path = IntPtr.Zero;
      try {
        item.GetDisplayName(0x80058000, out path);
        return Marshal.PtrToStringUni(path);
      } finally {
        if (path != IntPtr.Zero) Marshal.FreeCoTaskMem(path);
        Marshal.ReleaseComObject(item);
      }
    } finally {
      try { if (advised) dialog.Unadvise(cookie); }
      finally { events.Dispose(); Marshal.ReleaseComObject(dialog); }
    }
  }
  public int OnFolderChange(VireloIFileDialog dialog) {
    if (presented) return 0;
    IntPtr window;
    ((VireloIOleWindow)dialog).GetWindow(out window);
    if (window == IntPtr.Zero) return 0;
    presented = true;
    // OnFolderChange runs before ShowWindow, which resets the initial z-order.
    presentation = delegate(IntPtr ignored, uint message, UIntPtr id, uint time) {
      if (!IsWindowVisible(window)) return;
      Dispose();
      uint process;
      uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out process);
      uint current = GetCurrentThreadId();
      // The helper is not a browser child; join its input queue only while activating.
      bool attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
      try {
        bool activated = SetForegroundWindow(window);
        SetWindowPos(window, activated ? IntPtr.Zero : new IntPtr(-1), 0, 0, 0, 0, 0x13);
      } finally { if (attached) AttachThreadInput(current, foreground, false); }
    };
    timer = SetTimer(IntPtr.Zero, UIntPtr.Zero, 50, presentation);
    return 0;
  }
  public void Dispose() {
    if (timer != UIntPtr.Zero) { KillTimer(IntPtr.Zero, timer); timer = UIntPtr.Zero; }
  }
  public int OnFileOk(VireloIFileDialog dialog) { return 0; }
  public int OnFolderChanging(VireloIFileDialog dialog, VireloIShellItem folder) { return 0; }
  public int OnSelectionChange(VireloIFileDialog dialog) { return 0; }
  public int OnShareViolation(VireloIFileDialog dialog, VireloIShellItem item, out uint response) { response = 0; return 0; }
  public int OnTypeChange(VireloIFileDialog dialog) { return 0; }
  public int OnOverwrite(VireloIFileDialog dialog, VireloIShellItem item, out uint response) { response = 0; return 0; }
}
'@
$path = [VireloFolderPicker]::Pick()
if ($null -ne $path) { ConvertTo-Json -InputObject $path -Compress }
`;
