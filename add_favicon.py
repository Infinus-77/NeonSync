import os
import re

dir_path = r"c:\Users\Aryan Naik\OneDrive\Desktop\NeonSync"
favicon_tag = '\n    <link rel="icon" type="image/jpeg" href="NS_logo.jpeg">'

for filename in os.listdir(dir_path):
    if filename.endswith(".html"):
        filepath = os.path.join(dir_path, filename)
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if '<link rel="icon"' not in content:
            content = re.sub(r'(</title>)', r'\1' + favicon_tag, content)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f"Updated {filename}")
