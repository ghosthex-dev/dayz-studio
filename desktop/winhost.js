// Win32 helpers (via koffi) to adopt another process's top-level window as a child of the Studio window.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const EnumProc = koffi.proto('bool EnumProc(intptr_t hwnd, intptr_t lparam)');
const EnumWindows = user32.func('bool EnumWindows(EnumProc *cb, intptr_t lparam)');
const GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)');
const IsWindowVisible = user32.func('bool IsWindowVisible(intptr_t hwnd)');
const GetWindowTextW = user32.func('int GetWindowTextW(intptr_t hwnd, _Out_ char16_t *buf, int max)');
const GetClassNameW = user32.func('int GetClassNameW(intptr_t hwnd, _Out_ char16_t *buf, int max)');
const SetParent = user32.func('intptr_t SetParent(intptr_t child, intptr_t parent)');
const GetWindowLongPtrW = user32.func('intptr_t GetWindowLongPtrW(intptr_t hwnd, int idx)');
const SetWindowLongPtrW = user32.func('intptr_t SetWindowLongPtrW(intptr_t hwnd, int idx, intptr_t value)');
const SetWindowPos = user32.func('bool SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)');
const ShowWindow = user32.func('bool ShowWindow(intptr_t hwnd, int cmd)');
const SetFocus = user32.func('intptr_t SetFocus(intptr_t hwnd)');
const IsWindow = user32.func('bool IsWindow(intptr_t hwnd)');
const AttachThreadInput = user32.func('bool AttachThreadInput(uint32_t from, uint32_t to, bool attach)');
const GetCurrentThreadId = kernel32.func('uint32 GetCurrentThreadId()');
const GetWindowRect = user32.func('bool GetWindowRect(intptr_t hwnd, _Out_ int32_t *rect)');
const PostMessageW = user32.func('bool PostMessageW(intptr_t hwnd, uint32_t msg, intptr_t w, intptr_t l)');

const GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
const WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_POPUP = 0x80000000, WS_CAPTION = 0x00C00000,
  WS_THICKFRAME = 0x00040000, WS_SYSMENU = 0x00080000, WS_MINIMIZEBOX = 0x00020000, WS_MAXIMIZEBOX = 0x00010000,
  WS_BORDER = 0x00800000, WS_DLGFRAME = 0x00400000;
const WS_EX_APPWINDOW = 0x00040000, WS_EX_WINDOWEDGE = 0x00000100, WS_EX_CLIENTEDGE = 0x00000200, WS_EX_TOOLWINDOW = 0x00000080;
const SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_FRAMECHANGED = 0x0020, SWP_SHOWWINDOW = 0x0040, SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1;
const HWND_TOP = 0;

function winText(hwnd) {
  const buf = Buffer.alloc(512);
  const n = GetWindowTextW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
}
function winClass(hwnd) {
  const buf = Buffer.alloc(512);
  const n = GetClassNameW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
}
function rectOf(hwnd) {
  const r = [0, 0, 0, 0];
  GetWindowRect(hwnd, r);
  return { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
}

/** top-level windows of a process (visible, with a title or sizeable) */
function windowsOfPid(pid) {
  const out = [];
  const cb = koffi.register((hwnd) => {
    const p = [0];
    GetWindowThreadProcessId(hwnd, p);
    if (p[0] === pid && IsWindowVisible(hwnd)) {
      const r = rectOf(hwnd);
      out.push({ hwnd, title: winText(hwnd), cls: winClass(hwnd), w: r.w, h: r.h });
    }
    return true;
  }, koffi.pointer(EnumProc));
  EnumWindows(cb, 0);
  koffi.unregister(cb);
  return out;
}

/** pick the real game window: the biggest visible top-level window of the process */
function findGameWindow(pid) {
  const list = windowsOfPid(pid).filter((w) => w.w > 300 && w.h > 200);
  list.sort((a, b) => b.w * b.h - a.w * a.h);
  return list[0] || null;
}

function embed(child, parent) {
  SetParent(child, parent);
  let st = Number(BigInt.asIntN(64, BigInt(GetWindowLongPtrW(child, GWL_STYLE))) & 0xffffffffn);
  st &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_POPUP | WS_BORDER | WS_DLGFRAME);
  st |= WS_CHILD | WS_VISIBLE;
  SetWindowLongPtrW(child, GWL_STYLE, st >>> 0);
  let ex = Number(BigInt.asIntN(64, BigInt(GetWindowLongPtrW(child, GWL_EXSTYLE))) & 0xffffffffn);
  ex &= ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE);
  SetWindowLongPtrW(child, GWL_EXSTYLE, ex >>> 0);
}

/** make the game a borderless window OWNED by the host: it stays above it, follows minimise/restore,
 *  and can be positioned over a placeholder region (screen coordinates) */
function dock(game, host) {
  SetWindowLongPtrW(game, GWLP_HWNDPARENT, host);
  let st = Number(BigInt.asIntN(64, BigInt(GetWindowLongPtrW(game, GWL_STYLE))) & 0xffffffffn);
  st &= ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_BORDER | WS_DLGFRAME | WS_CHILD);
  st |= WS_POPUP | WS_VISIBLE;
  SetWindowLongPtrW(game, GWL_STYLE, st >>> 0);
  let ex = Number(BigInt.asIntN(64, BigInt(GetWindowLongPtrW(game, GWL_EXSTYLE))) & 0xffffffffn);
  ex &= ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE);
  ex |= WS_EX_TOOLWINDOW; // no taskbar button
  SetWindowLongPtrW(game, GWL_EXSTYLE, ex >>> 0);
}

function placeScreen(game, x, y, w, h, visible) {
  SetWindowPos(game, HWND_TOP, Math.round(x), Math.round(y), Math.max(16, Math.round(w)), Math.max(16, Math.round(h)),
    SWP_FRAMECHANGED | SWP_NOACTIVATE | (visible ? SWP_SHOWWINDOW : 0));
  if (!visible) ShowWindow(game, 0);
}

function place(child, x, y, w, h) {
  SetWindowPos(child, HWND_TOP, Math.round(x), Math.round(y), Math.max(16, Math.round(w)), Math.max(16, Math.round(h)), SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOACTIVATE);
}

function focusWindow(child, parent) {
  // share the input queue so SetFocus works across processes
  const tChild = GetWindowThreadProcessId(child, [0]);
  const tMe = GetCurrentThreadId();
  AttachThreadInput(tMe, tChild, true);
  SetFocus(child);
  AttachThreadInput(tMe, tChild, false);
}

module.exports = {
  windowsOfPid, findGameWindow, embed, place, dock, placeScreen, focusWindow,
  hide: (h) => ShowWindow(h, 0),
  show: (h) => ShowWindow(h, 5),
  alive: (h) => IsWindow(h),
  winText, winClass, rectOf,
  postClose: (h) => PostMessageW(h, 0x0010, 0, 0),
};
