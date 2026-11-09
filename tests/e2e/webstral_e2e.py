#!/usr/bin/env python3
"""Webstral e2e on Firefox Dev Edition (headless, Marionette).

Suit la recette schatzy projects/firefox-marionette-e2e.md (harness wagonBAR) :
env MOZ_REMOTE_ALLOW_SYSTEM_ACCESS, badge lu via le nœud toolbar "-BAP",
seed de storage.js avec le backend IDB désactivé, pages moz-extension:// NON
navigables -> sidepanel/options testés sur copie localhost avec chrome mock.

Phases :
  A. build xpi + install temporaire -> le manifest MV3 (sidebar_action +
     background.scripts) charge, uuid résoluble.
  B. storage.js seedé (settings + usage) -> badge « 15% » (comptage local) ;
     clic sur l'icône -> ouverture de la sidebar de l'extension
     (action.onClicked -> sidebarAction.open).
  C. copie localhost du sidepanel (chrome mock) : streaming + markdown + meta.
  C2. copie localhost des options : bouton permissions (visible sans grant,
      disparaît après accord).

Usage : python tests/e2e/webstral_e2e.py
MISTRAL_API_KEY (optionnel) est juste seedé comme clé de chat (jamais affiché).
"""
import functools
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from marionette_driver.addons import Addons
from marionette_driver.marionette import Marionette

ROOT = Path(__file__).resolve().parents[2]
EXT_DIR = ROOT / "extension"
ADDON_ID = "webstral@cabon14.com"
FF_BINARY = Path(os.environ["ProgramFiles"]) / "Firefox Developer Edition" / "firefox.exe"
PORT = 2828
HTTP_PORT = 8973

checks = []


def check(name, ok, extra=""):
    checks.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f" — {extra}" if extra else ""))


def wait_port_open(port, tries=30):
    for _ in range(tries):
        with socket.socket() as s:
            s.settimeout(0.2)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return True
            time.sleep(1)
    return False


def build_xpi(dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(EXT_DIR.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(EXT_DIR).as_posix())


def make_profile(dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    widget = "webstral_cabon14_com"
    ui_state = json.dumps({"placements": {"nav-bar": [f"{widget}-browser-action"]}})
    (dest / "user.js").write_text(
        'user_pref("browser.shell.checkDefaultBrowser", false);\n'
        'user_pref("extensions.webextensions.ExtensionStorageIDB.enabled", false);\n'
        f'user_pref("browser.uiCustomization.state", {json.dumps(ui_state)});\n'
        'user_pref("browser.warnOnQuit", false);\n',
        encoding="utf-8",
    )
    return dest


def seed_storage(profile: Path) -> None:
    key = os.environ.get("MISTRAL_API_KEY", "").strip() or "e2e-seed-key"
    now = time.localtime()
    month = f"{now.tm_year}-{now.tm_mon:02d}"
    seeds = {
        "apiKey": key,
        "settings": {"monthlyBudgetTokens": 1000, "warnPct": 70, "dangerPct": 90},
        "usage": {month: {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}},
        "accountBudget": None,
        "models": ["mistral-small-latest"],
        "conversation": [],
    }
    data_dir = profile / "browser-extension-data" / ADDON_ID
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "storage.js").write_text(json.dumps(seeds), encoding="utf-8")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


SIDEPANEL_MOCK = """
<script>
  window.__chatRequests = [];
  window.__portListeners = [];
  (function () {
    const store = {
      apiKey: 'test-key',
      models: ['mistral-small-latest'],
      defaultModel: 'mistral-small-latest',
      accountBudget: null,
    };
    window.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            const want = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of want) if (k in store) out[k] = store[k];
            return out;
          },
          set: async () => {},
        },
      },
      runtime: {
        connect: () => ({
          postMessage: (m) => __chatRequests.push(m),
          onMessage: { addListener: (fn) => __portListeners.push(fn) },
          onDisconnect: { addListener: () => {} },
        }),
        openOptionsPage: () => {},
      },
    };
  })();
</script>
<script>
  // réponses SSE simulées pour chaque chat request
  (function () {
    const answer = (req) => {
      req.__answered = true;
      for (const fn of window.__portListeners) {
        fn({ type: 'delta', content: 'Salut' });
        fn({ type: 'delta', content: ' **parent**' });
        fn({ type: 'done', usage: { prompt_tokens: 9, completion_tokens: 3 } });
      }
    };
    setInterval(() => {
      for (const r of window.__chatRequests) if (!r.__answered) answer(r);
    }, 200);
  })();
</script>
"""

OPTIONS_MOCK = """
<script>
  // Compteurs via le DOM ( monde isolé Marionette : window.* invisibles )
  (function () {
    window.__permGranted = { v: false };
    window.chrome = {
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: () => {} },
      },
      runtime: {
        sendMessage: (m, cb) =>
          setTimeout(() => cb({ accountBudget: null, accountBudgetError: 'session absente (mock)' }), 10),
        openOptionsPage: () => {},
      },
      permissions: {
        contains: async () => window.__permGranted.v,
        request: async () => {
          window.__permGranted.v = true;
          const b = document.getElementById('btn-perms');
          b.dataset.requests = String((parseInt(b.dataset.requests || '0', 10) || 0) + 1);
          return true;
        },
      },
    };
  })();
</script>
"""


def build_srv(srv_dir: Path) -> None:
    shutil.copytree(EXT_DIR / "sidepanel", srv_dir / "sidepanel")
    shutil.copytree(EXT_DIR / "options", srv_dir / "options")
    sp = (srv_dir / "sidepanel" / "sidepanel.html").read_text(encoding="utf-8")
    (srv_dir / "sidepanel" / "sidepanel.html").write_text(
        sp.replace(
            '<script type="module" src="sidepanel.js"></script>',
            SIDEPANEL_MOCK + '<script type="module" src="sidepanel.js"></script>',
        ),
        encoding="utf-8",
    )
    op = (srv_dir / "options" / "options.html").read_text(encoding="utf-8")
    (srv_dir / "options" / "options.html").write_text(
        op.replace(
            '<script type="module" src="options.js"></script>',
            OPTIONS_MOCK + '<script type="module" src="options.js"></script>',
        ),
        encoding="utf-8",
    )


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="webstral_e2e_"))
    profile_dir = make_profile(tmp / "profile")
    xpi = tmp / "webstral.xpi"
    srv_dir = tmp / "srv"
    build_xpi(xpi)
    seed_storage(profile_dir)
    build_srv(srv_dir)

    httpd = HTTPServer(
        ("127.0.0.1", HTTP_PORT), functools.partial(QuietHandler, directory=str(srv_dir))
    )
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1")
    subprocess.Popen(
        [
            str(FF_BINARY), "-marionette", "-headless", "-no-remote",
            "-profile", str(profile_dir), "about:blank",
        ],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    client = None
    try:
        assert wait_port_open(PORT), "port marionette jamais ouvert"
        client = Marionette(host="127.0.0.1", port=PORT)
        client.start_session()

        # ---- Phase A : install + manifest
        try:
            Addons(client).install(str(xpi), temp=True)
            uuids = client.get_pref("extensions.webextensions.uuids")
            uuid_map = json.loads(uuids) if uuids else {}
            check(
                "A: install temporaire + uuid",
                ADDON_ID in uuid_map,
                str(uuid_map.get(ADDON_ID, "")),
            )
        except Exception as e:
            check("A: install temporaire + uuid", False, str(e)[:200])
            return 1

        # ---- Phase B : badge + sidebar
        time.sleep(2.0)
        client.set_context("chrome")

        def chrome_script(src):
            return client.execute_script(
                f"""
                const win = Services.wm.getMostRecentWindow('navigator:browser');
                {src}
                """
            )

        badge = chrome_script(
            """
            const b = win.document.getElementById('webstral_cabon14_com-BAP');
            return b ? b.getAttribute('badge') : null;
            """
        )
        check("B: badge = 15% (comptage local seed)", badge == "15%", repr(badge))

        before = chrome_script(
            """
            const box = win.document.getElementById('sidebar-box');
            if (!box) return null;
            return {
              hidden: box.hidden,
              cmd: box.getAttribute('sidebarcommand'),
              src: (box.getAttribute('src') || '').slice(0, 45),
            };
            """
        )
        print("B: sidebar avant clic:", before)

        click_ok = chrome_script(
            """
            const b = win.document.getElementById('webstral_cabon14_com-BAP');
            if (!b) return false;
            b.click();
            return true;
            """
        )
        time.sleep(1.5)
        after = chrome_script(
            """
            const box = win.document.getElementById('sidebar-box');
            if (!box) return null;
            const src = box.getAttribute('src') || '';
            const cmd = box.getAttribute('sidebarcommand') || '';
            const browser = box.querySelector('browser');
            return {
              hidden: box.hidden,
              cmd,
              isExt:
                cmd.endsWith('-sidebar-action') ||
                src.startsWith('moz-extension://') ||
                (browser && (browser.getAttribute('src') || '').startsWith('moz-extension://')),
              src: src.slice(0, 45),
            };
            """
        )
        print("B: sidebar après clic:", after)
        check(
            "B: sidebar extension active (install + clic icône)",
            click_ok and after is not None and not after["hidden"] and after["isExt"],
            f"after={after}",
        )

        # ---- Phase C : copie localhost sidepanel (chrome mock)
        client.set_context("content")
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/sidepanel/sidepanel.html")
        time.sleep(0.8)
        client.execute_script(
            """
            const p = document.getElementById('prompt');
            p.value = 'test streaming';
            document.getElementById('btn-send').click();
            """
        )
        time.sleep(2.0)
        sp = client.execute_script(
            """
            return {
              assistant: (document.querySelector('.msg.assistant') || {}).textContent,
              meta: (document.querySelector('.meta') || {}).textContent,
              strong: !!document.querySelector('.msg.assistant strong'),
            };
            """
        )
        check(
            "C: streaming + markdown + meta (page localhost)",
            sp
            and "Salut" in (sp.get("assistant") or "")
            and sp.get("strong")
            and "9 tokens in" in (sp.get("meta") or ""),
            json.dumps(sp, ensure_ascii=False)[:160],
        )

        # ---- Phase C2 : copie localhost options (permissions mock)
        client.navigate(f"http://127.0.0.1:{HTTP_PORT}/options/options.html")
        time.sleep(0.8)
        opt = client.execute_script(
            """
            const view = document.getElementById('perm-view');
            const btn = document.getElementById('btn-perms');
            const visible = btn && !btn.classList.contains('hidden');
            if (btn) btn.click();
            return { view: view ? view.textContent : null, buttonVisible: visible };
            """
        )
        time.sleep(0.5)
        opt_after = client.execute_script(
            """
            return {
              view: document.getElementById('perm-view').textContent,
              buttonHidden: document.getElementById('btn-perms').classList.contains('hidden'),
              permsRequested: parseInt(document.getElementById('btn-perms').dataset.requests || '0', 10),
            };
            """
        )
        check(
            "C2: bouton permissions (visible sans accord, masqué après)",
            opt is not None
            and opt.get("buttonVisible")
            and opt_after.get("permsRequested") == 1
            and opt_after.get("buttonHidden")
            and "accordé" in (opt_after.get("view") or ""),
            json.dumps(opt_after, ensure_ascii=False)[:160],
        )

        return 0 if all(ok for _, ok in checks) else 1
    finally:
        try:
            if client:
                client.quit()
        except Exception:
            pass
        httpd.shutdown()
        time.sleep(1.0)
        subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_Process -Filter \"name='firefox.exe'\" | "
             "Where-Object { $_.CommandLine -like '*-marionette*' } | "
             "ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
            check=False, capture_output=True,
        )
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
