Set WshShell = WScript.CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
strCurrentDir = WshShell.CurrentDirectory

Set oShellLink = WshShell.CreateShortcut(strDesktop & "\VanailaChat.lnk")
oShellLink.TargetPath = strCurrentDir & "\start.bat"
oShellLink.WorkingDirectory = strCurrentDir
oShellLink.WindowStyle = 1
oShellLink.Description = "Launch VanailaChat AI Workspace"
If (CreateObject("Scripting.FileSystemObject").FileExists(strCurrentDir & "\public\favicon.ico")) Then
    oShellLink.IconLocation = strCurrentDir & "\public\favicon.ico, 0"
End If
oShellLink.Save
WScript.Echo "Shortcut created at: " & strDesktop & "\VanailaChat.lnk"
