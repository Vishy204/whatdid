# Records the README GIF with charmbracelet/vhs:  vhs demo/demo.tape   (run from the repo root)
# Deterministic: demo/play.mjs replays a fixture session, so no Claude Code or API calls are needed.
Output demo/whatdid.gif

Set Shell "bash"
Set FontSize 15
Set Width 1200
Set Height 820
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Hide
Type "clear && node demo/play.mjs --prompt"
Enter
Sleep 800ms
Show

Sleep 1s
Type "wd"
Sleep 400ms
Enter
Sleep 5s

Type "wd 2"
Sleep 400ms
Enter
Sleep 6s

Type "wd replay"
Sleep 400ms
Enter
Sleep 5s

Type "exit"
Enter
Sleep 300ms
