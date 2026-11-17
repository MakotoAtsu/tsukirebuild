#!/usr/bin/env python3
"""dev_server.py [port]: the game's own server with the developer pages added, which are kept out of web/ because the game does not need them:
the script smoke test at /smoketest.html, and the translator tool's page fit at /fit/ (web-dev/fit, with web-dev/data/line_map.json)."""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True   # no cache folder inside web/
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("server", os.path.join(HERE, "../../web/server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
SMOKE = os.path.join(HERE, "../smoketest")
FIT = os.path.join(HERE, "../fit")
EXTRA = {"/smoketest.html": os.path.join(SMOKE, "smoketest.html"), "/js/smoketest.js": os.path.join(SMOKE, "smoketest.js"),
         "/fit": os.path.join(FIT, "fit.html"), "/fit/": os.path.join(FIT, "fit.html"), "/fit/index.html": os.path.join(FIT, "fit.html"),
         "/fit/fit.js": os.path.join(FIT, "fit.js"), "/fit/line_map.json": os.path.join(HERE, "../data/line_map.json")}


class Dev(server.Handler):
    def do_GET(self):
        extra = EXTRA.get(self.path.split("?")[0])
        if extra:
            return self.send_file(extra)
        super().do_GET()


if __name__ == "__main__":
    srv = server.Server(("127.0.0.1", server.PORT), Dev)
    print(f"http://localhost:{server.PORT}/smoketest.html  http://localhost:{server.PORT}/fit/", flush=True)
    srv.serve_forever()
