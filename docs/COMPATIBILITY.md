# Compatibility boundary

BATFlow targets the control-flow behavior of MS-DOS 7.1 `COMMAND.COM` and the
multiple-configuration menu system introduced by MS-DOS 6.

The 0.6.0 model includes labels and GOTO, all DOS IF forms, FOR, SET, CALL,
direct batch transfer, `%0` through `%9`, SHIFT, EXIT, COMMAND `/C`, CHOICE,
pipelines, flow-relevant ERRORLEVEL, CONFIG.SYS menu directives, nested
SUBMENU, ordered COMMON blocks, INCLUDE, and `%CONFIG%` handoff to
AUTOEXEC.BAT. Unknown external programs remain opaque and are never run.

Files must be valid UTF-8. Uniform CRLF, LF, or CR line endings are preserved
when downloading the selected file. Mixed endings are normalized to CRLF with
a warning. DOS paths compare case-insensitively.

BATFlow supports current desktop Firefox and Chromium. It requires an HTTP(S)
static host and deliberately provides no service worker or offline guarantee.
Mobile layouts, legacy DOS code pages, NT `cmd.exe` extensions, and arbitrary
filesystem access are outside the 0.6.0 boundary.
