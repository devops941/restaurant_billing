Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\restaurant_billing"
WshShell.Run """D:\restaurant_billing\node_modules\electron\dist\electron.exe"" .", 1, False
