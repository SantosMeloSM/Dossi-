# Procura um nó no dump do uiautomator e imprime o centro "x y".
# Uso: uifind.py ui.xml <texto|#id|@EditText:n>
import re, sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
q = sys.argv[2]
nodes = list(root.iter('node'))
def center(n):
    a = list(map(int, re.findall(r'\d+', n.get('bounds'))))
    return f"{(a[0]+a[2])//2} {(a[1]+a[3])//2}"
if q.startswith('@EditText:'):
    edits = [n for n in nodes if n.get('class') == 'android.widget.EditText']
    i = int(q.split(':')[1])
    if i < len(edits): print(center(edits[i])); sys.exit(0)
    sys.exit(1)
for n in nodes:
    hay = ' '.join([n.get('text', ''), n.get('content-desc', ''), n.get('resource-id', '')])
    if q.lower() in hay.lower():
        print(center(n)); sys.exit(0)
sys.exit(1)
