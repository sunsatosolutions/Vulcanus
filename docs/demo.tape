# Records docs/demo.gif — the README demo.
#
#   brew install vhs      (or see https://github.com/charmbracelet/vhs)
#   npm run build
#   vhs docs/demo.tape    (from the repository root)
#
# The vault is built in /tmp so the paths the CLI prints stay short and
# carry nobody's home directory into a public image.

Output "docs/demo.gif"

Set Shell bash
Set FontSize 15
Set Width 1180
Set Height 860
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 20

Hide
Type 'alias vulcanus="node $PWD/dist/cli.js"' Enter
Type "export PS1='$ '" Enter
Type "rm -rf /tmp/vulcanus-demo && mkdir -p /tmp/vulcanus-demo && cd /tmp/vulcanus-demo" Enter
Type "clear" Enter
Show

Sleep 800ms
Type "vulcanus init ATLAS --name ATLAS --operator Ada --projects 'Meridian, Harbor' --no-import --defaults -y"
Sleep 400ms
Enter
Sleep 6s

Type "cd ATLAS && vulcanus status"
Sleep 300ms
Enter
Sleep 5s

Type "clear"
Enter
Sleep 300ms

Type "vulcanus stats"
Sleep 300ms
Enter
Sleep 6s

Hide
Type "cd / && rm -rf /tmp/vulcanus-demo" Enter
Show
